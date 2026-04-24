export const state = {
  mode: process.env.PANEL_MODE || 'paper',
  connection: {
    engine: 'ACTIVE',
    ws: 'CONNECTED',
    supabase: 'DISCONNECTED',
    topstepx: 'DISCONNECTED',
    lastHeartbeat: null
  },
  risk: {
    maxLossDaily: 1000,
    maxTradesDaily: 5,
    killSwitch: 'armed',
    globalMode: 'auto'
  },
  accounts: [
    { id: 'TSX-01', firm: 'TopstepX', qty: 30, status: 'OK', pnl: 0, sync: 'OK', selected: true, position: 0, tradesToday: 0 },
    { id: 'TSX-02', firm: 'TopstepX', qty: 15, status: 'OK', pnl: 0, sync: 'OK', selected: true, position: 0, tradesToday: 0 },
    { id: 'NT-01', firm: 'Ninja', qty: 10, status: 'OK', pnl: 0, sync: 'OK', selected: false, position: 0, tradesToday: 0 },
    { id: 'APX-01', firm: 'Apex', qty: 5, status: 'WARN', pnl: 0, sync: 'LATE', selected: false, position: 0, tradesToday: 0 }
  ],
  positions: {},
  orders: [],
  logs: [],
  strategyState: {
    coc: { armed: false, config: null },
    orb: { armed: false, config: null }
  },
  market: {
    instrument: 'NQ SEP26',
    price: 18350.0,
    history: []
  }
};

const logListeners = [];

export function onLog(listener) {
  if (typeof listener === 'function') {
    logListeners.push(listener);
  }
}

export function appendLog(level, message, data = null) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: new Date().toISOString(),
    level,
    message,
    data
  };
  state.logs.unshift(entry);
  state.logs = state.logs.slice(0, 300);

  for (const listener of logListeners) {
    try {
      listener(entry);
    } catch (_error) {
      // Keep logging resilient even if an external listener fails.
    }
  }

  return entry;
}

export function getOverview() {
  const totalPnl = state.accounts.reduce((sum, account) => sum + account.pnl, 0);
  return {
    mode: state.mode,
    connection: state.connection,
    risk: state.risk,
    totalPnl,
    market: state.market,
    strategyState: state.strategyState,
    accounts: state.accounts
  };
}

export function patchRisk(partialRisk) {
  state.risk = { ...state.risk, ...partialRisk };
  appendLog('INFO', 'Risk configuration updated', state.risk);
  return state.risk;
}

export function findAccount(accountId) {
  return state.accounts.find((account) => account.id === accountId);
}

export function selectedAccounts() {
  return state.accounts.filter((account) => account.selected).map((account) => account.id);
}

export function updateAccountSelection(accountIds) {
  const set = new Set(accountIds);
  for (const account of state.accounts) {
    account.selected = set.has(account.id);
  }
  appendLog('INFO', 'Account selection updated', { accountIds });
}

export function resetSync(accountIds) {
  const set = new Set(accountIds);
  for (const account of state.accounts) {
    if (set.has(account.id)) {
      account.sync = 'OK';
    }
  }
  appendLog('INFO', 'Account sync reset', { accountIds });
}
