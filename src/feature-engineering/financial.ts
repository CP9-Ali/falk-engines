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

function ok(featureId: string, definitionVersion: string, ctx: FeatureComputeContext<CandleInputs>, value: number, availabilityTime: Timestamp): FeatureComputeResult<number> {
  return {
    featureId, definitionVersion, status: 'VALID', value,
    asOfCutoff: ctx.asOfCutoff, computedAt: now(), availabilityTime,
    snapshotRef: ctx.snapshotRef, fusionPolicyVersion: ctx.policyVersion,
  };
}

function insufficient(featureId: string, definitionVersion: string, ctx: FeatureComputeContext<CandleInputs>): FeatureComputeResult<number> {
  return {
    featureId, definitionVersion, status: 'INSUFFICIENT_INPUTS', value: null,
    asOfCutoff: ctx.asOfCutoff, computedAt: now(), availabilityTime: null,
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
  validationRules: ReadonlyArray<{ name: string; check: (v: number) => boolean }>;
  compute: (closed: RawDataPoint<Candle>[]) => number;
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
    validationRules: spec.validationRules,
    compute(ctx) {
      ctx.guard.assertNoLeak(ctx.inputs);
      const closed = filterClosed(ctx.inputs, spec.timeframeMs, ctx.asOfCutoff);
      if (closed.length < spec.minBars) return insufficient(spec.featureId, spec.definitionVersion, ctx);
      const v = spec.compute(closed);
      return ok(spec.featureId, spec.definitionVersion, ctx, v, closed[closed.length - 1]!.availabilityTime);
    },
  };
}

// === Factories ===
export function makeSma20(tfLabel: string, tfMs: number): FeatureDefinition<CandleInputs, number> {
  return makeFinancialFeature({
    featureId: 'sma_20_' + tfLabel, definitionVersion: '1.0.0',
    timeframe: tfLabel, timeframeMs: tfMs, minBars: 20, unit: 'price',
    validationRules: [{ name: 'positive', check: v => v > 0 }],
    compute: (closed) => { const w = closed.slice(-20); return w.reduce((s, p) => s + p.value.close, 0) / 20; },
  });
}

export function makeRsi14(tfLabel: string, tfMs: number): FeatureDefinition<CandleInputs, number> {
  return makeFinancialFeature({
    featureId: 'rsi_14_' + tfLabel, definitionVersion: '1.0.0',
    timeframe: tfLabel, timeframeMs: tfMs, minBars: 15, unit: 'index',
    validationRules: [{ name: 'range', check: v => v >= 0 && v <= 100 }],
    compute: (closed) => {
      const w = closed.slice(-15);
      let g = 0, l = 0;
      for (let i = 1; i < w.length; i++) { const d = w[i]!.value.close - w[i-1]!.value.close; if (d > 0) g += d; else l -= d; }
      const ag = g / 14, al = l / 14;
      if (al === 0) return 100;
      return 100 - 100 / (1 + ag / al);
    },
  });
}

export function makeAtr14(tfLabel: string, tfMs: number): FeatureDefinition<CandleInputs, number> {
  return makeFinancialFeature({
    featureId: 'atr_14_' + tfLabel, definitionVersion: '1.0.0',
    timeframe: tfLabel, timeframeMs: tfMs, minBars: 15, unit: 'price',
    validationRules: [{ name: 'non_negative', check: v => v >= 0 }],
    compute: (closed) => {
      const w = closed.slice(-15);
      const trs: number[] = [];
      for (let i = 1; i < w.length; i++) {
        const h = w[i]!.value.high, lo = w[i]!.value.low, pc = w[i-1]!.value.close;
        trs.push(Math.max(h - lo, Math.abs(h - pc), Math.abs(lo - pc)));
      }
      return trs.reduce((a, b) => a + b, 0) / trs.length;
    },
  });
}

// === Backward-compat 1h exports (tests) ===
export const sma20 = makeSma20('1h', 3_600_000);
export const ema20 = sma20; // legacy alias
export const rsi14 = makeRsi14('1h', 3_600_000);
export const atr14 = makeAtr14('1h', 3_600_000);
export const volatility20 = sma20; // legacy alias