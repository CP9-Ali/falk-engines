import { describe, it, expect } from 'vitest';
import { compareVersions } from '../feature-engineering/version-compare';
import { makeSma20 } from '../feature-engineering/financial';
import { TF_MS } from '../multi-timeframe/aggregator';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const M = (s: number) => new Date(s).toISOString();
const c = (s: number, close: number): RawDataPoint<Candle> => ({
  sourceId: 'test',
  value: { open: close, high: close + 1, low: close - 1, close, volume: 1 },
  eventTime: M(s), closedAt: M(s + 60_000),
  arrivalTime: M(s), availabilityTime: M(s),
  version: 1, fingerprint: 'f' + s,
});

describe('Version Comparison (§8.1)', () => {
  const T0 = Date.UTC(2025, 0, 1, 0, 0, 0);
  const candles = Array.from({ length: 40 }, (_, i) => c(T0 + i * 60_000, 100 + Math.sin(i / 5) * 2));

  it('identical versions match 100%', () => {
    const def = makeSma20('1m', TF_MS['1m']);
    const report = compareVersions(def, def, '1m', candles);
    expect(report.match_rate).toBe(1);
    expect(report.divergences).toBe(0);
    expect(report.feature_id).toBe('sma_20_1m');
  });

  it('divergent versions detected', () => {
    const v1 = makeSma20('1m', TF_MS['1m']);
    const v2 = { ...makeSma20('1m', TF_MS['1m']), definitionVersion: '1.0.1', parameters: { period: 10 } };
    const report = compareVersions(v1, v2, '1m', candles);
    expect(report.divergences).toBeGreaterThan(0);
    expect(report.match_rate).toBeLessThan(1);
  });

  it('report structure valid', () => {
    const def = makeSma20('1m', TF_MS['1m']);
    const report = compareVersions(def, def, '1m', candles);
    expect(report.rows.length).toBe(candles.length - 20);
    expect(report.total_candles).toBe(candles.length - 20);
  });
});