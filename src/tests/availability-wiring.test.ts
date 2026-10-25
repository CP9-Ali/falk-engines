import { describe, it, expect } from 'vitest';
import { computeAvailability } from '../multi-timeframe/availability';

const H3_MS = 3 * 60 * 60 * 1000;
const M1_MS = 60 * 1000;

describe('B2 — availability contract for live-gold', () => {
  it('1m source candle: provisional while forming', () => {
    const open = '2026-01-01T10:00:00Z';
    const now  = '2026-01-01T10:00:30Z'; // 30s after open, not yet closed
    const r = computeAvailability({ timeframe: '1m', open_utc: open, now_utc: now, source: 'source' });
    expect(r.is_final).toBe(false);
    expect(r.source).toBe('source');
    expect(Date.parse(r.close_utc) - Date.parse(r.open_utc)).toBe(M1_MS);
  });

  it('1m source candle: final at close', () => {
    const open = '2026-01-01T10:00:00Z';
    const now  = '2026-01-01T10:01:00Z';
    const r = computeAvailability({ timeframe: '1m', open_utc: open, now_utc: now, source: 'source' });
    expect(r.is_final).toBe(true);
  });

  it('H3 derived candle: not final before 3h', () => {
    const open = '2026-01-01T09:00:00Z';
    const now  = '2026-01-01T11:00:00Z'; // 2h after open
    const r = computeAvailability({ timeframe: 'H3', open_utc: open, now_utc: now, source: 'derived' });
    expect(r.is_final).toBe(false);
    expect(r.source).toBe('derived');
    expect(Date.parse(r.close_utc) - Date.parse(r.open_utc)).toBe(H3_MS);
  });

  it('H3 derived candle: final at 3h close', () => {
    const open = '2026-01-01T09:00:00Z';
    const now  = '2026-01-01T12:00:00Z';
    const r = computeAvailability({ timeframe: 'H3', open_utc: open, now_utc: now, source: 'derived' });
    expect(r.is_final).toBe(true);
    expect(r.source).toBe('derived');
  });
});
