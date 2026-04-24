import { appendLog, state } from './state.js';

export function calculateSma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(values.length - period);
  const sum = slice.reduce((acc, item) => acc + item, 0);
  return sum / period;
}

export function calculateEma(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i += 1) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

export function tickMarket() {
  const drift = (Math.random() - 0.5) * 6;
  const previous = state.market.price;
  const next = Number((previous + drift).toFixed(2));

  state.market.price = next;
  state.market.history.push(next);
  if (state.market.history.length > 250) {
    state.market.history.shift();
  }

  const sma20 = calculateSma(state.market.history, 20);
  const ema20 = calculateEma(state.market.history, 20);

  const event = {
    type: 'market_tick',
    ts: new Date().toISOString(),
    instrument: state.market.instrument,
    price: next,
    change: Number((next - previous).toFixed(2)),
    indicators: {
      sma20,
      ema20
    }
  };

  if (Math.abs(event.change) > 4) {
    appendLog('WARN', 'High volatility tick detected', event);
  }

  return event;
}
