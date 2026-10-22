import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { FeatureEngineeringEngine } from '../feature-engineering/engine';
import { FeatureRegistry } from '../feature-engineering/registry';
import { sma20, ema20, rsi14, atr14, volatility20 } from '../feature-engineering/financial';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const T = (h: number) => new Date(Date.UTC(2025, 0, 1, h)).toISOString();
const candle = (h: number, close: number): RawDataPoint<Candle> => ({
  sourceId: 'p',
  value: { open: close, high: close + 1, low: close - 1, close, volume: 100 },
  eventTime: T(h), closedAt: T(h + 1),
  arrivalTime: T(h), availabilityTime: T(h),
  version: 1, fingerprint: `f${h}`,
});

const run = (featureId: string, points: RawDataPoint<Candle>[], cutoff: string) => {
  const reg = new FeatureRegistry();
  reg.register(sma20); reg.register(ema20); reg.register(rsi14);
  reg.register(atr14); reg.register(volatility20);
  const fe = new FeatureEngineeringEngine(reg,
    { engineVersion: '1', policyVersion: 'p', configVersion: 'c' },
    new HashChainAuditLog());
  return fe.computeBatch({
    requestId: 'r', asOfCutoff: cutoff,
    snapshotRef: { snapshotId: 's', contentFingerprint: 'c' },
    fusionPolicyVersion: 'p',
    targets: [{ featureId, definitionVersion: '1.0.0' }],
    inputs: new Map([[featureId, points]]),
    actor: 'test',
  }).get(featureId)!;
};

describe('Financial features', () => {
  it('sma20 on flat prices = flat value', () => {
    const points = Array.from({ length: 21 }, (_, i) => candle(i, 100));
    const r = run('sma_20', points, T(21));
    expect(r.status).toBe('VALID');
    expect(r.value).toBeCloseTo(100);
  });

  it('sma20 insufficient data', () => {
    const points = Array.from({ length: 5 }, (_, i) => candle(i, 100));
    expect(run('sma_20', points, T(5)).status).toBe('INSUFFICIENT_INPUTS');
  });

  it('rsi14 = 100 on monotonic uptrend', () => {
    const points = Array.from({ length: 16 }, (_, i) => candle(i, 100 + i));
    expect(run('rsi_14', points, T(16)).value).toBe(100);
  });

  it('rsi14 = 0 on monotonic downtrend', () => {
    const points = Array.from({ length: 16 }, (_, i) => candle(i, 200 - i));
    expect(run('rsi_14', points, T(16)).value).toBe(0);
  });

  it('atr14 with constant range = 2', () => {
    const points = Array.from({ length: 16 }, (_, i) => candle(i, 100));
    const r = run('atr_14', points, T(16));
    expect(r.status).toBe('VALID');
    expect(r.value).toBeCloseTo(2, 1);
  });

  it('volatility20 = 0 on constant price', () => {
    const points = Array.from({ length: 22 }, (_, i) => candle(i, 100));
    expect(run('volatility_20', points, T(22)).value).toBeCloseTo(0);
  });

  it('excludes in-progress candle (no lookahead)', () => {
    const points = [
      ...Array.from({ length: 20 }, (_, i) => candle(i, 100)),
      { ...candle(20, 999), closedAt: T(21) }, // لم تُغلق بعد عند T(20)
    ];
    // عند T(20): آخر شمعة مفتوحة — SMA يجب أن يستخدم الشموع 0..19 فقط
    const r = run('sma_20', points, T(20));
    expect(r.value).toBeCloseTo(100);
  });
});