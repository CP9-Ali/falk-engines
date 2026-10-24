import { describe, it, expect } from 'vitest';
import { classifySession, classifyGap, currentSessionUtcBounds } from '../calendar/session-calendar';

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


// =====================================================================
// Stage 4: DST-aware classifyGap
// =====================================================================

describe('Gap Classifier — DST aware (§6.2 stage 4)', () => {
  it('winter Fri 21:30-22:30 UTC: gap spans market close → EXPECTED', () => {
    // Fri Jan 10 2025: NY EST close = 17:00 EST = 22:00 UTC
    const fri2130 = new Date(Date.UTC(2025, 0, 10, 21, 30, 0)).toISOString();
    const fri2230 = new Date(Date.UTC(2025, 0, 10, 22, 30, 0)).toISOString();
    const g = classifyGap(fri2130, fri2230, 60_000);
    expect(g.gap_type).toBe('EXPECTED_MARKET_CLOSED');
    expect(g.open_candles).toBeGreaterThan(0);
    expect(g.closed_candles).toBeGreaterThan(0);
    expect(g.needs_refetch).toBe(true);
  });

  it('winter Sun 22:00-23:00 UTC: gap entirely in open market → UNEXPECTED', () => {
    // Sun Jan 5 2025: NY EST open = 17:00 EST = 22:00 UTC
    const sun2200 = new Date(Date.UTC(2025, 0, 5, 22, 0, 0)).toISOString();
    const sun2300 = new Date(Date.UTC(2025, 0, 5, 23, 0, 0)).toISOString();
    const g = classifyGap(sun2200, sun2300, 60_000);
    expect(g.gap_type).toBe('UNEXPECTED_FEED_ERROR');
    expect(g.closed_candles).toBe(0);
    expect(g.open_candles).toBe(59);
    expect(g.needs_refetch).toBe(true);
  });

  it('summer Fri 20:30-21:30 UTC: gap spans market close → EXPECTED', () => {
    // Fri Jul 11 2025: NY EDT close = 17:00 EDT = 21:00 UTC
    const fri2030 = new Date(Date.UTC(2025, 6, 11, 20, 30, 0)).toISOString();
    const fri2130 = new Date(Date.UTC(2025, 6, 11, 21, 30, 0)).toISOString();
    const g = classifyGap(fri2030, fri2130, 60_000);
    expect(g.gap_type).toBe('EXPECTED_MARKET_CLOSED');
    expect(g.open_candles).toBeGreaterThan(0);
    expect(g.closed_candles).toBeGreaterThan(0);
  });

  it('summer Sun 21:00-22:00 UTC: gap entirely in open market → UNEXPECTED', () => {
    // Sun Jul 6 2025: NY EDT open = 17:00 EDT = 21:00 UTC
    const sun2100 = new Date(Date.UTC(2025, 6, 6, 21, 0, 0)).toISOString();
    const sun2200 = new Date(Date.UTC(2025, 6, 6, 22, 0, 0)).toISOString();
    const g = classifyGap(sun2100, sun2200, 60_000);
    expect(g.gap_type).toBe('UNEXPECTED_FEED_ERROR');
    expect(g.closed_candles).toBe(0);
  });

  it('winter weekend gap: needs_refetch true (2h Sunday tail open)', () => {
    const fri22 = new Date(Date.UTC(2025, 0, 3, 22, 0, 0)).toISOString();
    const mon00 = new Date(Date.UTC(2025, 0, 6, 0, 0, 0)).toISOString();
    const g = classifyGap(fri22, mon00, 60_000);
    expect(g.gap_type).toBe('EXPECTED_MARKET_CLOSED');
    expect(g.needs_refetch).toBe(true);
    expect(g.open_candles).toBe(120); // 2h of Sunday evening open market
    expect(g.closed_candles).toBeGreaterThan(2000);
  });

  it('pure market-closed gap: needs_refetch false', () => {
    // Sat Jan 4 12:00 → Sun Jan 5 12:00 (all weekend, no open market)
    const sat12 = new Date(Date.UTC(2025, 0, 4, 12, 0, 0)).toISOString();
    const sun12 = new Date(Date.UTC(2025, 0, 5, 12, 0, 0)).toISOString();
    const g = classifyGap(sat12, sun12, 60_000);
    expect(g.gap_type).toBe('EXPECTED_MARKET_CLOSED');
    expect(g.open_candles).toBe(0);
    expect(g.needs_refetch).toBe(false);
  });
});


