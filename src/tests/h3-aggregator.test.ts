import { describe, it, expect } from 'vitest';
import { H3Aggregator } from '../ingestion/h3-aggregator';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const T0 = Date.UTC(2025, 0, 6, 0, 0, 0); // Monday 00:00 UTC
const h = (offsetHours: number, close: number): RawDataPoint<Candle> => ({
  sourceId: 'twelvedata-ws',
  value: { open: close, high: close + 1, low: close - 1, close, volume: 0 },
  eventTime: new Date(T0 + offsetHours * 3600_000).toISOString(),
  closedAt: new Date(T0 + (offsetHours + 1) * 3600_000).toISOString(),
  arrivalTime: new Date(T0 + (offsetHours + 1) * 3600_000).toISOString(),
  availabilityTime: new Date(T0 + (offsetHours + 1) * 3600_000).toISOString(),
  version: 1,
  fingerprint: 'h1-' + offsetHours,
});

describe('H3Aggregator (§10)', () => {
  it('returns null until 3 hours arrive', () => {
    const agg = new H3Aggregator();
    expect(agg.add(h(0, 4000))).toBeNull();
    expect(agg.add(h(1, 4005))).toBeNull();
    const h3 = agg.add(h(2, 4010));
    expect(h3).not.toBeNull();
  });

  it('builds correct OHLCV', () => {
    const agg = new H3Aggregator();
    agg.add(h(0, 4000));
    agg.add(h(1, 4010));
    const h3 = agg.add(h(2, 4020))!;
    expect(h3.value.open).toBe(4000);
    expect(h3.value.close).toBe(4020);
    expect(h3.value.high).toBe(4021); // max of (4001, 4011, 4021)
    expect(h3.value.low).toBe(3999);  // min of (3999, 4009, 4019)
  });

  it('eventTime is aligned to 3-hour boundary', () => {
    const agg = new H3Aggregator();
    agg.add(h(0, 1)); agg.add(h(1, 2)); agg.add(h(2, 3));
    expect(agg.add(h(3, 4))).toBeNull(); // hour 3 → next bucket
    expect(agg.add(h(4, 5))).toBeNull();
    const h3 = agg.add(h(5, 6))!; // bucket 03:00-06:00
    expect(h3.eventTime).toBe(new Date(T0 + 3 * 3600_000).toISOString());
  });

  it('rejects non-consecutive hours (gap detection)', () => {
    const agg = new H3Aggregator();
    agg.add(h(0, 1));
    agg.add(h(2, 3)); // gap at hour 1
    const r = agg.add(h(4, 5));
    expect(r).toBeNull();
  });

  it('restoreFromHistory builds H3 from complete buckets', () => {
    const agg = new H3Aggregator();
    const history = [h(0, 1), h(1, 2), h(2, 3), h(3, 4), h(4, 5), h(5, 6)];
    const h3s = agg.restoreFromHistory(history);
    expect(h3s.length).toBe(2);
    expect(h3s[0]!.value.open).toBe(1);
    expect(h3s[1]!.value.open).toBe(4);
  });

  it('restoreFromHistory skips incomplete buckets', () => {
    const agg = new H3Aggregator();
    const history = [h(0, 1), h(1, 2)]; // only 2 hours
    const h3s = agg.restoreFromHistory(history);
    expect(h3s.length).toBe(0);
  });

  it('restoreFromHistory rejects gaps', () => {
    const agg = new H3Aggregator();
    const history = [h(0, 1), h(2, 3), h(4, 5)]; // all in same 3h bucket but hour 1 missing
    const h3s = agg.restoreFromHistory(history);
    expect(h3s.length).toBe(0);
  });
});