import { describe, it, expect } from 'vitest';
import { timestampCheck } from '../data-quality/checks/timestamp';
import type { CheckContext, Candle } from '../data-quality/checks/base';
import type { RawDataPoint } from '../core/types';

const T = (s: number) => new Date(s).toISOString();
const T0 = Date.UTC(2025, 0, 1, 0, 0, 0);
const mk = (offsetMs: number, over: Partial<RawDataPoint<Candle>> = {}): RawDataPoint<Candle> => ({
  sourceId: 'p',
  value: { open: 100, high: 101, low: 99, close: 100, volume: 100 },
  eventTime: T(T0 + offsetMs),
  closedAt: T(T0 + offsetMs + 60_000),
  arrivalTime: T(T0 + offsetMs + 60_000),
  availabilityTime: T(T0 + offsetMs + 60_000),
  version: 1, fingerprint: 'f' + offsetMs,
  ...over,
});
const ctx = (points: RawDataPoint<Candle>[]): CheckContext => ({
  sourceId: 'p', points, range: { from: T(T0), to: T(T0 + 10 * 60_000) },
  expectedCadenceMs: 60_000, asOfCutoff: T(T0 + 10 * 60_000),
});

describe('TimestampCheck (§6)', () => {
  it('passes clean ordered candles', () => {
    expect(timestampCheck.run(ctx([mk(0), mk(60_000), mk(120_000)])).length).toBe(0);
  });

  it('flags future event', () => {
    const f = timestampCheck.run(ctx([mk(30 * 60_000)]));
    expect(f.some(x => x.checkId === 'DQ-TIMESTAMP-002')).toBe(true);
  });

  it('flags availability < event', () => {
    const p = mk(60_000, { availabilityTime: T(T0) }); // availability before event
    const f = timestampCheck.run(ctx([p]));
    expect(f.some(x => x.checkId === 'DQ-TIMESTAMP-003')).toBe(true);
  });

  it('flags out of order', () => {
    const f = timestampCheck.run(ctx([mk(120_000), mk(60_000)]));
    expect(f.some(x => x.checkId === 'DQ-TIMESTAMP-005')).toBe(true);
  });

  it('flags large arrival delay', () => {
    const p = mk(0, { arrivalTime: T(T0 + 10 * 60_000) }); // 10 min delay
    const f = timestampCheck.run(ctx([p]));
    expect(f.some(x => x.checkId === 'DQ-TIMESTAMP-004')).toBe(true);
  });
});