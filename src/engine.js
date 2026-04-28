import { appendLog, findAccount, getOverview, resetSync, selectedAccounts, state, updateAccountSelection } from './state.js';

function applyAccountPnlAndPosition(account, side, qty, fillPrice) {
  const direction = side === 'BUY' ? 1 : -1;
  account.position += direction * qty;

  // Simulate a tiny expected edge/noise profile for paper mode fills.
  const noise = (Math.random() - 0.48) * 12;
  const tradePnl = Number((noise * qty).toFixed(2));
  account.pnl = Number((account.pnl + tradePnl).toFixed(2));
  account.tradesToday += 1;

  return {
    accountId: account.id,
    side,
    qty,
    fillPrice,
    tradePnl,
    runningPnl: account.pnl,
    position: account.position
  };
}

export function setRisk(riskConfig) {
  state.risk = riskConfig;
  appendLog('INFO', 'Risk config applied', riskConfig);
  return state.risk;
}

export function setSelection(accountIds) {
  updateAccountSelection(accountIds);
  return selectedAccounts();
}

export function syncReset(accountIds) {
  resetSync(accountIds);
}

export function assertRiskCanTrade(accounts, qty) {
  if (state.risk.killSwitch !== 'armed') {
    const error = new Error('Kill switch is OFF. Trading blocked by risk policy.');
    error.statusCode = 409;
    throw error;
  }

  const totalPnl = state.accounts.reduce((sum, account) => sum + account.pnl, 0);
  if (totalPnl <= -Math.abs(state.risk.maxLossDaily)) {
    const error = new Error('Daily max loss reached. Trading blocked.');
    error.statusCode = 409;
    throw error;
  }

  for (const accountId of accounts) {
    const account = findAccount(accountId);
    if (!account) {
      // External broker account not mirrored in local state yet.
      continue;
    }
    if (account.tradesToday >= state.risk.maxTradesDaily) {
      const error = new Error(`Max trades reached for account ${accountId}`);
      error.statusCode = 409;
      throw error;
    }
    if (qty > account.qty) {
      const error = new Error(`Requested qty (${qty}) exceeds account max qty (${account.qty}) on ${accountId}`);
      error.statusCode = 409;
      throw error;
    }
  }
}

export function executeManualOrder(orderPayload) {
  assertRiskCanTrade(orderPayload.accounts, orderPayload.qty);

  const side = orderPayload.orderType.startsWith('BUY') ? 'BUY' : 'SELL';
  const fillPrice = state.market.price;
  const fills = [];

  for (const accountId of orderPayload.accounts) {
    const account = findAccount(accountId);
    if (!account) {
      fills.push({
        accountId,
        side,
        qty: orderPayload.qty,
        fillPrice,
        tradePnl: 0,
        runningPnl: 0,
        position: 0,
        external: true
      });
      continue;
    }
    fills.push(applyAccountPnlAndPosition(account, side, orderPayload.qty, fillPrice));
  }

  const orderEvent = {
    id: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    ts: new Date().toISOString(),
    kind: 'manual',
    order: orderPayload,
    fills
  };

  state.orders.unshift(orderEvent);
  state.orders = state.orders.slice(0, 500);

  appendLog('INFO', `Manual order executed: ${orderPayload.orderType}`, orderEvent);
  return orderEvent;
}

export function reversePositions(payload) {
  assertRiskCanTrade(payload.accounts, 1);
  const fills = [];

  for (const accountId of payload.accounts) {
    const account = findAccount(accountId);
    if (!account) continue;

    const qty = Math.abs(account.position) || 1;
    const side = account.position >= 0 ? 'SELL' : 'BUY';
    fills.push(applyAccountPnlAndPosition(account, side, qty * 2, state.market.price));
  }

  const event = {
    id: `REV-${Date.now()}`,
    ts: new Date().toISOString(),
    kind: 'reverse',
    payload,
    fills
  };

  appendLog('WARN', 'Positions reversed', event);
  return event;
}

export function flattenAll(payload) {
  const fills = [];

  for (const accountId of payload.accounts) {
    const account = findAccount(accountId);
    if (!account) continue;
    if (account.position === 0) continue;

    const side = account.position > 0 ? 'SELL' : 'BUY';
    fills.push(applyAccountPnlAndPosition(account, side, Math.abs(account.position), state.market.price));
    account.position = 0;
  }

  const event = {
    id: `FLT-${Date.now()}`,
    ts: new Date().toISOString(),
    kind: 'flatten-all',
    payload,
    fills
  };

  appendLog('WARN', 'Flatten all executed', event);
  return event;
}

export function cancelAll(payload) {
  const event = {
    id: `CXL-${Date.now()}`,
    ts: new Date().toISOString(),
    kind: 'cancel-all',
    payload
  };

  appendLog('INFO', 'Cancel all acknowledged', event);
  return event;
}

export function armStrategy(kind, config) {
  if (kind === 'COC') {
    state.strategyState.coc = {
      armed: config.enabled,
      config
    };
  }

  if (kind === 'ORB') {
    state.strategyState.orb = {
      armed: config.enabled,
      config
    };
  }

  appendLog('INFO', `${kind} strategy updated`, config);
  return state.strategyState;
}

export function evaluateStrategies(marketEvent) {
  const events = [];

  const sma = marketEvent.indicators.sma20;
  const ema = marketEvent.indicators.ema20;
  if (!sma || !ema) {
    return events;
  }

  if (state.strategyState.coc.armed && ema > sma && Math.abs(marketEvent.change) > 2.5) {
    const cfg = state.strategyState.coc.config;
    const payload = {
      ...cfg.baseOrder,
      orderType: 'BUY_MARKET',
      qty: Math.max(1, cfg.baseOrder.qty)
    };
    const result = executeManualOrder(payload);
    events.push({ type: 'strategy_fill', strategy: 'COC', result });
  }

  if (state.strategyState.orb.armed && ema < sma && Math.abs(marketEvent.change) > 2.5) {
    const cfg = state.strategyState.orb.config;
    const payload = {
      ...cfg.baseOrder,
      orderType: 'SELL_MARKET',
      qty: Math.max(1, cfg.baseOrder.qty)
    };
    const result = executeManualOrder(payload);
    events.push({ type: 'strategy_fill', strategy: 'ORB', result });
  }

  return events;
}

export function getSnapshot() {
  return {
    overview: getOverview(),
    orders: state.orders.slice(0, 40),
    logs: state.logs.slice(0, 100)
  };
}
