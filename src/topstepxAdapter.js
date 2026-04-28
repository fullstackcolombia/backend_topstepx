import { appendLog, state } from './state.js';

export class TopstepxAdapter {
  constructor() {
    this.mode = process.env.PANEL_MODE || 'live';
    this.apiBase = (process.env.TOPSTEPX_API_BASE || 'https://api.topstepx.com').replace(/\/$/, '');
    this.userName = process.env.TOPSTEPX_USER_NAME || process.env.TOPSTEPX_USERNAME || '';
    this.apiKey = process.env.TOPSTEPX_API_KEY || '';
    this.defaultMaxQty = Number(process.env.TOPSTEPX_DEFAULT_MAX_QTY || 30);
    this.sessionToken = '';
    this.lastAuthAt = 0;
    this.authCooldownMs = 60 * 1000;
    this.contractCache = [];
    this.contractCacheAt = 0;
    this.contractCacheTtlMs = 60 * 1000;
    // Per-credentials session cache: key = "userName::apiKeyHash", value = { token, lastAuthAt }
    this.credentialSessions = new Map();
  }

  async connect() {
    if (this.mode === 'live' && (!this.apiBase || !this.apiKey || !this.userName)) {
      state.connection.topstepx = 'ERROR';
      appendLog(
        'ERROR',
        'TopstepX live mode needs TOPSTEPX_API_BASE, TOPSTEPX_USER_NAME and TOPSTEPX_API_KEY'
      );
      return false;
    }

    if (this.mode === 'live') {
      try {
        await this.authenticate();
        await this.syncLiveAccounts();
      } catch (error) {
        state.connection.topstepx = 'ERROR';
        appendLog('ERROR', error.message || 'TopstepX authentication failed');
        return false;
      }
    }

    state.connection.topstepx = this.mode === 'live' ? 'CONNECTED' : 'SIMULATED';
    appendLog('INFO', `TopstepX adapter ready in ${this.mode} mode`);
    return true;
  }

