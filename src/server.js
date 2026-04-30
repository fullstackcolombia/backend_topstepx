import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { z } from 'zod';

import {
  armStrategy,
  cancelAll,
  evaluateStrategies,
  executeManualOrder,
  flattenAll,
  getSnapshot,
  reversePositions,
  setRisk,
  setSelection,
  syncReset
} from './engine.js';
import { tickMarket } from './marketSimulator.js';
import { appendLog, getEsparPairs, getOverview, onLog, setEsparPairs, state } from './state.js';
import {
  baseOrderSchema,
  cocSchema,
  esparPairsSchema,
  orbSchema,
  parseOrThrow,
  reverseSchema,
  riskSchema,
  simpleAccountsSchema
} from './validators.js';
import { TopstepxAdapter } from './topstepxAdapter.js';
import { TradovateAdapter } from './tradovateAdapter.js';
import { PersistenceService } from './persistence.js';
import { registerSwagger } from './swagger.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const adapter = new TopstepxAdapter();
const tradovate = new TradovateAdapter();
const persistence = new PersistenceService();

const corsOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeOrigin(value) {
  if (!value) {
    return '';
  }

  try {
    return new URL(value).origin;
  } catch (_error) {
    return String(value).trim();
  }
}

function originMatchesPattern(pattern, origin) {
  const normalizedPattern = normalizeOrigin(pattern);
  const normalizedOrigin = normalizeOrigin(origin);

  if (!normalizedPattern || !normalizedOrigin) {
    return false;
  }

  if (normalizedPattern === '*' || normalizedPattern === normalizedOrigin) {
    return true;
  }

  if (!normalizedPattern.includes('*')) {
    return false;
  }

  const regex = new RegExp(`^${escapeRegex(normalizedPattern).replace(/\\\*/g, '.*')}$`);
  return regex.test(normalizedOrigin);
}

function isOriginAllowed(origin) {
  // Allow non-browser clients that do not send Origin.
  if (!origin) {
    return true;
  }

  // If no allowlist is configured, keep a permissive fallback.
  if (corsOrigins.length === 0) {
    return true;
  }

  return corsOrigins.some((allowedOrigin) => originMatchesPattern(allowedOrigin, origin));
}

