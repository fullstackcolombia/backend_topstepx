import WebSocket from 'ws';

import { appendLog, state } from './state.js';

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeEnv(value, fallback = 'demo') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'live' || normalized === 'demo') {
    return normalized;
  }
  return fallback;
}

function toQuery(params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null);
  if (entries.length === 0) {
    return '';
  }
  const search = new URLSearchParams();
  for (const [key, value] of entries) {
    search.append(key, String(value));
  }
  return `?${search.toString()}`;
}

export class TradovateAdapter {
  constructor() {
    this.mode = process.env.PANEL_MODE || 'live';
    const defaultEnv = this.mode === 'live' ? 'live' : 'demo';
    this.defaultEnv = normalizeEnv(process.env.TRADOVATE_ENV, defaultEnv);

    this.restByEnv = {
      demo: (process.env.TRADOVATE_DEMO_REST_BASE || 'https://demo.tradovateapi.com/v1').replace(/\/$/, ''),
      live: (process.env.TRADOVATE_LIVE_REST_BASE || 'https://live.tradovateapi.com/v1').replace(/\/$/, '')
    };

    this.wsByEnv = {
      demo: (process.env.TRADOVATE_DEMO_WS_URL || 'wss://demo.tradovateapi.com/v1/websocket').replace(/\/$/, ''),
      live: (process.env.TRADOVATE_LIVE_WS_URL || 'wss://live.tradovateapi.com/v1/websocket').replace(/\/$/, '')
    };

    this.marketDataWsUrl = (process.env.TRADOVATE_MD_WS_URL || 'wss://md.tradovateapi.com/v1/websocket').replace(/\/$/, '');

    this.authDefaults = {
      appId: String(process.env.TRADOVATE_APP_ID || '').trim(),
      appVersion: String(process.env.TRADOVATE_APP_VERSION || '').trim(),
      cid: Number(process.env.TRADOVATE_CID),
      sec: String(process.env.TRADOVATE_SEC || '').trim()
    };

    this.sessions = new Map();
  }

  async connect() {
    state.connection.tradovate = this.defaultEnv === 'live' ? 'READY' : 'SIMULATED';
    appendLog('INFO', `Tradovate adapter ready in ${this.defaultEnv} mode`);
    return true;
  }

  _credKey(creds) {
    const env = this._resolveEnv(creds);
    const authBody = this._authBody(creds);
    return `${env}::${authBody.name}::${authBody.appId}::${authBody.cid}`;
  }

  _resolveEnv(creds) {
    const explicit = creds?.environment;
    return normalizeEnv(explicit, this.defaultEnv);
  }

  _restBase(creds) {
    return this.restByEnv[this._resolveEnv(creds)];
  }

  _wsBase(creds) {
    return this.wsByEnv[this._resolveEnv(creds)];
  }

  _authBody(creds) {
    const body = {
      name: String(creds?.name || '').trim(),
      password: String(creds?.password || '')
    };

    if (!body.name || !body.password) {
      throw new Error('Tradovate credentials require name and password');
    }

    const appId = String(creds?.appId || this.authDefaults.appId || '').trim();
    const appVersion = String(creds?.appVersion || this.authDefaults.appVersion || '').trim();
    const sec = String(creds?.sec || this.authDefaults.sec || '').trim();
    const cidRaw = creds?.cid ?? this.authDefaults.cid;
    const cid = Number(cidRaw);

    // Optional fields: include only when available to keep schema-compatible payloads.
    if (appId) {
      body.appId = appId;
    }
    if (appVersion) {
      body.appVersion = appVersion;
    }
    if (Number.isInteger(cid) && cid >= 0) {
      body.cid = cid;
    }
    if (sec) {
      body.sec = sec;
    }

    return body;
  }

  _stripAppRegistrationFields(authBody) {
    const next = { ...authBody };
    delete next.appId;
    delete next.appVersion;
    delete next.cid;
    delete next.sec;
    return next;
  }

  _isUnregisteredAppError(error) {
    const fromPayload = String(error?.payload?.errorText || '').toLowerCase();
    const fromMessage = String(error?.message || '').toLowerCase();
    return fromPayload.includes('app is not registered') || fromMessage.includes('app is not registered');
  }