  async authenticate(force = false) {
    if (this.mode !== 'live') {
      return;
    }

    const now = Date.now();
    if (!force && this.sessionToken && now - this.lastAuthAt < this.authCooldownMs) {
      return;
    }

    const response = await fetch(`${this.apiBase}/api/Auth/loginKey`, {
      method: 'POST',
      headers: {
        Accept: 'text/plain',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userName: this.userName,
        apiKey: this.apiKey
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TopstepX loginKey rejected: ${response.status} ${text}`);
    }

    const payload = await response.json();
    if (!payload?.success || !payload?.token) {
      const message = payload?.errorMessage || 'Missing token in loginKey response';
      const code = Number(payload?.errorCode ?? -1);
      throw new Error(`TopstepX loginKey failed (errorCode=${code}): ${message}`);
    }

    this.sessionToken = payload.token;
    this.lastAuthAt = now;
  }

  async syncLiveAccounts() {
    const response = await this.request('/api/Account/search', { onlyActiveAccounts: true });
    const currentSelected = new Set(state.accounts.filter((account) => account.selected).map((account) => account.id));

    if (!Array.isArray(response?.accounts) || response.accounts.length === 0) {
      appendLog('WARN', 'TopstepX account search returned no active accounts');
      return;
    }

    state.accounts = response.accounts.map((account, index) => {
      const id = String(account.id);
      return {
        id,
        firm: 'TopstepX',
        qty: this.defaultMaxQty,
        status: account.canTrade ? 'OK' : 'WARN',
        pnl: 0,
        sync: 'OK',
        selected: currentSelected.size > 0 ? currentSelected.has(id) : index === 0,
        position: 0,
        tradesToday: 0
      };
    });

    appendLog('INFO', `TopstepX live accounts synced: ${state.accounts.length}`);
  }

  async request(path, body, retryOnUnauthorized = true) {
    await this.authenticate();

    const response = await fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'text/plain',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.sessionToken}`
      },
      body: JSON.stringify(body || {})
    });

    if (response.status === 401 && retryOnUnauthorized) {
      await this.authenticate(true);
      return this.request(path, body, false);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TopstepX request failed ${path}: ${response.status} ${text}`);
    }

    const payload = await response.json();
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'success') && !payload.success) {
      const code = Number(payload?.errorCode ?? -1);
      const message = payload?.errorMessage || `Gateway error at ${path}`;
      throw new Error(`TopstepX request failed ${path} (errorCode=${code}): ${message}`);
    }

    return payload;
  }

  parseAccountId(value) {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const numeric = Number.parseInt(value, 10);
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }

    return null;
  }

  async fetchAvailableContracts() {
    const now = Date.now();
    if (this.contractCache.length > 0 && now - this.contractCacheAt < this.contractCacheTtlMs) {
      return this.contractCache;
    }

    const response = await this.request('/api/Contract/available', { live: true });
    this.contractCache = Array.isArray(response?.contracts) ? response.contracts : [];
    this.contractCacheAt = now;
    return this.contractCache;
  }

  normalizeText(value) {
    return String(value || '')
      .trim()
      .toUpperCase();
  }

  async resolveContractId(instrument, explicitContractId) {
    if (explicitContractId && typeof explicitContractId === 'string') {
      return explicitContractId;
    }

    const mapRaw = process.env.TOPSTEPX_CONTRACT_MAP || '{}';
    let map = {};
    try {
      map = JSON.parse(mapRaw);
    } catch (_error) {
      map = {};
    }

    if (instrument && map[instrument]) {
      return String(map[instrument]);
    }

    const query = this.normalizeText(instrument);
    if (!query) {
      throw new Error('TopstepX order needs contractId or instrument');
    }

    const contracts = await this.fetchAvailableContracts();
    const match = contracts.find((contract) => {
      const id = this.normalizeText(contract.id);
      const name = this.normalizeText(contract.name);
      const symbolId = this.normalizeText(contract.symbolId);
      const description = this.normalizeText(contract.description);
      return id === query || name === query || symbolId === query || description.includes(query);
    });

    if (!match) {
      throw new Error(
        `TopstepX contract not found for instrument "${instrument}". Provide contractId or TOPSTEPX_CONTRACT_MAP.`
      );
    }

    return String(match.id);
  }

  mapOrderToPlaceOrder(order, accountId, contractId) {
    if (!accountId) {
      throw new Error('TopstepX order needs numeric accountId');
    }

    if (!contractId || typeof contractId !== 'string') {
      throw new Error('TopstepX order needs contractId');
    }

    const mapping = {
      BUY_MARKET: { type: 2, side: 0 },
      SELL_MARKET: { type: 2, side: 1 },
      BUY_STOP: { type: 4, side: 0 },
      SELL_STOP: { type: 4, side: 1 }
    };

    const mapped = mapping[order?.orderType];
    if (!mapped) {
      throw new Error(`Unsupported orderType for TopstepX live mode: ${order?.orderType || 'undefined'}`);
    }

    return {
      accountId,
      contractId,
      type: mapped.type,
      side: mapped.side,
      size: Number(order.qty || 1),
      ...(Number.isFinite(order?.limitPrice) ? { limitPrice: Number(order.limitPrice) } : {}),
      ...(Number.isFinite(order?.stopPrice) ? { stopPrice: Number(order.stopPrice) } : {}),
      ...(typeof order?.customTag === 'string' ? { customTag: order.customTag } : {})
    };
  }

  async sendOrder(order) {
    if (order?.topstepxCredentials) {
      return this.sendOrderWithCreds(order, order.topstepxCredentials);
    }

    if (this.mode !== 'live') {
      return {
        ok: true,
        mode: 'paper',
        externalOrderId: `SIM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        acceptedAt: new Date().toISOString(),
        echoedOrder: order
      };
    }

    const accountIds = (order?.accounts || [])
      .map((account) => this.parseAccountId(account))
      .filter((accountId) => Number.isInteger(accountId));

    if (accountIds.length === 0 && Number.isInteger(order?.accountId)) {
      accountIds.push(order.accountId);
    }

    if (accountIds.length === 0) {
      throw new Error('TopstepX order needs at least one numeric accountId');
    }

    const contractId = await this.resolveContractId(order?.instrument, order?.contractId);
    const responses = [];
    for (const accountId of accountIds) {
      const placeOrderPayload = this.mapOrderToPlaceOrder(order, accountId, contractId);
      const response = await this.request('/api/Order/place', placeOrderPayload);
      responses.push({
        accountId,
        ...response,
        externalOrderId: response?.orderId || null
      });
    }

