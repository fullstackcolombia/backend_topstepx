import { getSupabaseClient } from './supabaseClient.js';
import { state } from './state.js';

export class PersistenceService {
  constructor() {
    const { client, enabled, reason } = getSupabaseClient();
    this.client = client;
    this.enabled = enabled;
    this.reason = reason;
    this.snapshotCounter = 0;
  }

  async initialize() {
    if (!this.enabled || !this.client) {
      state.connection.supabase = 'DISABLED';
      return { enabled: false, reason: this.reason };
    }

    const { error } = await this.client.from('app_logs').select('id').limit(1);
    if (error) {
      state.connection.supabase = 'ERROR';
      return { enabled: false, reason: error.message };
    }

    state.connection.supabase = 'CONNECTED';
    await this.hydrateState();
    return { enabled: true, reason: 'Supabase connected' };
  }

  async hydrateState() {
    if (!this.enabled || !this.client) {
      return;
    }

    const [riskRes, cocRes, orbRes] = await Promise.all([
      this.client.from('risk_configs').select('config').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      this.client.from('strategy_configs').select('config, enabled').eq('strategy_name', 'COC').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      this.client.from('strategy_configs').select('config, enabled').eq('strategy_name', 'ORB').order('updated_at', { ascending: false }).limit(1).maybeSingle()
    ]);

    if (!riskRes.error && riskRes.data?.config) {
      state.risk = riskRes.data.config;
    }

    if (!cocRes.error && cocRes.data?.config) {
      state.strategyState.coc = {
        armed: Boolean(cocRes.data.enabled),
        config: cocRes.data.config
      };
    }

    if (!orbRes.error && orbRes.data?.config) {
      state.strategyState.orb = {
        armed: Boolean(orbRes.data.enabled),
        config: orbRes.data.config
      };
    }
  }

  async persistLog(entry) {
    if (!this.enabled || !this.client || !entry) {
      return;
    }

    const { error } = await this.client.from('app_logs').insert({
      ts: entry.ts,
      level: entry.level,
      message: entry.message,
      data: entry.data
    });

    if (error) {
      console.error('Supabase persistLog error:', error.message);
    }
  }

  async persistRiskConfig(risk) {
    if (!this.enabled || !this.client) {
      return;
    }

    const { error } = await this.client.from('risk_configs').insert({
      max_loss_daily: risk.maxLossDaily,
      max_trades_daily: risk.maxTradesDaily,
      kill_switch: risk.killSwitch,
      global_mode: risk.globalMode,
      config: risk
    });

    if (error) {
      console.error('Supabase persistRiskConfig error:', error.message);
    }
  }

  async persistStrategyConfig(strategyName, config) {
    if (!this.enabled || !this.client) {
      return;
    }

    const { error } = await this.client.from('strategy_configs').insert({
      strategy_name: strategyName,
      enabled: Boolean(config.enabled),
      accounts: config.accounts || [],
      config,
      updated_at: new Date().toISOString()
    });

    if (error) {
      console.error('Supabase persistStrategyConfig error:', error.message);
    }
  }

  async persistTradeEvent(event, instrument = null) {
    if (!this.enabled || !this.client) {
      return;
    }

    const payload = {
      event_id: event.id,
      ts: event.ts,
      kind: event.kind,
      instrument,
      accounts: event.order?.accounts || event.payload?.accounts || [],
      payload: event,
      fills: event.fills || null,
      source: 'panel-topstepx'
    };

    const { error } = await this.client.from('trade_events').insert(payload);
    if (error && !error.message.toLowerCase().includes('duplicate')) {
      console.error('Supabase persistTradeEvent error:', error.message);
    }
  }

  async persistMarketTick(tick) {
    if (!this.enabled || !this.client) {
      return;
    }

    const { error } = await this.client.from('market_ticks').insert({
      ts: tick.ts,
      instrument: tick.instrument,
      price: tick.price,
      change: tick.change,
      indicators: tick.indicators
    });

    if (error) {
      console.error('Supabase persistMarketTick error:', error.message);
    }
  }

  async maybePersistSnapshot(overview) {
    if (!this.enabled || !this.client) {
      return;
    }

    this.snapshotCounter += 1;
    if (this.snapshotCounter % 10 !== 0) {
      return;
    }

    const { error } = await this.client.from('account_snapshots').insert({
      total_pnl: overview.totalPnl,
      snapshot: overview
    });

    if (error) {
      console.error('Supabase maybePersistSnapshot error:', error.message);
    }
  }
}
