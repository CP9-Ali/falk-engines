import { isCandleClosed, now } from '../core/time';
import type { RawDataPoint, Timestamp } from '../core/types';
import type { Candle } from '../data-quality/checks/base';
import type { FeatureComputeContext, FeatureComputeResult, FeatureDefinition } from './types';

type CandleInputs = ReadonlyArray<RawDataPoint<Candle>>;

function filterClosed(inputs: CandleInputs, tfMs: number, cutoff: Timestamp): RawDataPoint<Candle>[] {
  return inputs
    .filter(p => isCandleClosed(p, tfMs, cutoff))
    .sort((a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());
}

function ok(
  featureId: string, definitionVersion: string,
  ctx: FeatureComputeContext<CandleInputs>,
  value: number, availabilityTime: Timestamp,
  parameters: Record<string, number>,
  expectedRange?: { min: number; max: number },
): FeatureComputeResult<number> {
  let range_check: 'IN_RANGE' | 'OUT_OF_RANGE' | 'UNKNOWN' = 'UNKNOWN';
  if (expectedRange) {
    range_check = value >= expectedRange.min && value <= expectedRange.max ? 'IN_RANGE' : 'OUT_OF_RANGE';
  }
  return {
    featureId, definitionVersion, status: 'VALID', value,
    asOfCutoff: ctx.asOfCutoff, computedAt: now(), availabilityTime,
    parameters,
    ...(expectedRange ? { expectedRange } : {}),
    range_check,
    snapshotRef: ctx.snapshotRef, fusionPolicyVersion: ctx.policyVersion,
  };
}

function insufficient(
  featureId: string, definitionVersion: string,
  ctx: FeatureComputeContext<CandleInputs>,
  parameters: Record<string, number>,
): FeatureComputeResult<number> {
  return {
    featureId, definitionVersion, status: 'INSUFFICIENT_INPUTS', value: null,
    asOfCutoff: ctx.asOfCutoff, computedAt: now(), availabilityTime: null,
    parameters,
    snapshotRef: ctx.snapshotRef, fusionPolicyVersion: ctx.policyVersion,
  };
}

function makeFinancialFeature(spec: {
  featureId: string;
  definitionVersion: string;
  timeframe: string;
  timeframeMs: number;
  minBars: number;
  unit: string;
  parameters: Record<string, number>;
  expectedRange?: { min: number; max: number };
  validationRules: ReadonlyArray<{ name: string; check: (v: number) => boolean }>;
  compute: (closed: RawDataPoint<Candle>[], parameters: Record<string, number>) => number;
}): FeatureDefinition<CandleInputs, number> {
  return {
    featureId: spec.featureId,
    definitionVersion: spec.definitionVersion,
    timeframe: spec.timeframe,
    minHistoryMs: spec.minBars * spec.timeframeMs,
    availabilityRule: { requireClosedCandle: true, expectedLagMs: 1000 },
    inputsRequired: ['candles_' + spec.timeframe],
    dependencies: [],
    unit: spec.unit,
    parameters: spec.parameters,
    ...(spec.expectedRange ? { expectedRange: spec.expectedRange } : {}),
    validationRules: spec.validationRules,
    compute(ctx) {
      ctx.guard.assertNoLeak(ctx.inputs);
      const params = ctx.parameters ?? {};
      const closed = filterClosed(ctx.inputs, spec.timeframeMs, ctx.asOfCutoff);
      if (closed.length < spec.minBars) return insufficient(spec.featureId, spec.definitionVersion, ctx, params);
      const v = spec.compute(closed, params);
      return ok(spec.featureId, spec.definitionVersion, ctx, v, closed[closed.length - 1]!.availabilityTime, params, spec.expectedRange);
    },
  };
}

export function makeSma20(tfLabel: string, tfMs: number): FeatureDefinition<CandleInputs, number> {
  return makeFinancialFeature({
    featureId: 'sma_20_' + tfLabel, definitionVersion: '1.0.0',
    timeframe: tfLabel, timeframeMs: tfMs, minBars: 20, unit: 'price',
    parameters: { period: 20 },
    expectedRange: { min: 0, max: 1_000_000 },
    validationRules: [{ name: 'positive', check: v => v > 0 }],
    compute: (closed, p) => {
      const period = p.period ?? 20;
      const w = closed.slice(-period);
      return w.reduce((s, x) => s + x.value.close, 0) / period;
    },
  });
}

export function makeEma20(tfLabel: string, tfMs: number): FeatureDefinition<CandleInputs, number> {
  return makeFinancialFeature({
    featureId: 'ema_20_' + tfLabel, definitionVersion: '1.0.0',
    timeframe: tfLabel, timeframeMs: tfMs, minBars: 20, unit: 'price',
    parameters: { period: 20 },
    expectedRange: { min: 0, max: 1_000_000 },
    validationRules: [{ name: 'positive', check: v => v > 0 }],
    compute: (closed, p) => {
      const period = p.period ?? 20;
      const k = 2 / (period + 1);
      let ema = closed[0]!.value.close;
      for (let i = 1; i < closed.length; i++) ema = closed[i]!.value.close * k + ema * (1 - k);
      return ema;
    },
  });
}

export function makeRsi14(tfLabel: string, tfMs: number): FeatureDefinition<CandleInputs, number> {
  return makeFinancialFeature({
    featureId: 'rsi_14_' + tfLabel, definitionVersion: '1.0.0',
    timeframe: tfLabel, timeframeMs: tfMs, minBars: 15, unit: 'index',
    parameters: { period: 14 },
    expectedRange: { min: 0, max: 100 },
    validationRules: [{ name: 'range', check: v => v >= 0 && v <= 100 }],
    compute: (closed, p) => {
      const period = p.period ?? 14;
      const w = closed.slice(-(period + 1));
      let g = 0, l = 0;
      for (let i = 1; i < w.length; i++) { const d = w[i]!.value.close - w[i - 1]!.value.close; if (d > 0) g += d; else l -= d; }
      const ag = g / period, al = l / period;
      if (al === 0) return 100;
      return 100 - 100 / (1 + ag / al);
    },
  });
}

export function makeAtr14(tfLabel: string, tfMs: number): FeatureDefinition<CandleInputs, number> {
  return makeFinancialFeature({
    featureId: 'atr_14_' + tfLabel, definitionVersion: '1.0.0',
    timeframe: tfLabel, timeframeMs: tfMs, minBars: 15, unit: 'price',
    parameters: { period: 14 },
    expectedRange: { min: 0, max: 1000 },
    validationRules: [{ name: 'non_negative', check: v => v >= 0 }],
    compute: (closed, p) => {
      const period = p.period ?? 14;
      const w = closed.slice(-(period + 1));
      const trs: number[] = [];
      for (let i = 1; i < w.length; i++) {
        const h = w[i]!.value.high, lo = w[i]!.value.low, pc = w[i - 1]!.value.close;
        trs.push(Math.max(h - lo, Math.abs(h - pc), Math.abs(lo - pc)));
      }
      return trs.reduce((a, b) => a + b, 0) / trs.length;
    },
  });
}

export function makeVolatility20(tfLabel: string, tfMs: number): FeatureDefinition<CandleInputs, number> {
  return makeFinancialFeature({
    featureId: 'volatility_20_' + tfLabel, definitionVersion: '1.0.0',
    timeframe: tfLabel, timeframeMs: tfMs, minBars: 21, unit: 'ratio',
    parameters: { period: 20 },
    expectedRange: { min: 0, max: 1 },
    validationRules: [{ name: 'non_negative', check: v => v >= 0 }],
    compute: (closed, p) => {
      const period = p.period ?? 20;
      const w = closed.slice(-(period + 1));
      const returns: number[] = [];
      for (let i = 1; i < w.length; i++) returns.push(Math.log(w[i]!.value.close / w[i - 1]!.value.close));
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
      return Math.sqrt(variance);
    },
  });
}

export const sma20 = makeSma20('1h', 3_600_000);
export const ema20 = makeEma20('1h', 3_600_000);
export const rsi14 = makeRsi14('1h', 3_600_000);
export const atr14 = makeAtr14('1h', 3_600_000);
export const volatility20 = makeVolatility20('1h', 3_600_000);