    const response = responses[0];
    return {
      ...response,
      accountResponses: responses
    };
  }

  async flattenAll(accounts) {
    if (this.mode !== 'live') {
      return { ok: true, mode: 'paper', flattenedAccounts: accounts };
    }

    const flattened = [];
    for (const account of accounts || []) {
      const accountId = this.parseAccountId(account);
      if (!accountId) {
        continue;
      }

      const search = await this.request('/api/Position/searchOpen', { accountId });
      for (const position of search?.positions || []) {
        const closeResponse = await this.request('/api/Position/closeContract', {
          accountId,
          contractId: position.contractId
        });

        flattened.push({
          accountId,
          contractId: position.contractId,
          success: Boolean(closeResponse?.success)
        });
      }
    }

    return {
      ok: true,
      flattened
    };
  }

  // ─── Per-credential helpers ──────────────────────────────────────────────────

  _credKey(userName, apiKey) {
    return `${String(userName)}::${String(apiKey)}`;
  }

  async authenticateWithCreds(userName, apiKey, force = false) {
    const key = this._credKey(userName, apiKey);
    const now = Date.now();
    const cached = this.credentialSessions.get(key);

    if (!force && cached?.token && now - cached.lastAuthAt < this.authCooldownMs) {
      return cached.token;
    }

    const response = await fetch(`${this.apiBase}/api/Auth/loginKey`, {
      method: 'POST',
      headers: {
        Accept: 'text/plain',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ userName, apiKey })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TopstepX loginKey rejected for ${userName}: ${response.status} ${text}`);
    }

    const payload = await response.json();
    if (!payload?.success || !payload?.token) {
      const message = payload?.errorMessage || 'Missing token in loginKey response';
      throw new Error(`TopstepX loginKey failed for ${userName}: ${message}`);
    }

    this.credentialSessions.set(key, { token: payload.token, lastAuthAt: now });
    appendLog('INFO', `TopstepX session established for account: ${userName}`);
    return payload.token;
  }

  async requestWithCreds(path, body, creds, retryOnUnauthorized = true) {
    const token = await this.authenticateWithCreds(creds.userName, creds.apiKey);

    const response = await fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: {
        Accept: 'text/plain',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body || {})
    });

    if (response.status === 401 && retryOnUnauthorized) {
      await this.authenticateWithCreds(creds.userName, creds.apiKey, true);
      return this.requestWithCreds(path, body, creds, false);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TopstepX request failed ${path}: ${response.status} ${text}`);
    }

    const payload = await response.json();
    if (payload && Object.prototype.hasOwnProperty.call(payload, 'success') && !payload.success) {
      const code = Number(payload?.errorCode ?? -1);
      const message = payload?.errorMessage || `Gateway error at ${path}`;
      throw new Error(`TopstepX request failed ${path} (errorCode=${code}): ${message}`);
    }

    return payload;
  }

  async sendOrderWithCreds(order, creds) {
    const accountIds = (order?.accounts || [])
      .map((account) => this.parseAccountId(account))
      .filter((accountId) => Number.isInteger(accountId));

    if (accountIds.length === 0 && Number.isInteger(order?.accountId)) {
      accountIds.push(order.accountId);
    }

    if (accountIds.length === 0) {
      throw new Error('TopstepX order needs at least one numeric accountId');
    }

    // Resolve contractId using per-creds request
    let contractId;
    try {
      contractId = await this.resolveContractId(order?.instrument, order?.contractId);
    } catch (_err) {
      // Fallback: fetch contracts using the provided credentials
      const contractsRes = await this.requestWithCreds('/api/Contract/available', { live: true }, creds);
      const contracts = Array.isArray(contractsRes?.contracts) ? contractsRes.contracts : [];
      const query = this.normalizeText(order?.instrument);
      const match = contracts.find((contract) => {
        const id = this.normalizeText(contract.id);
        const name = this.normalizeText(contract.name);
        const symbolId = this.normalizeText(contract.symbolId);
        return id === query || name === query || symbolId === query;
      });
      if (!match) {
        throw new Error(`TopstepX contract not found for instrument "${order?.instrument}"`);
      }
      contractId = String(match.id);
    }

    const responses = [];
    for (const accountId of accountIds) {
      const placeOrderPayload = this.mapOrderToPlaceOrder(order, accountId, contractId);
      const response = await this.requestWithCreds('/api/Order/place', placeOrderPayload, creds);
      responses.push({
        accountId,
        ...response,
        externalOrderId: response?.orderId || null
      });
    }

    const first = responses[0];
    return { ...first, accountResponses: responses };
  }
}
