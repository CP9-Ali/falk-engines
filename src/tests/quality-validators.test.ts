import { describe, it, expect } from 'vitest';
import { schemaCheck } from '../data-quality/checks/schema';
import { duplicateCheck } from '../data-quality/checks/duplicate';
import { crossFieldCheck } from '../data-quality/checks/cross-field';
import type { CheckContext, Candle } from '../data-quality/checks/base';
import type { RawDataPoint } from '../core/types';

const T = (h: number) => new Date(Date.UTC(2025, 0, 1, h)).toISOString();
const mk = (h: number, o: number, hi: number, lo: number, c: number, v = 100, src = 'p'): RawDataPoint<Candle> => ({
  sourceId: src,
  value: { open: o, high: hi, low: lo, close: c, volume: v },
  eventTime: T(h), closedAt: T(h + 1), arrivalTime: T(h), availabilityTime: T(h),
  version: 1, fingerprint: 'f' + h + src,
});
const ctx = (points: RawDataPoint<Candle>[]): CheckContext => ({
  sourceId: 'p', points, range: { from: T(0), to: T(10) },
  expectedCadenceMs: 3_600_000, asOfCutoff: T(10),
});

describe('Schema check', () => {
  it('passes clean candle', () => {
    const f = schemaCheck.run(ctx([mk(0, 100, 102, 99, 101)]));
    expect(f.length).toBe(0);
  });
  it('flags missing sourceId', () => {
    const p = { ...mk(0, 100, 102, 99, 101), sourceId: '' };
    const f = schemaCheck.run(ctx([p]));
    expect(f.some(x => x.checkId === 'DQ-SCHEMA-003')).toBe(true);
  });
});

describe('Duplicate check', () => {
  it('passes unique candles', () => {
    const f = duplicateCheck.run(ctx([mk(0, 100, 102, 99, 101), mk(1, 101, 103, 100, 102)]));
    expect(f.length).toBe(0);
  });
  it('flags duplicate', () => {
    const c = mk(0, 100, 102, 99, 101);
    const f = duplicateCheck.run(ctx([c, { ...c }]));
    expect(f.some(x => x.checkId === 'DQ-DUPLICATE-001')).toBe(true);
  });
});

describe('Cross-field check', () => {
  it('passes clean', () => {
    const f = crossFieldCheck.run(ctx([mk(0, 100, 102, 99, 101)]));
    expect(f.length).toBe(0);
  });
  it('flags open > high', () => {
    const f = crossFieldCheck.run(ctx([mk(0, 200, 102, 99, 101)]));
    expect(f.some(x => x.checkId === 'DQ-CROSS-001')).toBe(true);
  });
  it('flags negative volume', () => {
    const f = crossFieldCheck.run(ctx([mk(0, 100, 102, 99, 101, -5)]));
    expect(f.some(x => x.checkId === 'DQ-CROSS-003')).toBe(true);
  });
});