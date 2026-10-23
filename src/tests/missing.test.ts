import { describe, it, expect } from 'vitest';
import { missingCheck } from '../data-quality/checks/missing';
import type { CheckContext, Candle } from '../data-quality/checks/base';
import type { RawDataPoint } from '../core/types';

const T = (h: number) => new Date(Date.UTC(2025, 0, 1, h)).toISOString();
const mk = (h: number, over: Partial<Candle> = {}): RawDataPoint<Candle> => ({
  sourceId: 'p',
  value: { open: 100, high: 101, low: 99, close: 100.5, volume: 100, ...over },
  eventTime: T(h), closedAt: T(h + 1), arrivalTime: T(h), availabilityTime: T(h),
  version: 1, fingerprint: 'f' + h,
});
const ctx = (points: RawDataPoint<Candle>[]): CheckContext => ({
  sourceId: 'p', points, range: { from: T(0), to: T(10) },
  expectedCadenceMs: 3_600_000, asOfCutoff: T(10),
});

describe('MissingCheck (§6)', () => {
  it('passes clean candle', () => {
    expect(missingCheck.run(ctx([mk(0)])).length).toBe(0);
  });

  it('flags null field', () => {
    const f = missingCheck.run(ctx([mk(0, { open: null as any })]));
    expect(f.some(x => x.checkId === 'DQ-MISSING-002')).toBe(true);
  });

  it('flags missing eventTime', () => {
    const p = { ...mk(0), eventTime: '' };
    const f = missingCheck.run(ctx([p]));
    expect(f.some(x => x.checkId === 'DQ-MISSING-001')).toBe(true);
  });

  it('flags negative close', () => {
    const f = missingCheck.run(ctx([mk(0, { close: -1 })]));
    expect(f.some(x => x.checkId === 'DQ-MISSING-003')).toBe(true);
  });

  it('flags negative volume as MEDIUM', () => {
    const f = missingCheck.run(ctx([mk(0, { volume: -5 })]));
    expect(f.some(x => x.checkId === 'DQ-MISSING-004' && x.severity === 'WARNING')).toBe(true);
  });

  it('flags missing availabilityTime', () => {
    const p = { ...mk(0), availabilityTime: '' };
    const f = missingCheck.run(ctx([p]));
    expect(f.some(x => x.checkId === 'DQ-MISSING-005')).toBe(true);
  });
});