const corsOptions = {
  origin(origin, callback) {
    callback(null, isOriginAllowed(origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
};

onLog((entry) => {
  persistence.persistLog(entry);
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.static('.'));
registerSwagger(app);

function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function ok(res, data) {
  res.status(200).json({ ok: true, data });
}

app.get('/api/health', (_req, res) => {
  ok(res, {
    service: 'panel-topstepx',
    mode: state.mode,
    ts: new Date().toISOString()
  });
});

app.get('/api/accounts', (_req, res) => {
  ok(res, state.accounts);
});

app.post('/api/accounts/selection', (req, res, next) => {
  try {
    const payload = parseOrThrow(simpleAccountsSchema, req.body);
    ok(res, setSelection(payload.accounts));
  } catch (error) {
    next(error);
  }
});

app.get('/api/state/overview', (_req, res) => {
  ok(res, getOverview());
});

app.get('/api/state/snapshot', (_req, res) => {
  ok(res, getSnapshot());
});

app.get('/api/espar/pairs', (_req, res) => {
  ok(res, { pairs: getEsparPairs() });
});

app.post('/api/espar/pairs', (req, res, next) => {
  try {
    const payload = parseOrThrow(esparPairsSchema, req.body);
    const saved = setEsparPairs(payload.pairs);
    ok(res, { pairs: saved });
  } catch (error) {
    next(error);
  }
});

app.post('/api/risk/config', (req, res, next) => {
  try {
    const payload = parseOrThrow(riskSchema, req.body);
    const risk = setRisk(payload);
    ok(res, risk);
    persistence.persistRiskConfig(risk);
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders/manual', async (req, res, next) => {
  try {
    const payload = parseOrThrow(baseOrderSchema, req.body);
    const broker = String(payload?.broker || (payload?.tradovateCredentials ? 'tradovate' : 'topstepx'));

    let brokerResponse = null;
    if (broker === 'tradovate') {
      if (state.mode !== 'live') {
        const error = new Error('Tradovate requires PANEL_MODE=live');
        error.statusCode = 409;
        throw error;
      }

      if (!payload?.tradovateCredentials) {
        const error = new Error('Tradovate order requires tradovateCredentials');
        error.statusCode = 400;
        throw error;
      }

      const tvEnv = String(payload?.tradovateCredentials?.environment || 'live').toLowerCase();
      if (tvEnv !== 'live') {
        const error = new Error('Tradovate live mode only: set credentials.environment="live"');
        error.statusCode = 400;
        throw error;
      }

      const action = payload.orderType.startsWith('BUY') ? 'Buy' : 'Sell';
      const accountId = Number(payload.tradovateAccountId ?? payload.accounts?.[0]);
      brokerResponse = await tradovate.placeOrderWithCreds(
        {
          action,
          symbol: payload.instrument,
          orderQty: payload.qty,
          orderType: 'Market',
          accountId: Number.isInteger(accountId) ? accountId : undefined,
          accountSpec: payload.tradovateAccountSpec
        },
        payload.tradovateCredentials
      );
    } else {
      brokerResponse = await adapter.sendOrder(payload);
    }

    const execution = executeManualOrder(payload);
    ok(res, { ...execution, broker, brokerResponse });
    broadcast({ type: 'order_executed', data: execution });
    persistence.persistTradeEvent(execution, payload.instrument);
  } catch (error) {
    next(error);
  }
});

app.post('/api/topstepx/accounts', async (req, res, next) => {
  try {
    if (state.mode !== 'live') {
      const error = new Error('TopstepX requires PANEL_MODE=live');
      error.statusCode = 409;
      throw error;
    }

    const payload = parseOrThrow(
      z.object({
        credentials: z.object({
          userName: z.string().min(1),
          apiKey: z.string().min(8)
        })
      }),
      req.body
    );

    const result = await adapter.requestWithCreds('/api/Account/search', { onlyActiveAccounts: true }, payload.credentials);
    ok(res, { accounts: Array.isArray(result?.accounts) ? result.accounts : [] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/topstepx/connect', async (req, res, next) => {
  try {
    if (state.mode !== 'live') {
      const error = new Error('TopstepX requires PANEL_MODE=live');
      error.statusCode = 409;
      throw error;
    }

    const payload = parseOrThrow(
      z.object({
        credentials: z.object({
          userName: z.string().min(1),
          apiKey: z.string().min(8)
        })
      }),
      req.body
    );

    const result = await adapter.connectWithRuntimeCredentials(payload.credentials);
    ok(res, result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/topstepx/chart', async (req, res, next) => {
  try {
    if (state.mode !== 'live') {
      const error = new Error('TopstepX requires PANEL_MODE=live');
      error.statusCode = 409;
      throw error;
    }

    const payload = parseOrThrow(
      z.object({
        credentials: z
          .object({
            userName: z.string().min(1),
            apiKey: z.string().min(8)
          })
          .optional(),
        symbol: z.string().min(1),
        contractId: z.string().min(1).optional(),
        accountId: z.union([z.string().min(1), z.number().int().min(1)]).optional(),
        liveHint: z.boolean().optional(),
        asMuchAsElements: z.number().int().min(20).max(600).optional(),
        elementSize: z.number().int().min(1).max(60).optional()
      }),
      req.body
    );

    const chartRequest = {
      symbol: payload.symbol,
      contractId: payload.contractId,
      accountId: payload.accountId,
      liveHint: payload.liveHint,
      asMuchAsElements: payload.asMuchAsElements,
      elementSize: payload.elementSize
    };

    const chart = payload.credentials
      ? await adapter.getChartWithCreds(chartRequest, payload.credentials)
      : await adapter.getChart(chartRequest);

    ok(res, chart);
  } catch (error) {
    next(error);
  }
});

app.post('/api/tradovate/accounts', async (req, res, next) => {
  try {
    if (state.mode !== 'live') {
      const error = new Error('Tradovate requires PANEL_MODE=live');
      error.statusCode = 409;
      throw error;
    }

    const payload = parseOrThrow(
      z.object({
        credentials: z.object({
          name: z.string().min(1),
          password: z.string().min(1),
          appId: z.string().min(1).optional(),
          appVersion: z.string().min(1).optional(),
          cid: z.number().int().min(0).optional(),
          sec: z.string().min(1).optional(),
          environment: z.enum(['demo', 'live']).optional()
        })
      }),
      req.body
    );

    const tvEnv = String(payload?.credentials?.environment || 'live').toLowerCase();
    if (tvEnv !== 'live') {
      const error = new Error('Tradovate live mode only: set credentials.environment="live"');
      error.statusCode = 400;
      throw error;
    }

    const accounts = await tradovate.listAccountsWithCreds(payload.credentials);
    ok(res, { accounts });
  } catch (error) {
    next(error);
  }
});

app.post('/api/tradovate/chart', async (req, res, next) => {
  try {
    if (state.mode !== 'live') {
      const error = new Error('Tradovate requires PANEL_MODE=live');
      error.statusCode = 409;
      throw error;
    }

    const payload = parseOrThrow(
      z.object({
        credentials: z.object({
          name: z.string().min(1),
          password: z.string().min(1),
          appId: z.string().min(1).optional(),
          appVersion: z.string().min(1).optional(),
          cid: z.number().int().min(0).optional(),
          sec: z.string().min(1).optional(),
          environment: z.enum(['demo', 'live']).optional()
        }),
        symbol: z.string().min(1),
        asMuchAsElements: z.number().int().min(20).max(600).optional(),
        elementSize: z.number().int().min(1).max(60).optional()
      }),
      req.body
    );

    const tvEnv = String(payload?.credentials?.environment || 'live').toLowerCase();
    if (tvEnv !== 'live') {
      const error = new Error('Tradovate live mode only: set credentials.environment="live"');
      error.statusCode = 400;
      throw error;
    }

    const chart = await tradovate.getChartWithCreds(
      {
        symbol: payload.symbol,
        asMuchAsElements: payload.asMuchAsElements,
        elementSize: payload.elementSize
      },
      payload.credentials
    );

    ok(res, chart);
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders/cancel-all', (req, res, next) => {
  try {
    const payload = parseOrThrow(simpleAccountsSchema, req.body);
    const result = cancelAll(payload);
    ok(res, result);
    broadcast({ type: 'cancel_all', data: result });
    persistence.persistTradeEvent(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders/flatten-all', async (req, res, next) => {
  try {
    const payload = parseOrThrow(simpleAccountsSchema, req.body);
    const result = flattenAll(payload);
    await adapter.flattenAll(payload.accounts);
    ok(res, result);
    broadcast({ type: 'flatten_all', data: result });
    persistence.persistTradeEvent(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders/reverse', (req, res, next) => {
  try {
    const payload = parseOrThrow(reverseSchema, req.body);
    const result = reversePositions(payload);
    ok(res, result);
    broadcast({ type: 'reverse', data: result });
    persistence.persistTradeEvent(result, payload.instrument);
  } catch (error) {
    next(error);
  }
});

app.post('/api/replicator/sync-reset', (req, res, next) => {
  try {
    const payload = parseOrThrow(simpleAccountsSchema, req.body);
    syncReset(payload.accounts);
    ok(res, { reset: payload.accounts.length });
    broadcast({ type: 'sync_reset', data: payload });
  } catch (error) {
    next(error);
  }
});

app.post('/api/strategies/coc/arm', (req, res, next) => {
  try {
    const payload = parseOrThrow(cocSchema, req.body);
    const strategyState = armStrategy('COC', payload);
    ok(res, strategyState);
    persistence.persistStrategyConfig('COC', payload);
  } catch (error) {
    next(error);
  }
});

app.post('/api/strategies/orb/arm', (req, res, next) => {
  try {
    const payload = parseOrThrow(orbSchema, req.body);
    const strategyState = armStrategy('ORB', payload);
    ok(res, strategyState);
    persistence.persistStrategyConfig('ORB', payload);
  } catch (error) {
    next(error);
  }
});

app.post('/api/strategies/:id/toggle', (req, res, next) => {
  try {
    const id = String(req.params.id || '').toLowerCase();
    const payload = parseOrThrow(
      simpleAccountsSchema.extend({
        enabled: z.boolean()
      }),
      req.body
    );

    if (id !== 'coc' && id !== 'orb') {
      const error = new Error(`Unknown strategy id: ${id}`);
      error.statusCode = 404;
      throw error;
    }

    const key = id.toUpperCase();
    const existing = id === 'coc' ? state.strategyState.coc.config : state.strategyState.orb.config;
    if (!existing) {
      const error = new Error(`Strategy ${key} is not configured. Arm it first.`);
      error.statusCode = 409;
      throw error;
    }

    const patched = { ...existing, accounts: payload.accounts, enabled: payload.enabled };
    const strategyState = armStrategy(key, patched);
    ok(res, strategyState);
    persistence.persistStrategyConfig(key, patched);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  const message = error.message || 'Internal server error';
  appendLog('ERROR', message);
  res.status(status).json({ ok: false, error: message });
});

wss.on('connection', (socket, request) => {
  if (!isOriginAllowed(request.headers.origin)) {
    appendLog('WARN', 'WS origin rejected', { origin: request.headers.origin || null });
    socket.close(1008, 'Origin not allowed');
    return;
  }

  socket.send(JSON.stringify({ type: 'snapshot', data: getSnapshot() }));
});

setInterval(() => {
  state.connection.lastHeartbeat = new Date().toISOString();
  const tick = tickMarket();
  const strategyEvents = evaluateStrategies(tick);
  const overview = getOverview();

  broadcast({ type: 'market_tick', data: tick });
  if (strategyEvents.length > 0) {
    for (const event of strategyEvents) {
      broadcast(event);
      persistence.persistTradeEvent(event.result, event.result.order?.instrument || tick.instrument);
    }
  }
  broadcast({ type: 'overview', data: overview });

  persistence.persistMarketTick(tick);
  persistence.maybePersistSnapshot(overview);
}, 1000);

const port = Number(process.env.PORT || 8787);

Promise.all([adapter.connect(), tradovate.connect(), persistence.initialize()]).finally(() => {
  server.listen(port, () => {
    appendLog('INFO', `Server running on http://localhost:${port}`);
    console.log(`Panel TopstepX running on http://localhost:${port}`);
  });
});
