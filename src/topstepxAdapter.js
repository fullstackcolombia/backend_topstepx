import { appendLog, state } from './state.js';

function toQuery(params = {}) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) {
    return '';
  }

  const search = new URLSearchParams();
  for (const [key, value] of entries) {
    search.append(key, String(value));
  }

  return `?${search.toString()}`;
}

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
    this.chartCache = new Map();
    this.chartCacheTtlMs = 4 * 1000;
    this.chartBackoffUntil = new Map();
    this.chartBackoffMs = 30 * 1000;
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
      this.chartCache.clear();
      this.chartBackoffUntil.clear();
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

    const payload = await this.parseJsonOrThrow(response, 'TopstepX loginKey');
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

    const payload = await this.parseJsonOrThrow(response, `TopstepX request ${path}`);
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

  extractContractIdPrefix(candidateIds = []) {
    for (const id of candidateIds) {
      const value = String(id || '').trim();
      const marker = value.lastIndexOf('.');
      if (marker > 0) {
        return value.slice(0, marker + 1);
      }
    }
    return 'CON.F.US.';
  }

  deriveContractIdsFromInstrument(instrument, candidateIds = []) {
    const raw = this.normalizeText(instrument).replace(/\s+/g, ' ').trim();
    const match = raw.match(/^([A-Z]{1,4})\s+([A-Z]{3})(\d{2})$/);
    if (!match) {
      return [];
    }

    const [, root, monthTxt, yy] = match;
    const monthCodeByText = {
      JAN: 'F',
      FEB: 'G',
      MAR: 'H',
      APR: 'J',
      MAY: 'K',
      JUN: 'M',
      JUL: 'N',
      AUG: 'Q',
      SEP: 'U',
      OCT: 'V',
      NOV: 'X',
      DEC: 'Z'
    };

    const monthCode = monthCodeByText[monthTxt];
    if (!monthCode) {
      return [];
    }

    const suffix = `${root}${monthCode}${yy}`;
    const prefix = this.extractContractIdPrefix(candidateIds);
    return [
      `${prefix}${suffix}`,
      suffix
    ];
  }

  chartEndpointCandidates() {
    const configured = String(process.env.TOPSTEPX_CHART_ENDPOINTS || '').trim();
    if (configured) {
      return configured
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    return ['/api/History/retrieveBars'];
  }

  async parseJsonOrThrow(response, contextLabel) {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const raw = await response.text();
    const trimmed = raw.trim();
    const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');

    if (!contentType.includes('application/json') && !looksJson) {
      const sample = trimmed.slice(0, 120).replace(/\s+/g, ' ');
      throw new Error(`${contextLabel}: non-JSON response (${response.status}) ${sample}`);
    }

    try {
      return JSON.parse(raw);
    } catch (_error) {
      const sample = trimmed.slice(0, 120).replace(/\s+/g, ' ');
      throw new Error(`${contextLabel}: invalid JSON (${response.status}) ${sample}`);
    }
  }

  parseBarsFromChartPayload(payload) {
    const candidates = [
      Array.isArray(payload) ? payload : null,
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
        bar?.t || bar?.timestamp || bar?.ts || bar?.time || bar?.startTime || bar?.startTimestamp || bar?.date;
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

  buildRetrieveBarsVariants(body) {
    const contractId = String(body?.contractId || '').trim();
    const limit = Math.max(60, Math.min(600, Number(body?.limit || body?.asMuchAsElements || 160)));

    const rawUnit = String(body?.unit || '').toLowerCase();
    const requestedUnitNumber = Math.max(1, Number(body?.unitNumber || 1));
    const isSeconds = rawUnit.includes('sec');
    const unitNumber = requestedUnitNumber;

    const barMs = (isSeconds ? 1000 : 60_000) * unitNumber;
    const now = Date.now();
    const startTime = new Date(now - barMs * (limit + 20)).toISOString();
    const endTime = new Date(now).toISOString();

    // AggregateBarUnit enum from Swagger: 1=Second, 2=Minute.
    const unitCandidates = isSeconds ? [1, 2] : [2, 1];
    const liveCandidates = [true, false];
    const variants = [];

    for (const unit of unitCandidates) {
      for (const live of liveCandidates) {
        const corePayload = {
          contractId,
          live,
          startTime,
          endTime,
          unit,
          unitNumber,
          limit,
          includePartialBar: false
        };

        // Swagger describes RetrieveBarRequest as the direct body schema.
        variants.push(corePayload);
      }
    }

    return variants;
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

  async resolveChartContractCandidatesWithCreds(instrument, explicitContractId, creds) {
    if (explicitContractId && typeof explicitContractId === 'string') {
      return [String(explicitContractId)];
    }

    const mapRaw = process.env.TOPSTEPX_CONTRACT_MAP || '{}';
    let map = {};
    try {
      map = JSON.parse(mapRaw);
    } catch (_error) {
      map = {};
    }

    const candidates = [];
    if (instrument && map[instrument]) {
      candidates.push(String(map[instrument]));
    }

    const query = this.normalizeText(instrument);
    const leadToken = query.split(/\s+/)[0] || query;

    const allContracts = [];
    try {
      const search = await this.requestWithCreds('/api/Contract/search', { searchText: instrument, live: true }, creds);
      if (Array.isArray(search?.contracts)) {
        allContracts.push(...search.contracts);
      }
    } catch (_error) {
      // keep fallback paths
    }

    try {
      const searchLead = await this.requestWithCreds('/api/Contract/search', { searchText: leadToken, live: true }, creds);
      if (Array.isArray(searchLead?.contracts)) {
        allContracts.push(...searchLead.contracts);
      }
    } catch (_error) {
      // keep fallback paths
    }

    try {
      const available = await this.requestWithCreds('/api/Contract/available', { live: true }, creds);
      if (Array.isArray(available?.contracts)) {
        allContracts.push(...available.contracts);
      }
    } catch (_error) {
      // keep fallback paths
    }

    const scored = [];
    for (const contract of allContracts) {
      const id = String(contract?.id || '').trim();
      const altId = String(contract?.symbolId || '').trim();
      if (!id) {
        continue;
      }

      const name = this.normalizeText(contract?.name);
      const symbolId = this.normalizeText(contract?.symbolId);
      const description = this.normalizeText(contract?.description);
      let score = 0;

      if (query && (name === query || symbolId === query || description === query || id === query)) {
        score += 100;
      }
      if (query && (name.includes(query) || symbolId.includes(query) || description.includes(query))) {
        score += 40;
      }
      if (leadToken && (name.includes(leadToken) || symbolId.includes(leadToken) || description.includes(leadToken))) {
        score += 20;
      }
      if (contract?.activeContract === true) {
        score += 30;
      }

      scored.push({ id, score });
      if (altId) {
        scored.push({ id: altId, score: score - 5 });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    for (const item of scored) {
      candidates.push(item.id);
    }

    const derived = this.deriveContractIdsFromInstrument(instrument, candidates);
    for (const id of derived) {
      candidates.push(id);
    }

    const unique = [];
    const seen = new Set();
    for (const id of candidates) {
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(id);
      }
    }

    if (unique.length === 0) {
      throw new Error(`TopstepX contract not found for symbol "${instrument}".`);
    }

    return unique.slice(0, 5);
  }

  async requestChartWithCreds(chartPath, body, creds) {
    if (String(chartPath).toLowerCase().includes('/api/history/retrievebars')) {
      const variants = this.buildRetrieveBarsVariants(body);
      const variantErrors = [];

      for (const variant of variants) {
        try {
          const payload = await this.requestWithCreds(chartPath, variant, creds, true, { method: 'POST' });
          const bars = this.parseBarsFromChartPayload(payload);
          if (bars.length > 0) {
            return this.normalizeChartBars(bars);
          }
        } catch (error) {
          variantErrors.push(error.message);
        }
      }

      const short = variantErrors.slice(0, 2).join(' | ');
      throw new Error(short || 'retrieveBars returned no candles');
    }

    const postPayload = await this.requestWithCreds(chartPath, body, creds, true, { method: 'POST' });
    let bars = this.parseBarsFromChartPayload(postPayload);
    if (bars.length > 0) {
      return this.normalizeChartBars(bars);
    }

    const getPayload = await this.requestWithCreds(chartPath, body, creds, true, {
      method: 'GET',
      query: body
    });
    bars = this.parseBarsFromChartPayload(getPayload);
    return this.normalizeChartBars(bars);
  }

  async fetchChartFromCandidates(request, creds) {
    const symbol = String(request?.symbol || request?.instrument || '').trim();
    if (!symbol) {
      throw new Error('TopstepX chart requires symbol');
    }

    const contractIds = await this.resolveChartContractCandidatesWithCreds(symbol, request?.contractId, creds);
    const cacheKey = `${creds.userName}::${symbol}::${request?.elementSize || 1}::${request?.asMuchAsElements || 160}`;
    const now = Date.now();

    const cached = this.chartCache.get(cacheKey);
    if (cached && now - cached.at < this.chartCacheTtlMs) {
      return cached.chart;
    }

    const blockedUntil = Number(this.chartBackoffUntil.get(cacheKey) || 0);
    if (blockedUntil > now && cached?.chart?.candles?.length > 0) {
      return cached.chart;
    }

    const errors = [];
    for (const contractId of contractIds) {
      const chartPaths = this.chartEndpointCandidates();
      const bodies = this.buildChartRequestBodies({
        symbol,
        contractId,
        asMuchAsElements: request?.asMuchAsElements,
        elementSize: request?.elementSize
      });

      for (const chartPath of chartPaths) {
        const pathKey = String(chartPath || '').toLowerCase();
        const pathBodies = pathKey.includes('/api/history/retrievebars') ? bodies.slice(0, 1) : bodies;
        for (const body of pathBodies) {
          try {
            const candles = await this.requestChartWithCreds(chartPath, body, creds);
            if (candles.length > 0) {
              const chart = {
                symbol,
                contractId,
                source: 'topstepx',
                endpoint: chartPath,
                candles
              };
              this.chartCache.set(cacheKey, { at: now, chart });
              this.chartBackoffUntil.delete(cacheKey);
              return chart;
            }
          } catch (error) {
            errors.push(`${chartPath}:${contractId}: ${error.message}`);
          }
        }
      }
    }

    const mergedErrors = errors.join(' | ');
    if (mergedErrors.includes(' 429') || mergedErrors.includes(': 429')) {
      this.chartBackoffUntil.set(cacheKey, now + this.chartBackoffMs);
      if (cached?.chart?.candles?.length > 0) {
        return cached.chart;
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

    const payload = await this.parseJsonOrThrow(response, `TopstepX loginKey ${userName}`);
    if (!payload?.success || !payload?.token) {
      const message = payload?.errorMessage || 'Missing token in loginKey response';
      throw new Error(`TopstepX loginKey failed for ${userName}: ${message}`);
    }

    this.credentialSessions.set(key, { token: payload.token, lastAuthAt: now });
    appendLog('INFO', `TopstepX session established for account: ${userName}`);
    return payload.token;
  }

  async requestWithCreds(path, body, creds, retryOnUnauthorized = true, options = {}) {
    const token = await this.authenticateWithCreds(creds.userName, creds.apiKey);
    const method = String(options?.method || 'POST').toUpperCase();
    const query = options?.query || null;
    const endpoint = `${this.apiBase}${path}${method === 'GET' ? toQuery(query || {}) : ''}`;

    const response = await fetch(endpoint, {
      method,
      headers: {
        Accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body || {}) })
    });

    if (response.status === 401 && retryOnUnauthorized) {
      await this.authenticateWithCreds(creds.userName, creds.apiKey, true);
      return this.requestWithCreds(path, body, creds, false, options);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TopstepX request failed ${path}: ${response.status} ${text}`);
    }

    const payload = await this.parseJsonOrThrow(response, `TopstepX request ${path}`);
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