  async _postNoAuth(restBase, path, body) {
    const response = await fetch(`${restBase}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body || {})
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(`Tradovate auth failed (${response.status}): ${JSON.stringify(payload)}`);
      error.statusCode = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async authenticateWithCreds(creds, force = false) {
    const key = this._credKey(creds);
    const now = Date.now();
    const cached = this.sessions.get(key);

    if (!force && cached?.accessToken && cached?.expirationTime && new Date(cached.expirationTime).getTime() - now > 15_000) {
      return cached;
    }

    const restBase = this._restBase(creds);
    let authBody = this._authBody(creds);
    let payload;

    try {
      payload = await this._postNoAuth(restBase, '/auth/accesstokenrequest', authBody);
    } catch (error) {
      // Some credential sets carry stale app registration metadata.
      // If Tradovate rejects the app, retry with only name/password.
      if (this._isUnregisteredAppError(error)) {
        const fallbackBody = this._stripAppRegistrationFields(authBody);
        if (fallbackBody.name && fallbackBody.password) {
          appendLog('WARN', `Tradovate auth app not registered for ${fallbackBody.name}; retrying without app fields`);
          authBody = fallbackBody;
          payload = await this._postNoAuth(restBase, '/auth/accesstokenrequest', authBody);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    if (payload?.['p-ticket'] && payload?.['p-time']) {
      const waitMs = Math.max(1, Number(payload['p-time'])) * 1000;
      await delay(waitMs);
      authBody = { ...authBody, 'p-ticket': payload['p-ticket'] };
      payload = await this._postNoAuth(restBase, '/auth/accesstokenrequest', authBody);
    }

    if (payload?.errorText) {
      throw new Error(`Tradovate auth error: ${payload.errorText}`);
    }

    if (!payload?.accessToken) {
      throw new Error('Tradovate auth did not return accessToken');
    }

    this.sessions.set(key, payload);
    appendLog('INFO', `Tradovate session established for: ${creds.name}`);
    return payload;
  }

  async requestWithCreds(path, method, creds, body = null, query = null, retry = true) {
    const auth = await this.authenticateWithCreds(creds);
    const restBase = this._restBase(creds);
    const endpoint = `${restBase}${path}${toQuery(query || {})}`;

    const response = await fetch(endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    const payload = await response.json().catch(() => ({}));
    if ((response.status === 401 || response.status === 403) && retry) {
      await this.authenticateWithCreds(creds, true);
      return this.requestWithCreds(path, method, creds, body, query, false);
    }

    if (!response.ok) {
      throw new Error(`Tradovate request failed ${path} (${response.status}): ${JSON.stringify(payload)}`);
    }

    return payload;
  }

  async listAccountsWithCreds(creds) {
    const accounts = await this.requestWithCreds('/account/list', 'GET', creds);
    return Array.isArray(accounts) ? accounts : [];
  }

  async placeOrderWithCreds(order, creds) {
    const action = order?.action;
    const symbol = order?.symbol;
    const orderQty = Number(order?.orderQty || 0);

    if (!action || !symbol || !Number.isFinite(orderQty) || orderQty <= 0) {
      throw new Error('Tradovate order requires action, symbol and orderQty');
    }

    let accountId = Number(order?.accountId);
    let accountSpec = String(order?.accountSpec || '').trim();

    if (!Number.isInteger(accountId) || !accountSpec) {
      const accounts = await this.listAccountsWithCreds(creds);
      const first = accounts[0];
      if (!first?.id || !first?.name) {
        throw new Error('Tradovate returned no accounts for this credential set');
      }
      accountId = Number(first.id);
      accountSpec = String(first.name);
    }

    const payload = {
      action,
      symbol,
      orderQty,
      orderType: String(order?.orderType || 'Market'),
      accountId,
      accountSpec,
      isAutomated: true
    };

    try {
      return await this.requestWithCreds('/order/placeorder', 'POST', creds, payload);
    } catch (_error) {
      return this.requestWithCreds('/order/placeOrder', 'POST', creds, payload);
    }
  }

  async _openAuthorizedSocket(url, token) {
    const ws = new WebSocket(url);
    let ready = false;
    let counter = 0;
    const pending = new Map();
    const listeners = [];

    const parseMessage = (raw) => {
      if (typeof raw !== 'string') {
        return [null, []];
      }
      const type = raw.slice(0, 1);
      const data = raw.length > 1 ? JSON.parse(raw.slice(1)) : [];
      return [type, data];
    };

    const send = ({ requestUrl, query = '', body = {} }) => {
      return new Promise((resolve, reject) => {
        const id = counter++;
        pending.set(id, { resolve, reject, requestUrl });
        ws.send(`${requestUrl}\n${id}\n${query || ''}\n${JSON.stringify(body || {})}`);
      });
    };

    const onMessage = (raw) => {
      const [type, data] = parseMessage(String(raw));

      if (type === 'h') {
        ws.send('[]');
        return;
      }

      if (type === 'o' && !ready) {
        send({ requestUrl: 'authorize', body: token })
          .then(() => {
            ready = true;
          })
          .catch(() => {
            ws.close();
          });
        return;
      }

      if (type !== 'a' || !Array.isArray(data)) {
        return;
      }

      for (const item of data) {
        if (Number.isInteger(item?.i) && pending.has(item.i)) {
          const entry = pending.get(item.i);
          if (item?.s === 200) {
            entry.resolve(item);
          } else if (item?.s && item.s !== 200) {
            entry.reject(new Error(`Tradovate WS request failed ${entry.requestUrl}: ${JSON.stringify(item?.d || item)}`));
          }
          pending.delete(item.i);
          continue;
        }

        for (const listener of listeners) {
          listener(item);
        }
      }
    };

    const onError = (error) => {
      for (const entry of pending.values()) {
        entry.reject(error instanceof Error ? error : new Error(String(error)));
      }
      pending.clear();
    };

    ws.on('message', onMessage);
    ws.on('error', onError);

    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const waitReadyStart = Date.now();
    while (!ready) {
      if (Date.now() - waitReadyStart > 8_000) {
        ws.close();
        throw new Error('Tradovate websocket authorize timeout');
      }
      await delay(25);
    }

    return {
      send,
      listen(listener) {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      },
      close() {
        try {
          ws.close();
        } catch (_error) {
          // noop
        }
      }
    };
  }

  _normalizeBars(rawBars = []) {
    const byTimestamp = new Map();
    for (const bar of rawBars) {
      const ts = bar?.timestamp || bar?.ts;
      if (!ts) {
        continue;
      }
      byTimestamp.set(ts, {
        ts,
        time: Math.floor(new Date(ts).getTime() / 1000),
        tsMs: new Date(ts).getTime(),
        open: Number(bar?.open || 0),
        high: Number(bar?.high || 0),
        low: Number(bar?.low || 0),
        close: Number(bar?.close || 0)
      });
    }

    return Array.from(byTimestamp.values())
      .filter((bar) => Number.isFinite(bar.tsMs))
      .sort((a, b) => a.tsMs - b.tsMs);
  }

  async getChartWithCreds(request, creds) {
    const auth = await this.authenticateWithCreds(creds);
    const mdToken = auth.mdAccessToken || auth.accessToken;
    if (!mdToken) {
      throw new Error('Tradovate auth did not return mdAccessToken/accessToken');
    }

    const symbol = String(request?.symbol || '').trim();
    if (!symbol) {
      throw new Error('Tradovate chart requires symbol');
    }

    const chartDescription = {
      underlyingType: String(request?.underlyingType || 'MinuteBar'),
      elementSize: Math.max(1, Number(request?.elementSize || 1)),
      elementSizeUnit: String(request?.elementSizeUnit || 'UnderlyingUnits'),
      withHistogram: false
    };

    const timeRange = {
      asMuchAsElements: Math.min(600, Math.max(30, Number(request?.asMuchAsElements || 160)))
    };

    const client = await this._openAuthorizedSocket(this.marketDataWsUrl, mdToken);
    try {
      const first = await client.send({
        requestUrl: 'md/getchart',
        body: {
          symbol,
          chartDescription,
          timeRange
        }
      });

      const realtimeId = first?.d?.realtimeId || first?.d?.subscriptionId;
      const allBars = [];
      let done = false;

      if (Array.isArray(first?.d?.bars)) {
        allBars.push(...first.d.bars);
      }

      const stopListen = client.listen((item) => {
        if (done) {
          return;
        }

        if (Array.isArray(item?.d?.charts)) {
          for (const chart of item.d.charts) {
            if (realtimeId && chart?.id !== realtimeId) {
              continue;
            }
            if (Array.isArray(chart?.bars)) {
              allBars.push(...chart.bars);
            }
            if (chart?.eoh) {
              done = true;
            }
          }
        }

        if (item?.d?.id && realtimeId && Number(item.d.id) === Number(realtimeId) && item?.d?.eoh) {
          done = true;
        }
      });

      const startedAt = Date.now();
      while (!done) {
        if (Date.now() - startedAt > 8_000) {
          break;
        }
        await delay(30);
      }

      stopListen();

      if (realtimeId) {
        try {
          await client.send({ requestUrl: 'md/cancelchart', body: { subscriptionId: realtimeId } });
        } catch (_error) {
          // Best effort cancel.
        }
      }

      return {
        symbol,
        candles: this._normalizeBars(allBars)
      };
    } finally {
      client.close();
    }
  }
}
