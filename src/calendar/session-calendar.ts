import type { Timestamp } from '../core/types';

export type SessionName = 'ASIA' | 'LONDON' | 'NEW_YORK' | 'OVERLAP_LD_NY' | 'CLOSED';

/** @deprecated — kept for backward compat; classification is now DST-aware via local timezones */
export interface SessionWindow {
  readonly name: SessionName;
  readonly fromUtcHour: number;
  readonly toUtcHour: number;
}

/** @deprecated — legacy UTC-hour windows, not used for classification anymore */
const SESSIONS: SessionWindow[] = [
  { name: 'ASIA',          fromUtcHour: 0,  toUtcHour: 9  },
  { name: 'LONDON',        fromUtcHour: 8,  toUtcHour: 17 },
  { name: 'NEW_YORK',      fromUtcHour: 13, toUtcHour: 22 },
];

// =====================================================================
// Stage 3: DST-aware session definitions in local timezones.
// Local windows are chosen to preserve the winter (January) behavior
// of the legacy UTC windows, so old expectations hold in winter and
// now also work correctly in summer (BST/EDT).
// =====================================================================

interface LocalSessionDef {
  readonly name: SessionName;
  readonly tz: string;
  readonly openLocalMin: number;   // inclusive
  readonly closeLocalMin: number;  // exclusive
}

const ASIA_SESSION:   LocalSessionDef = { name: 'ASIA',     tz: 'Asia/Tokyo',       openLocalMin: 9 * 60, closeLocalMin: 18 * 60 };
const LONDON_SESSION: LocalSessionDef = { name: 'LONDON',   tz: 'Europe/London',    openLocalMin: 8 * 60, closeLocalMin: 17 * 60 };
const NY_SESSION:     LocalSessionDef = { name: 'NEW_YORK', tz: 'America/New_York', openLocalMin: 8 * 60, closeLocalMin: 17 * 60 };

// Market boundaries — anchored to NY local time so DST shifts are automatic.
const MARKET_TZ             = 'America/New_York';
const MARKET_CLOSE_FRIDAY   = 17 * 60;  // Friday 17:00 NY → market closed
const MARKET_OPEN_SUNDAY    = 17 * 60;  // Sunday 17:00 NY → market open

export interface SessionInfo {
  readonly session: SessionName;
  readonly is_market_open: boolean;
  readonly is_weekend: boolean;
  readonly is_high_liquidity: boolean;
  readonly utc_hour: number;
  readonly utc_day_of_week: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>();

function getFormatter(tz: string): Intl.DateTimeFormat {
  let f = FORMATTER_CACHE.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      weekday: 'short', hour: '2-digit', minute: '2-digit',
    });
    FORMATTER_CACHE.set(tz, f);
  }
  return f;
}

interface LocalParts {
  readonly weekday: number;
  readonly minutesOfDay: number;
}