// =====================================================================
// Stage 4B: Transition window (EU GMT, US EDT) — Oct 26 to Nov 2
// =====================================================================

describe('Stage 4B — Transition window (EU GMT, US EDT)', () => {
  // Between EU fall-back (last Sun of Oct) and US fall-back (first Sun of Nov),
  // London is on GMT (UTC+0) while NY is still on EDT (UTC-4).
  // This gives a UNIQUE 4-hour London-NY offset (instead of 5h normally)
  // and a 5-hour OVERLAP (12:00-17:00 UTC) instead of 4h.

  describe('Session classification (Mon Oct 27 2025)', () => {
    it('11:30 UTC = LONDON (NY still closed at 07:30 EDT)', () => {
      const at = new Date(Date.UTC(2025, 9, 27, 11, 30, 0)).toISOString();
      expect(classifySession(at).session).toBe('LONDON');
    });

    it('12:30 UTC = OVERLAP (NY opens 08:30 EDT — new overlap start)', () => {
      const at = new Date(Date.UTC(2025, 9, 27, 12, 30, 0)).toISOString();
      expect(classifySession(at).session).toBe('OVERLAP_LD_NY');
    });

    it('14:00 UTC = OVERLAP (mid-overlap)', () => {
      const at = new Date(Date.UTC(2025, 9, 27, 14, 0, 0)).toISOString();
      expect(classifySession(at).session).toBe('OVERLAP_LD_NY');
    });

    it('16:30 UTC = OVERLAP (unlike summer; London still open 16:30 GMT)', () => {
      const at = new Date(Date.UTC(2025, 9, 27, 16, 30, 0)).toISOString();
      expect(classifySession(at).session).toBe('OVERLAP_LD_NY');
    });

    it('17:30 UTC = NEW_YORK (London closes 17:00 GMT)', () => {
      const at = new Date(Date.UTC(2025, 9, 27, 17, 30, 0)).toISOString();
      expect(classifySession(at).session).toBe('NEW_YORK');
    });

    it('20:30 UTC = NEW_YORK (before 17:00 EDT close)', () => {
      const at = new Date(Date.UTC(2025, 9, 27, 20, 30, 0)).toISOString();
      expect(classifySession(at).session).toBe('NEW_YORK');
    });
  });

  describe('Market open/close boundaries', () => {
    it('Sun Oct 26 20:30 UTC = CLOSED (NY 16:30 EDT, before 17:00 open)', () => {
      const at = new Date(Date.UTC(2025, 9, 26, 20, 30, 0)).toISOString();
      expect(classifySession(at).is_market_open).toBe(false);
    });

    it('Sun Oct 26 21:00 UTC = OPEN (NY 17:00 EDT)', () => {
      const at = new Date(Date.UTC(2025, 9, 26, 21, 0, 0)).toISOString();
      expect(classifySession(at).is_market_open).toBe(true);
    });

    it('Fri Oct 31 20:30 UTC = OPEN (before NY 17:00 EDT close)', () => {
      const at = new Date(Date.UTC(2025, 9, 31, 20, 30, 0)).toISOString();
      const s = classifySession(at);
      expect(s.session).toBe('NEW_YORK');
      expect(s.is_market_open).toBe(true);
    });

    it('Fri Oct 31 21:00 UTC = CLOSED (NY 17:00 EDT Friday close)', () => {
      const at = new Date(Date.UTC(2025, 9, 31, 21, 0, 0)).toISOString();
      expect(classifySession(at).is_market_open).toBe(false);
    });

    it('Sun Nov 2 21:00 UTC = CLOSED (US fell back; NY 16:00 EST)', () => {
      const at = new Date(Date.UTC(2025, 10, 2, 21, 0, 0)).toISOString();
      expect(classifySession(at).is_market_open).toBe(false);
    });

    it('Sun Nov 2 22:00 UTC = OPEN (NY 17:00 EST, winter behavior resumed)', () => {
      const at = new Date(Date.UTC(2025, 10, 2, 22, 0, 0)).toISOString();
      expect(classifySession(at).is_market_open).toBe(true);
    });
  });

  describe('Gap classification during transition', () => {
    it('Mon 11:30→12:30 UTC: entire gap in open market → UNEXPECTED', () => {
      const from = new Date(Date.UTC(2025, 9, 27, 11, 30, 0)).toISOString();
      const to = new Date(Date.UTC(2025, 9, 27, 12, 30, 0)).toISOString();
      const g = classifyGap(from, to, 60_000);
      expect(g.gap_type).toBe('UNEXPECTED_FEED_ERROR');
      expect(g.open_candles).toBe(59);
      expect(g.closed_candles).toBe(0);
    });

    it('Fri 20:30→21:30 UTC: spans NY close → EXPECTED', () => {
      const from = new Date(Date.UTC(2025, 9, 31, 20, 30, 0)).toISOString();
      const to = new Date(Date.UTC(2025, 9, 31, 21, 30, 0)).toISOString();
      const g = classifyGap(from, to, 60_000);
      expect(g.gap_type).toBe('EXPECTED_MARKET_CLOSED');
      expect(g.open_candles).toBeGreaterThan(0);
      expect(g.closed_candles).toBeGreaterThan(0);
      expect(g.needs_refetch).toBe(true);
    });
  });
});


