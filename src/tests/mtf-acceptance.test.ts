import { describe, it, expect } from 'vitest';
import {
  alignOpen,
  computeAvailability,
  canUseHigherTf,
  assertClosedOrReject,
  detectMissingChildren,
  timeframeMs,
  sourceTag,
  assertNoSourceMix,
} from '../multi-timeframe/availability';

describe('MTF acceptance: candle boundaries', () => {
  it('aligns M5 to stable boundaries', () => {
    expect(alignOpen('2026-01-01T10:07:00Z', 'M5')).toBe('2026-01-01T10:05:00.000Z');
    expect(alignOpen('2026-01-01T10:07:00Z', 'H1')).toBe('2026-01-01T10:00:00.000Z');
  });

  it('applies calendar offset', () => {
    const offset = 30 * 60_000;
    expect(alignOpen('2026-01-01T10:00:00Z', 'H1', offset)).toBe('2026-01-01T09:30:00.000Z');
  });
});

describe('MTF acceptance: no higher TF before close', () => {
  it('H1 not final before close', () => {
    const r = computeAvailability({ timeframe: 'H1', open_utc: '2026-01-01T10:00:00Z', now_utc: '2026-01-01T10:59:00Z', source: 'source' });
    expect(r.is_final).toBe(false);
    expect(canUseHigherTf(r, 'closed-only')).toBe(false);
    expect(() => assertClosedOrReject(r, 'closed-only')).toThrow();
  });

  it('H1 final at close', () => {
    const r = computeAvailability({ timeframe: 'H1', open_utc: '2026-01-01T10:00:00Z', now_utc: '2026-01-01T11:00:00Z', source: 'source' });
    expect(r.is_final).toBe(true);
    expect(canUseHigherTf(r, 'closed-only')).toBe(true);
  });
});

describe('MTF acceptance: missing children', () => {
  it('detects missing M5 inside H1', () => {
    const missing = detectMissingChildren(
      ['2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z', '2026-01-01T10:15:00Z'],
      { timeframe: 'H1', open_utc: '2026-01-01T10:00:00Z' },
      'M5'
    );
    expect(missing).toContain('2026-01-01T10:05:00.000Z');
    expect(missing).toContain('2026-01-01T10:20:00.000Z');
    expect(missing).toContain('2026-01-01T10:55:00.000Z');
  });

  it('no missing when all present', () => {
    const all = Array.from({ length: 12 }, (_, i) =>
      new Date(Date.parse('2026-01-01T10:00:00Z') + i * 5 * 60_000).toISOString()
    );
    const missing = detectMissingChildren(all, { timeframe: 'H1', open_utc: '2026-01-01T10:00:00Z' }, 'M5');
    expect(missing).toEqual([]);
  });
});

describe('MTF acceptance: source vs derived', () => {
  it('source and derived distinguishable', () => {
    const s = computeAvailability({ timeframe: 'H1', open_utc: '2026-01-01T10:00:00Z', now_utc: '2026-01-01T11:00:00Z', source: 'source' });
    const d = computeAvailability({ timeframe: 'H1', open_utc: '2026-01-01T10:00:00Z', now_utc: '2026-01-01T11:00:00Z', source: 'derived' });
    expect(sourceTag(s)).not.toBe(sourceTag(d));
    expect(() => assertNoSourceMix(s, d)).toThrow();
  });
});

describe('MTF acceptance: unknown timeframe rejected', () => {
  it('rejects unknown tf', () => {
    expect(() => timeframeMs('X9')).toThrow(/unknown timeframe/);
  });
});
