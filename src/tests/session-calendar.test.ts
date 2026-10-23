import { describe, it, expect } from 'vitest';
import { classifySession, classifyGap } from '../calendar/session-calendar';

describe('Session Calendar (§7)', () => {
  // Monday 2025-01-06 00:00 UTC = session ASIA
  const mon00 = new Date(Date.UTC(2025, 0, 6, 0, 0, 0)).toISOString();
  const mon10 = new Date(Date.UTC(2025, 0, 6, 10, 0, 0)).toISOString();
  const mon15 = new Date(Date.UTC(2025, 0, 6, 15, 0, 0)).toISOString();
  const sat12 = new Date(Date.UTC(2025, 0, 4, 12, 0, 0)).toISOString();

  it('Monday 00:00 = ASIA', () => {
    const s = classifySession(mon00);
    expect(s.session).toBe('ASIA');
    expect(s.is_market_open).toBe(true);
    expect(s.is_weekend).toBe(false);
  });

  it('Monday 10:00 = LONDON', () => {
    expect(classifySession(mon10).session).toBe('LONDON');
    expect(classifySession(mon10).is_high_liquidity).toBe(true);
  });

  it('Monday 15:00 = OVERLAP (London+NY)', () => {
    expect(classifySession(mon15).session).toBe('OVERLAP_LD_NY');
    expect(classifySession(mon15).is_high_liquidity).toBe(true);
  });

  it('Saturday = market closed', () => {
    const s = classifySession(sat12);
    expect(s.is_weekend).toBe(true);
    expect(s.is_market_open).toBe(false);
  });
});

describe('Gap Classifier (§6.2)', () => {
  const mon00 = new Date(Date.UTC(2025, 0, 6, 0, 0, 0)).toISOString();
  const mon01 = new Date(Date.UTC(2025, 0, 6, 1, 0, 0)).toISOString();
  const fri22 = new Date(Date.UTC(2025, 0, 3, 22, 0, 0)).toISOString();
  const mon00_next = new Date(Date.UTC(2025, 0, 6, 0, 0, 0)).toISOString();

  it('small intraday gap = feed error', () => {
    const g = classifyGap(mon00, mon01, 60_000);
    expect(g.gap_type).toBe('UNEXPECTED_FEED_ERROR');
    expect(g.expected_candles).toBe(59);
  });

  it('weekend gap = expected closed', () => {
    const g = classifyGap(fri22, mon00_next, 60_000);
    expect(g.gap_type).toBe('EXPECTED_MARKET_CLOSED');
    expect(g.reason).toContain('weekend');
  });
});