// =====================================================================
// Stage 6: currentSessionUtcBounds()
// =====================================================================

describe('Stage 6 — currentSessionUtcBounds()', () => {
  it('winter Mon 10:00 UTC: open, closes Fri 22:00 UTC (4d 12h)', () => {
    const b = currentSessionUtcBounds('2025-01-06T10:00:00.000Z');
    expect(b.session).toBe('LONDON');
    expect(b.is_market_open).toBe(true);
    expect(b.open_utc).toBe('2025-01-05T22:00:00.000Z');
    expect(b.close_utc).toBe('2025-01-10T22:00:00.000Z');
    expect(b.seconds_until_close).toBe(4 * 86400 + 12 * 3600);
    expect(b.seconds_until_next_open).toBeNull();
  });

  it('winter Fri 21:59 UTC: open, closes in 60s', () => {
    const b = currentSessionUtcBounds('2025-01-10T21:59:00.000Z');
    expect(b.session).toBe('NEW_YORK');
    expect(b.is_market_open).toBe(true);
    expect(b.close_utc).toBe('2025-01-10T22:00:00.000Z');
    expect(b.seconds_until_close).toBe(60);
  });

  it('winter Fri 22:00 UTC: closed, opens Sun 22:00 UTC (2d)', () => {
    const b = currentSessionUtcBounds('2025-01-10T22:00:00.000Z');
    expect(b.session).toBe('CLOSED');
    expect(b.is_market_open).toBe(false);
    expect(b.open_utc).toBe('2025-01-12T22:00:00.000Z');
    expect(b.close_utc).toBe('2025-01-17T22:00:00.000Z');
    expect(b.seconds_until_close).toBeNull();
    expect(b.seconds_until_next_open).toBe(2 * 86400);
  });

  it('winter Sat 12:00 UTC: closed, opens Sun 22:00 UTC (34h)', () => {
    const b = currentSessionUtcBounds('2025-01-04T12:00:00.000Z');
    expect(b.is_market_open).toBe(false);
    expect(b.open_utc).toBe('2025-01-05T22:00:00.000Z');
    expect(b.seconds_until_next_open).toBe(34 * 3600);
  });

  it('summer Mon 10:00 UTC: open, closes Fri 21:00 UTC (4d 11h)', () => {
    const b = currentSessionUtcBounds('2025-07-07T10:00:00.000Z');
    expect(b.is_market_open).toBe(true);
    expect(b.open_utc).toBe('2025-07-06T21:00:00.000Z');
    expect(b.close_utc).toBe('2025-07-11T21:00:00.000Z');
    expect(b.seconds_until_close).toBe(4 * 86400 + 11 * 3600);
  });

  it('summer Sun 20:59 UTC: closed, opens in 60s', () => {
    const b = currentSessionUtcBounds('2025-07-06T20:59:00.000Z');
    expect(b.is_market_open).toBe(false);
    expect(b.open_utc).toBe('2025-07-06T21:00:00.000Z');
    expect(b.seconds_until_next_open).toBe(60);
  });

  it('summer Sun 21:00 UTC: open (5-day window)', () => {
    const b = currentSessionUtcBounds('2025-07-06T21:00:00.000Z');
    expect(b.is_market_open).toBe(true);
    expect(b.open_utc).toBe('2025-07-06T21:00:00.000Z');
    expect(b.close_utc).toBe('2025-07-11T21:00:00.000Z');
    expect(b.seconds_until_close).toBe(5 * 86400);
  });

  it('invalid input returns safe defaults', () => {
    const b = currentSessionUtcBounds('not-a-date');
    expect(b.is_market_open).toBe(false);
    expect(b.seconds_until_close).toBeNull();
    expect(b.seconds_until_next_open).toBeNull();
  });
});
