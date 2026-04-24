import { appendLog, state } from './state.js';

export class TopstepxAdapter {
  constructor() {
    this.mode = process.env.PANEL_MODE || 'paper';
    this.apiBase = process.env.TOPSTEPX_API_BASE || '';
    this.apiKey = process.env.TOPSTEPX_API_KEY || '';
    this.apiSecret = process.env.TOPSTEPX_API_SECRET || '';
  }

  async connect() {
    if (this.mode === 'live' && (!this.apiBase || !this.apiKey || !this.apiSecret)) {
      state.connection.topstepx = 'ERROR';
      appendLog('ERROR', 'TopstepX live mode needs TOPSTEPX_API_BASE, TOPSTEPX_API_KEY, TOPSTEPX_API_SECRET');
      return false;
    }
    state.connection.topstepx = this.mode === 'live' ? 'CONNECTED' : 'SIMULATED';
    appendLog('INFO', `TopstepX adapter ready in ${this.mode} mode`);
    return true;
  }

  async sendOrder(order) {
    if (this.mode !== 'live') {
      return {
        ok: true,
        mode: 'paper',
        externalOrderId: `SIM-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        acceptedAt: new Date().toISOString(),
        echoedOrder: order
      };
    }

    // Keep the live adapter explicit and conservative until API details are confirmed.
    const headers = {
      'Content-Type': 'application/json',
      'X-API-KEY': this.apiKey,
      'X-API-SECRET': this.apiSecret
    };

    const response = await fetch(`${this.apiBase}/orders`, {
      method: 'POST',
      headers,
      body: JSON.stringify(order)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TopstepX order rejected: ${response.status} ${text}`);
    }

    return response.json();
  }

  async flattenAll(accounts) {
    if (this.mode !== 'live') {
      return { ok: true, mode: 'paper', flattenedAccounts: accounts };
    }

    const response = await fetch(`${this.apiBase}/orders/flatten-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': this.apiKey,
        'X-API-SECRET': this.apiSecret
      },
      body: JSON.stringify({ accounts })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TopstepX flatten-all rejected: ${response.status} ${text}`);
    }

    return response.json();
  }
}
