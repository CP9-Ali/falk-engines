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

// =====================================================================
// Stage 3: DST-aware tests
// =====================================================================

describe('Session Calendar — DST aware (§7)', () => {
  // Winter (Jan 2025): London GMT (UTC+0), NY EST (UTC-5)
  // Summer (Jul 2025): London BST (UTC+1), NY EDT (UTC-4)

  it('winter Mon 13:00 UTC = OVERLAP (London GMT 13:00, NY EST 08:00)', () => {
    const at = new Date(Date.UTC(2025, 0, 6, 13, 0, 0)).toISOString();
    expect(classifySession(at).session).toBe('OVERLAP_LD_NY');
  });

  it('summer Mon 13:00 UTC = OVERLAP (London BST 14:00, NY EDT 09:00)', () => {
    const at = new Date(Date.UTC(2025, 6, 7, 13, 0, 0)).toISOString();
    expect(classifySession(at).session).toBe('OVERLAP_LD_NY');
  });

  it('winter Mon 12:00 UTC = LONDON only (NY EST 07:00 closed)', () => {
    const at = new Date(Date.UTC(2025, 0, 6, 12, 0, 0)).toISOString();
    expect(classifySession(at).session).toBe('LONDON');
  });

  it('summer Mon 12:00 UTC = OVERLAP (NY EDT already at 08:00)', () => {
    const at = new Date(Date.UTC(2025, 6, 7, 12, 0, 0)).toISOString();
    expect(classifySession(at).session).toBe('OVERLAP_LD_NY');
  });

  it('summer Mon 11:00 UTC = LONDON only (NY EDT 07:00 closed)', () => {
    const at = new Date(Date.UTC(2025, 6, 7, 11, 0, 0)).toISOString();
    expect(classifySession(at).session).toBe('LONDON');
  });

  it('winter Mon 22:00 UTC = CLOSED (NY EST 17:00 boundary)', () => {
    const at = new Date(Date.UTC(2025, 0, 6, 22, 0, 0)).toISOString();
    expect(classifySession(at).session).toBe('CLOSED');
  });

  it('summer Mon 21:00 UTC = CLOSED (NY EDT 17:00 boundary)', () => {
    const at = new Date(Date.UTC(2025, 6, 7, 21, 0, 0)).toISOString();
    expect(classifySession(at).session).toBe('CLOSED');
  });

  it('EU DST spring-forward: London opens at 07:00 UTC in BST (was 08:00 in GMT)', () => {
    // Mar 24 2025: London still GMT (DST starts Mar 30)
    // Apr 7 2025: London BST
    const beforeDst = new Date(Date.UTC(2025, 2, 24, 7, 30, 0)).toISOString();
    const afterDst  = new Date(Date.UTC(2025, 3, 7,  7, 30, 0)).toISOString();
    expect(classifySession(beforeDst).session).toBe('ASIA');   // London still closed
    expect(classifySession(afterDst).session).toBe('LONDON'); // London open
  });

  it('US DST spring-forward: NY opens at 12:00 UTC in EDT (was 13:00 in EST)', () => {
    // Mar 3 2025: NY still EST (DST starts Mar 9)
    // Mar 10 2025: NY EDT
    const beforeDst = new Date(Date.UTC(2025, 2, 3,  12, 30, 0)).toISOString();
    const afterDst  = new Date(Date.UTC(2025, 2, 10, 12, 30, 0)).toISOString();
    expect(classifySession(beforeDst).session).toBe('LONDON');        // NY closed
    expect(classifySession(afterDst).session).toBe('OVERLAP_LD_NY');  // NY open
  });

  it('EU DST fall-back: London closes at 16:00 UTC in BST, 17:00 UTC in GMT', () => {
    // Oct 20 2025 (BST, UTC+1): 16:30 UTC = 17:30 London local → London closed.
    // Nov 3 2025 (GMT, UTC+0): 16:30 UTC = 16:30 London local → London open.
    // NY is open in both cases (12:30 EDT / 11:30 EST) → contributes to result.
    const beforeFallBack = new Date(Date.UTC(2025, 9, 20, 16, 30, 0)).toISOString(); // BST
    const afterFallBack  = new Date(Date.UTC(2025, 10, 3, 16, 30, 0)).toISOString(); // GMT
    expect(classifySession(beforeFallBack).session).toBe('NEW_YORK');      // London closed, NY only
    expect(classifySession(afterFallBack).session).toBe('OVERLAP_LD_NY');  // London + NY both open
  });
});

describe('Market open/close — DST aware (§7)', () => {
  it('winter Sunday 21:00 UTC = CLOSED (NY EST 16:00, before 17:00 open)', () => {
    const at = new Date(Date.UTC(2025, 0, 5, 21, 0, 0)).toISOString();
    expect(classifySession(at).is_market_open).toBe(false);
  });

  it('winter Sunday 22:00 UTC = OPEN (NY EST 17:00)', () => {
    const at = new Date(Date.UTC(2025, 0, 5, 22, 0, 0)).toISOString();
    expect(classifySession(at).is_market_open).toBe(true);
  });

  it('summer Sunday 20:30 UTC = CLOSED (NY EDT 16:30, before 17:00)', () => {
    const at = new Date(Date.UTC(2025, 6, 6, 20, 30, 0)).toISOString();
    expect(classifySession(at).is_market_open).toBe(false);
  });

  it('summer Sunday 21:00 UTC = OPEN (NY EDT 17:00)', () => {
    const at = new Date(Date.UTC(2025, 6, 6, 21, 0, 0)).toISOString();
    expect(classifySession(at).is_market_open).toBe(true);
  });

  it('winter Friday 21:00 UTC = OPEN (NY EST 16:00, before close)', () => {
    const at = new Date(Date.UTC(2025, 0, 10, 21, 0, 0)).toISOString();
    expect(classifySession(at).is_market_open).toBe(true);
  });

  it('winter Friday 22:00 UTC = CLOSED (NY EST 17:00, at close)', () => {
    const at = new Date(Date.UTC(2025, 0, 10, 22, 0, 0)).toISOString();
    expect(classifySession(at).is_market_open).toBe(false);
  });

  it('summer Friday 21:00 UTC = CLOSED (NY EDT 17:00, at close)', () => {
    const at = new Date(Date.UTC(2025, 6, 11, 21, 0, 0)).toISOString();
    expect(classifySession(at).is_market_open).toBe(false);
  });

  it('invalid timestamp fails safe to CLOSED', () => {
    const s = classifySession('not-a-date');
    expect(s.session).toBe('CLOSED');
    expect(s.is_market_open).toBe(false);
  });
});
