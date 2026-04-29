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
    if (this.mode === 'live' && (!this.userName || !this.apiKey)) {
      state.connection.topstepx = 'DISCONNECTED';
      appendLog('WARN', 'TopstepX live mode ready. Waiting for runtime credentials from frontend.');
      return true;
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

  setRuntimeCredentials(credentials) {
    const userName = String(credentials?.userName || '').trim();
    const apiKey = String(credentials?.apiKey || '').trim();
    if (!userName || !apiKey) {
      throw new Error('TopstepX credentials require userName and apiKey');
    }

    const changed = userName !== this.userName || apiKey !== this.apiKey;
    this.userName = userName;
    this.apiKey = apiKey;

    if (changed) {
      this.sessionToken = '';
      this.lastAuthAt = 0;
      this.contractCache = [];
      this.contractCacheAt = 0;
    }
  }

  async connectWithRuntimeCredentials(credentials) {
    if (this.mode !== 'live') {
      throw new Error('TopstepX runtime login requires PANEL_MODE=live');
    }

    this.setRuntimeCredentials(credentials);
    await this.authenticate(true);
    await this.syncLiveAccounts();
    state.connection.topstepx = 'CONNECTED';

    return {
      connected: true,
      accounts: state.accounts,
      userName: this.userName
    };
  }

  async authenticate(force = false) {
    if (this.mode !== 'live') {
      return;
    }

    if (!this.userName || !this.apiKey) {
      throw new Error('TopstepX credentials are not configured. Connect from frontend first.');
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

  chartEndpointCandidates() {
    const configured = String(process.env.TOPSTEPX_CHART_ENDPOINTS || '').trim();
    if (configured) {
      return configured
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return ['/api/History/retrieveBars', '/api/Chart/getChart', '/api/Quote/getBars'];
  }

  parseBarsFromChartPayload(payload) {
    const candidates = [
      payload?.bars,
      payload?.candles,
      payload?.history,
      payload?.data?.bars,
      payload?.data?.candles,
      payload?.data?.history,
      payload?.chart?.bars,
      payload?.chart?.candles,
      payload?.result?.bars,
      payload?.result?.candles
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate;
      }
    }

    return [];
  }

  normalizeChartBars(rawBars = []) {
    const byTimestamp = new Map();
    for (const bar of rawBars) {
      const rawTs =
        bar?.timestamp || bar?.ts || bar?.time || bar?.startTime || bar?.startTimestamp || bar?.date;
      if (!rawTs) {
        continue;
      }

      const tsMs = new Date(rawTs).getTime();
      if (!Number.isFinite(tsMs)) {
        continue;
      }

      const open = Number(bar?.open ?? bar?.o ?? 0);
      const high = Number(bar?.high ?? bar?.h ?? open);
      const low = Number(bar?.low ?? bar?.l ?? open);
      const close = Number(bar?.close ?? bar?.c ?? open);

      if (![open, high, low, close].every((value) => Number.isFinite(value))) {
        continue;
      }

      byTimestamp.set(tsMs, {
        ts: new Date(tsMs).toISOString(),
        time: Math.floor(tsMs / 1000),
        tsMs,
        open,
        high,
        low,
        close
      });
    }

    return Array.from(byTimestamp.values()).sort((a, b) => a.tsMs - b.tsMs);
  }

  buildChartRequestBodies({ symbol, contractId, asMuchAsElements, elementSize }) {
    const normalizedSymbol = String(symbol || '').trim();
    const size = Math.max(1, Math.min(60, Number(elementSize || 1)));
    const limit = Math.max(20, Math.min(600, Number(asMuchAsElements || 160)));
    const isSeconds = size < 60;

    const shared = {
      live: true,
      contractId,
      symbol: normalizedSymbol,
      asMuchAsElements: limit,
      limit
    };

    return [
      {
        ...shared,
        unit: isSeconds ? 'Second' : 'Minute',
        unitNumber: isSeconds ? size : Math.max(1, Math.floor(size / 60))
      },
      {
        ...shared,
        chartDescription: {
          underlyingType: isSeconds ? 'SecondBar' : 'MinuteBar',
          elementSize: isSeconds ? size : Math.max(1, Math.floor(size / 60)),
          elementSizeUnit: 'UnderlyingUnits',
          withHistogram: false
        },
        timeRange: {
          asMuchAsElements: limit
        }
      },
      {
        ...shared,
        timeframe: isSeconds ? `${size}s` : `${Math.max(1, Math.floor(size / 60))}m`
      }
    ];
  }

  async resolveContractIdWithCreds(instrument, explicitContractId, creds) {
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
      throw new Error('TopstepX chart requires symbol or contractId');
    }

    const contractsRes = await this.requestWithCreds('/api/Contract/available', { live: true }, creds);
    const contracts = Array.isArray(contractsRes?.contracts) ? contractsRes.contracts : [];
    const match = contracts.find((contract) => {
      const id = this.normalizeText(contract.id);
      const name = this.normalizeText(contract.name);
      const symbolId = this.normalizeText(contract.symbolId);
      const description = this.normalizeText(contract.description);
      return id === query || name === query || symbolId === query || description.includes(query);
    });

    if (!match) {
      throw new Error(
        `TopstepX contract not found for symbol "${instrument}". Configure TOPSTEPX_CONTRACT_MAP or send contractId.`
      );
    }

    return String(match.id);
  }

  async requestChartWithCreds(chartPath, body, creds) {
    const payload = await this.requestWithCreds(chartPath, body, creds);
    const bars = this.parseBarsFromChartPayload(payload);
    return this.normalizeChartBars(bars);
  }

  async fetchChartFromCandidates(request, creds) {
    const symbol = String(request?.symbol || request?.instrument || '').trim();
    if (!symbol) {
      throw new Error('TopstepX chart requires symbol');
    }

    const contractId = await this.resolveContractIdWithCreds(symbol, request?.contractId, creds);
    const chartPaths = this.chartEndpointCandidates();
    const bodies = this.buildChartRequestBodies({
      symbol,
      contractId,
      asMuchAsElements: request?.asMuchAsElements,
      elementSize: request?.elementSize
    });

    const errors = [];
    for (const chartPath of chartPaths) {
      for (const body of bodies) {
        try {
          const candles = await this.requestChartWithCreds(chartPath, body, creds);
          if (candles.length > 0) {
            return {
              symbol,
              contractId,
              source: 'topstepx',
              endpoint: chartPath,
              candles
            };
          }
        } catch (error) {
          errors.push(`${chartPath}: ${error.message}`);
        }
      }
    }

    const details = errors.slice(0, 3).join(' | ');
    throw new Error(`TopstepX chart unavailable for ${symbol}. ${details || 'No chart data returned.'}`);
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

  async getChart(request) {
    if (this.mode !== 'live') {
      throw new Error('TopstepX chart requires PANEL_MODE=live');
    }

    if (!this.userName || !this.apiKey) {
      throw new Error('TopstepX chart requires frontend connection (userName/apiKey)');
    }

    return this.fetchChartFromCandidates(request, {
      userName: this.userName,
      apiKey: this.apiKey
    });
  }

  async getChartWithCreds(request, creds) {
    return this.fetchChartFromCandidates(request, creds);
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
