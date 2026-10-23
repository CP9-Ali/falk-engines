import type { Timestamp } from '../core/types';

export type SessionName = 'ASIA' | 'LONDON' | 'NEW_YORK' | 'OVERLAP_LD_NY' | 'CLOSED';

export interface SessionWindow {
  readonly name: SessionName;
  readonly fromUtcHour: number;
  readonly toUtcHour: number;
}

/** XAU/USD: 24/5. الجلسات تقريبية UTC. */
const SESSIONS: SessionWindow[] = [
  { name: 'ASIA',          fromUtcHour: 0,  toUtcHour: 9  },
  { name: 'LONDON',        fromUtcHour: 8,  toUtcHour: 17 },
  { name: 'NEW_YORK',      fromUtcHour: 13, toUtcHour: 22 },
];

export interface SessionInfo {
  readonly session: SessionName;
  readonly is_market_open: boolean;
  readonly is_weekend: boolean;
  readonly is_high_liquidity: boolean;
  readonly utc_hour: number;
  readonly utc_day_of_week: number;
}

/** §7:Session Calendar — يحدد ما إذا كان الوقت ضمن سوق مفتوح */
export function classifySession(at: Timestamp): SessionInfo {
  const d = new Date(at);
  const hour = d.getUTCHours();
  const dow = d.getUTCDay(); // 0=Sunday, 6=Saturday

  const is_weekend = dow === 6 || (dow === 0 && hour < 22);

  let session: SessionName = 'CLOSED';
  if (!is_weekend) {
    // Overlap London+NY: 13-17
    if (hour >= 13 && hour < 17) session = 'OVERLAP_LD_NY';
    else if (hour >= 8 && hour < 17) session = 'LONDON';
    else if (hour >= 13 && hour < 22) session = 'NEW_YORK';
    else if (hour >= 0 && hour < 9) session = 'ASIA';
    else session = 'CLOSED';
  }

  const is_market_open = !is_weekend;
  const is_high_liquidity = session === 'OVERLAP_LD_NY' || session === 'LONDON' || session === 'NEW_YORK';

  return {
    session,
    is_market_open,
    is_weekend,
    is_high_liquidity,
    utc_hour: hour,
    utc_day_of_week: dow,
  };
}

/** §6.2: يميز gap عطلة عن gap خطأ تغذية */
export type GapType = 'EXPECTED_MARKET_CLOSED' | 'UNEXPECTED_FEED_ERROR';

export interface GapAnalysis {
  readonly from: Timestamp;
  readonly to: Timestamp;
  readonly duration_ms: number;
  readonly expected_candles: number;
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

  // §6.2: الفجوة عطلة نهاية الأسبوع = متوقعة
  let touchesWeekend = false;
  let cursor = new Date(from);
  let guard = 0;
  while (cursor < to && guard < 20_000) {
    const dow = cursor.getUTCDay();
    if (dow === 6 || dow === 0) { touchesWeekend = true; break; }
    cursor = new Date(cursor.getTime() + timeframeMs);
    guard++;
  }

  if (touchesWeekend && duration_ms <= 3 * 24 * 60 * 60 * 1000) {
    return {
      from: fromUtc, to: toUtc, duration_ms, expected_candles,
      gap_type: 'EXPECTED_MARKET_CLOSED',
      reason: 'weekend close',
    };
  }

  if (expected_candles > 60) {
    return {
      from: fromUtc, to: toUtc, duration_ms, expected_candles,
      gap_type: 'UNEXPECTED_FEED_ERROR',
      reason: 'gap > 60 candles without weekend',
    };
  }

  return {
    from: fromUtc, to: toUtc, duration_ms, expected_candles,
    gap_type: 'UNEXPECTED_FEED_ERROR',
    reason: 'intraday gap',
  };
}