function getLocalParts(utcMs: number, timeZone: string): LocalParts {
  const parts = getFormatter(timeZone).formatToParts(new Date(utcMs));
  const get = (t: string): string => parts.find(p => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  return {
    weekday: WEEKDAY_MAP[get('weekday')] ?? 0,
    minutesOfDay: hour * 60 + minute,
  };
}

function isSessionOpenLocal(utcMs: number, def: LocalSessionDef): boolean {
  const local = getLocalParts(utcMs, def.tz);
  if (local.weekday === 0 || local.weekday === 6) return false;
  return local.minutesOfDay >= def.openLocalMin && local.minutesOfDay < def.closeLocalMin;
}

function classifyBySession(utcMs: number): SessionName {
  const london = isSessionOpenLocal(utcMs, LONDON_SESSION);
  const ny     = isSessionOpenLocal(utcMs, NY_SESSION);
  const asia   = isSessionOpenLocal(utcMs, ASIA_SESSION);
  if (london && ny) return 'OVERLAP_LD_NY';
  if (london) return 'LONDON';
  if (ny) return 'NEW_YORK';
  if (asia) return 'ASIA';
  return 'CLOSED';
}

function computeMarketOpen(utcMs: number): boolean {
  const ny = getLocalParts(utcMs, MARKET_TZ);
  if (ny.weekday === 6) return false;                                            // Saturday
  if (ny.weekday === 5 && ny.minutesOfDay >= MARKET_CLOSE_FRIDAY) return false;  // Friday after close
  if (ny.weekday === 0) return ny.minutesOfDay >= MARKET_OPEN_SUNDAY;            // Sunday: open only after 17:00
  return true;                                                                    // Mon-Thu: open
}

/** §7: Session Calendar — DST-aware session classification */
export function classifySession(at: Timestamp): SessionInfo {
  const d = new Date(at);
  const utcMs = d.getTime();

  if (!Number.isFinite(utcMs)) {
    return {
      session: 'CLOSED',
      is_market_open: false,
      is_weekend: false,
      is_high_liquidity: false,
      utc_hour: 0,
      utc_day_of_week: 0,
    };
  }

  const market_open = computeMarketOpen(utcMs);
  const session = market_open ? classifyBySession(utcMs) : 'CLOSED';
  const is_high_liquidity = session === 'OVERLAP_LD_NY' || session === 'LONDON' || session === 'NEW_YORK';

  return {
    session,
    is_market_open: market_open,
    is_weekend: !market_open,
    is_high_liquidity,
    utc_hour: d.getUTCHours(),
    utc_day_of_week: d.getUTCDay(),
  };
}

/** §6.2: Gap classification */
export type GapType = 'EXPECTED_MARKET_CLOSED' | 'UNEXPECTED_FEED_ERROR';

export interface GapAnalysis {
  readonly from: Timestamp;
  readonly to: Timestamp;
  readonly duration_ms: number;
  readonly expected_candles: number;
  /** Stage 4: number of candles during market-open (missing data) */
  readonly open_candles: number;
  /** Stage 4: number of candles during market-closed (expected absence) */
  readonly closed_candles: number;
  /** Stage 4: true if there is any open-market candle worth refetching */
  readonly needs_refetch: boolean;
  readonly gap_type: GapType;
  readonly reason: string;
}

export function classifyGap(
  fromUtc: Timestamp,
  toUtc: Timestamp,
  timeframeMs: number,
): GapAnalysis {
  const from = new Date(fromUtc);
  const to = new Date(toUtc);
  const duration_ms = to.getTime() - from.getTime();
  const expected_candles = Math.max(0, Math.round(duration_ms / timeframeMs) - 1);

  // Stage 4: walk each interior candle and classify it by market-open state.
  // This replaces the pre-Stage-4 "touches UTC weekend" heuristic, which was
  // wrong at Friday-evening (closed but weekday) and Sunday-evening (open but weekend).
  let open_candles = 0;
  let closed_candles = 0;
  let touchesMarketClosed = false;
  let cursor = new Date(from.getTime() + timeframeMs);
  let guard = 0;
  while (cursor.getTime() < to.getTime() && guard < 50_000) {
    const info = classifySession(cursor.toISOString());
    if (info.is_market_open) {
      open_candles++;
    } else {
      closed_candles++;
      touchesMarketClosed = true;
    }
    cursor = new Date(cursor.getTime() + timeframeMs);
    guard++;
  }

  const needs_refetch = open_candles > 0;

  // Compat: preserve "weekend-spanning gap = EXPECTED" for reasonable durations.
  if (touchesMarketClosed && duration_ms <= 3 * 24 * 60 * 60 * 1000) {
    return {
      from: fromUtc, to: toUtc, duration_ms, expected_candles,
      open_candles, closed_candles, needs_refetch,
      gap_type: 'EXPECTED_MARKET_CLOSED',
      reason: spansUtcWeekend(from.getTime(), to.getTime())
        ? 'weekend market close'
        : 'market closed during gap',
    };
  }

  if (expected_candles > 60) {
    return {
      from: fromUtc, to: toUtc, duration_ms, expected_candles,
      open_candles, closed_candles, needs_refetch,
      gap_type: 'UNEXPECTED_FEED_ERROR',
      reason: 'gap > 60 candles without market-closed period',
    };
  }

  return {
    from: fromUtc, to: toUtc, duration_ms, expected_candles,
    open_candles, closed_candles, needs_refetch,
    gap_type: 'UNEXPECTED_FEED_ERROR',
    reason: 'intraday gap during market-open hours',
  };
}

/** Stage 4: true if the UTC range [fromMs, toMs] covers any Sat/Sun day. */
function spansUtcWeekend(fromMs: number, toMs: number): boolean {
  const DAY_MS = 86_400_000;
  const startDay = Math.floor(fromMs / DAY_MS);
  const endDay = Math.floor(toMs / DAY_MS);
  for (let d = startDay; d <= endDay; d++) {
    const dow = new Date(d * DAY_MS).getUTCDay();
    if (dow === 0 || dow === 6) return true;
  }
  return false;
}
