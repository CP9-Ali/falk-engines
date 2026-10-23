import { describe, it, expect } from 'vitest';
import { aggregateCandles, compareTimeframes, isComplete, TF_MS } from '../multi-timeframe/aggregator';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const M = (start: number) => new Date(start).toISOString();

const c = (
  startMs: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 1,
): RawDataPoint<Candle> => ({
  sourceId: 'test',
  value: { open, high, low, close, volume },
  eventTime: M(startMs),
  closedAt: M(startMs + TF_MS['1m']),
  arrivalTime: M(startMs + TF_MS['1m']),
  availabilityTime: M(startMs + TF_MS['1m']),
  version: 1,
  fingerprint: 'f' + startMs,
});

describe('Multi-Timeframe Aggregator (10)', () => {
  const T0 = Date.UTC(2025, 0, 1, 0, 0, 0);

  it('aggregates 5x M1 into 1x M5', () => {
    const source = [
      c(T0,                100, 102, 99,  101),
      c(T0 + 60_000,       101, 103, 100, 102),
      c(T0 + 2*60_000,     102, 104, 101, 103),
      c(T0 + 3*60_000,     103, 105, 102, 104),
      c(T0 + 4*60_000,     104, 106, 103, 105),
    ];
    const agg = aggregateCandles(source, '1m', '5m');
    expect(agg.length).toBe(1);
    const r = agg[0]!;
    expect(r.point.value.open).toBe(100);
    expect(r.point.value.high).toBe(106);
    expect(r.point.value.low).toBe(99);
    expect(r.point.value.close).toBe(105);
    expect(r.source_candle_count).toBe(5);
    expect(r.expected_candle_count).toBe(5);
    expect(r.complete).toBe(true);
  });

  it('marks incomplete bucket if missing M1', () => {
    const source = [
      c(T0,            100, 102, 99, 101),
      c(T0 + 60_000,   101, 103, 100, 102),
      c(T0 + 4*60_000, 104, 106, 103, 105),
    ];
    const agg = aggregateCandles(source, '1m', '5m');
    expect(agg.length).toBe(1);
    expect(agg[0]!.source_candle_count).toBe(3);
    expect(agg[0]!.complete).toBe(false);
    expect(isComplete(agg[0]!)).toBe(false);
  });

  it('aggregates into multiple buckets', () => {
    const source = Array.from({ length: 15 }, (_, i) =>
      c(T0 + i * 60_000, 100 + i, 101 + i, 99 + i, 100.5 + i));
    const agg = aggregateCandles(source, '1m', '5m');
    expect(agg.length).toBe(3);
    expect(agg.every(a => a.complete)).toBe(true);
  });

  it('rejects invalid timeframe direction (source >= target)', () => {
    const source = [c(T0, 100, 101, 99, 100)];
    expect(() => aggregateCandles(source, '1h', '5m')).toThrow(/source timeframe must be smaller/);
  });

  it('rejects aggregation ratio > 500', () => {
    // 1w / 1m = 10080 > 500
    const source = [c(T0, 100, 101, 99, 100)];
    expect(() => aggregateCandles(source, '1m', '1w')).toThrow(/ratio too large/);
  });

  it('compareTimeframes: close within tolerance matches', () => {
    const agg = { ...c(T0, 100, 105, 99, 104), sourceId: 'agg' };
    const ind = { ...c(T0, 100, 106, 99, 104.5), sourceId: 'ind' };
    const r = compareTimeframes(agg, ind, 100);
    expect(r.matches).toBe(true);
    expect(r.divergence_bps).toBeLessThan(100);
  });

  it('compareTimeframes: large divergence flagged', () => {
    const agg = { ...c(T0, 100, 105, 99, 104), sourceId: 'agg' };
    const ind = { ...c(T0, 100, 106, 99, 108), sourceId: 'ind' };
    const r = compareTimeframes(agg, ind, 100);
    expect(r.matches).toBe(false);
    expect(r.reason).toContain('divergence');
  });

  it('compareTimeframes: invalid values rejected', () => {
    const agg = { ...c(T0, 100, 105, 99, 0), sourceId: 'agg' };
    const ind = { ...c(T0, 100, 106, 99, 104), sourceId: 'ind' };
    const r = compareTimeframes(agg, ind, 100);
    expect(r.matches).toBe(false);
    expect(r.reason).toBe('invalid values');
  });
});