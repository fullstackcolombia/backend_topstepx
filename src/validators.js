import { z } from 'zod';

export const riskSchema = z.object({
  maxLossDaily: z.number().min(1).max(50000),
  maxTradesDaily: z.number().int().min(1).max(100),
  killSwitch: z.enum(['armed', 'off']),
  globalMode: z.enum(['manual', 'semi', 'auto'])
});

const topstepxCredentialsSchema = z.object({
  userName: z.string().min(1).max(120),
  apiKey: z.string().min(8).max(256)
});

const tradovateCredentialsSchema = z.object({
  name: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
  appId: z.string().min(1).max(120),
  appVersion: z.string().min(1).max(40),
  cid: z.number().int().min(0),
  sec: z.string().min(1).max(300)
});

export const baseOrderSchema = z.object({
  broker: z.enum(['topstepx', 'tradovate']).optional(),
  orderType: z.enum(['BUY_MARKET', 'SELL_MARKET', 'BUY_STOP', 'SELL_STOP', 'OCO_BRACKET', 'BREAKOUT_BRACKET']),
  accounts: z.array(z.string().min(1)).min(1),
  instrument: z.string().min(2),
  qty: z.number().int().min(1).max(200),
  stopLoss: z.number().min(1).max(200),
  takeProfit: z.number().min(1).max(400),
  breakEvenTrigger: z.number().min(0).max(200),
  trailingTrigger: z.number().min(0).max(200),
  trailingStep: z.number().min(1).max(100),
  runnerQty: z.number().int().min(0).max(100),
  mode: z.enum(['manual', 'semi', 'auto']),
  topstepxCredentials: topstepxCredentialsSchema.optional(),
  tradovateCredentials: tradovateCredentialsSchema.optional(),
  tradovateAccountId: z.number().int().optional(),
  tradovateAccountSpec: z.string().min(1).max(120).optional()
});

export const reverseSchema = z.object({
  accounts: z.array(z.string()).min(1),
  instrument: z.string().min(2),
  mode: z.enum(['manual', 'semi', 'auto'])
});

export const simpleAccountsSchema = z.object({
  accounts: z.array(z.string()).min(1)
});

const esparPairSchema = z.object({
  id: z.string().min(1),
  longPlatform: z.enum(['topstepx', 'tradovate']).optional(),
  shortPlatform: z.enum(['topstepx', 'tradovate']).optional(),
  longAccountId: z.string(),
  shortAccountId: z.string(),
  instrument: z.string().min(1),
  qty: z.number().int().min(0).max(200),
  mode: z.enum(['manual', 'semi', 'auto']),
  stopLoss: z.number().min(1).max(200),
  takeProfit: z.number().min(1).max(400),
  breakEvenTrigger: z.number().min(0).max(200),
  trailingTrigger: z.number().min(0).max(200),
  trailingStep: z.number().min(1).max(100),
  runnerQty: z.number().int().min(0).max(100)
});

export const esparPairsSchema = z.object({
  pairs: z.array(esparPairSchema).max(20)
});

export const cocSchema = z.object({
  accounts: z.array(z.string()).min(1),
  enabled: z.boolean(),
  baseTimeframe: z.enum(['1s', '2s', '5s']),
  entryOffsetTicks: z.number().int().min(0).max(10),
  minRangeTicks: z.number().int().min(1).max(100),
  maxRangeTicks: z.number().int().min(2).max(200),
  maxActivationWindowSeconds: z.number().int().min(1).max(120),
  partialTimeSeconds: z.number().int().min(1).max(120),
  partialProfitDollars: z.number().min(10).max(10000),
  partialCloseQty: z.number().int().min(1).max(100),
  baseOrder: baseOrderSchema
});

export const orbSchema = z.object({
  accounts: z.array(z.string()).min(1),
  enabled: z.boolean(),
  timeframe: z.enum(['1m', '5m', '15m', '1h']),
  volumeMultiplier: z.number().min(0.5).max(5),
  requireRetest: z.boolean(),
  tp1Qty: z.number().int().min(1).max(100),
  tp2Qty: z.number().int().min(1).max(100),
  tp1ProfitDollars: z.number().min(10).max(10000),
  tp2ProfitDollars: z.number().min(10).max(20000),
  runnerQty: z.number().int().min(0).max(100),
  baseOrder: baseOrderSchema
});

export function parseOrThrow(schema, payload) {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    const error = new Error(`Validation failed: ${errors.join('; ')}`);
    error.statusCode = 400;
    throw error;
  }
  return parsed.data;
}
