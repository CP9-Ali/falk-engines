import { isCandleClosed, now } from '../core/time';
import type { RawDataPoint, Timestamp } from '../core/types';
import type { Candle } from '../data-quality/checks/base';
import type { FeatureComputeContext, FeatureComputeResult, FeatureDefinition } from './types';

const TIMEFRAME_MS = 3_600_000;
type CandleInputs = ReadonlyArray<RawDataPoint<Candle>>;

function filterClosed(inputs: CandleInputs, cutoff: Timestamp): RawDataPoint<Candle>[] {
  return inputs
    .filter(p => isCandleClosed(p, TIMEFRAME_MS, cutoff))
    .sort((a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());
}

function ok(
  featureId: string,
  definitionVersion: string,
  ctx: FeatureComputeContext<CandleInputs>,
  value: number,
  availabilityTime: Timestamp,
): FeatureComputeResult<number> {
  return {
    featureId, definitionVersion,
    status: 'VALID',
    value,
    asOfCutoff: ctx.asOfCutoff,
    computedAt: now(),
    availabilityTime,
    snapshotRef: ctx.snapshotRef,
    fusionPolicyVersion: ctx.policyVersion,
  };
}

function insufficient(
  featureId: string,
  definitionVersion: string,
  ctx: FeatureComputeContext<CandleInputs>,
): FeatureComputeResult<number> {
  return {
    featureId, definitionVersion,
    status: 'INSUFFICIENT_INPUTS',
    value: null,
    asOfCutoff: ctx.asOfCutoff,
    computedAt: now(),
    availabilityTime: null,
    snapshotRef: ctx.snapshotRef,
    fusionPolicyVersion: ctx.policyVersion,
  };
}

interface FeatureSpec {
  featureId: string;
  definitionVersion: string;
  minBars: number;
  unit: string;
  validationRules: ReadonlyArray<{ name: string; check: (v: number) => boolean }>;
  compute: (closed: RawDataPoint<Candle>[]) => number;
}

function makeFinancialFeature(spec: FeatureSpec): FeatureDefinition<CandleInputs, number> {
  return {
    featureId: spec.featureId,
    definitionVersion: spec.definitionVersion,
    timeframe: '1h',
    minHistoryMs: spec.minBars * TIMEFRAME_MS,
    availabilityRule: { requireClosedCandle: true, expectedLagMs: 1000 },
    inputsRequired: ['candles_1h'],
    dependencies: [],
    unit: spec.unit,
    validationRules: spec.validationRules,
    compute(ctx) {
      ctx.guard.assertNoLeak(ctx.inputs);
      const closed = filterClosed(ctx.inputs, ctx.asOfCutoff);
      if (closed.length < spec.minBars) {
        return insufficient(spec.featureId, spec.definitionVersion, ctx);
      }
      const value = spec.compute(closed);
      const lastBar = closed[closed.length - 1]!;
      return ok(spec.featureId, spec.definitionVersion, ctx, value, lastBar.availabilityTime);
    },
  };
}

// ── SMA(20) ─────────────────────────────────────────────
export const sma20 = makeFinancialFeature({
  featureId: 'sma_20',
  definitionVersion: '1.0.0',
  minBars: 20,
  unit: 'price',
  validationRules: [{ name: 'positive', check: v => v > 0 }],
  compute: (closed) => {
    const window = closed.slice(-20);
    return window.reduce((s, p) => s + p.value.close, 0) / 20;
  },
});

// ── EMA(20) ─────────────────────────────────────────────
export const ema20 = makeFinancialFeature({
  featureId: 'ema_20',
  definitionVersion: '1.0.0',
  minBars: 20,
  unit: 'price',
  validationRules: [{ name: 'positive', check: v => v > 0 }],
  compute: (closed) => {
    const k = 2 / (20 + 1);
    let ema = closed[0]!.value.close;
    for (let i = 1; i < closed.length; i++) {
      ema = closed[i]!.value.close * k + ema * (1 - k);
    }
    return ema;
  },
});

// ── RSI(14) ─────────────────────────────────────────────
export const rsi14 = makeFinancialFeature({
  featureId: 'rsi_14',
  definitionVersion: '1.0.0',
  minBars: 15,
  unit: 'index',
  validationRules: [{ name: 'range', check: v => v >= 0 && v <= 100 }],
  compute: (closed) => {
    const window = closed.slice(-15);
    let gains = 0, losses = 0;
    for (let i = 1; i < window.length; i++) {
      const diff = window[i]!.value.close - window[i - 1]!.value.close;
      if (diff > 0) gains += diff; else losses -= diff;
    }
    const avgGain = gains / 14;
    const avgLoss = losses / 14;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  },
});

// ── ATR(14) ─────────────────────────────────────────────
export const atr14 = makeFinancialFeature({
  featureId: 'atr_14',
  definitionVersion: '1.0.0',
  minBars: 15,
  unit: 'price',
  validationRules: [{ name: 'non_negative', check: v => v >= 0 }],
  compute: (closed) => {
    const window = closed.slice(-15);
    const trs: number[] = [];
    for (let i = 1; i < window.length; i++) {
      const h = window[i]!.value.high;
      const l = window[i]!.value.low;
      const pc = window[i - 1]!.value.close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    return trs.reduce((a, b) => a + b, 0) / trs.length;
  },
});

// ── Volatility(20) ──────────────────────────────────────
export const volatility20 = makeFinancialFeature({
  featureId: 'volatility_20',
  definitionVersion: '1.0.0',
  minBars: 21,
  unit: 'ratio',
  validationRules: [{ name: 'non_negative', check: v => v >= 0 }],
  compute: (closed) => {
    const window = closed.slice(-21);
    const returns: number[] = [];
    for (let i = 1; i < window.length; i++) {
      returns.push(Math.log(window[i]!.value.close / window[i - 1]!.value.close));
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  },
});