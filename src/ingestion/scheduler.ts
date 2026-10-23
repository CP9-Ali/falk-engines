import type { Timestamp } from '../core/types';
import { classifySession } from '../calendar/session-calendar';

export type TaskType = 'live-tick' | 'history-fetch' | 'news-fetch' | 'calendar-fetch' | 'checkpoint-sync';

export interface ScheduleDecision {
  readonly should_run: boolean;
  readonly reason: string;
  readonly next_run_ms: number | null;
}

/**
 * §5: Scheduler — يراعي جلسات السوق.
 * live-tick + news + calendar تعمل 24/7 (الأخبار تأتي حتى في العطلة).
 * history-fetch يتوقف خلال العطلة.
 */
export class Scheduler {
  shouldRun(taskType: TaskType, nowUtc: Timestamp = new Date().toISOString()): ScheduleDecision {
    // 1) live-tick دائماً
    if (taskType === 'live-tick') {
      return { should_run: true, reason: 'live-tick always active', next_run_ms: null };
    }

    // 2) news + calendar دائماً (تعمل حتى في العطلة)
    if (taskType === 'news-fetch' || taskType === 'calendar-fetch') {
      return { should_run: true, reason: 'news/calendar runs 24/7', next_run_ms: null };
    }

    // 3) checkpoint-sync دائماً (يحتاج لتحديث آخر حالة)
    if (taskType === 'checkpoint-sync') {
      return { should_run: true, reason: 'checkpoint always active', next_run_ms: null };
    }

    // 4) history-fetch فقط خلال السوق المفتوح
    const s = classifySession(nowUtc);
    if (s.is_weekend) {
      return {
        should_run: false,
        reason: 'weekend: market closed',
        next_run_ms: this.msUntilNextWeek(nowUtc),
      };
    }
    if (!s.is_market_open) {
      return { should_run: false, reason: 'market closed', next_run_ms: 60_000 };
    }

    return { should_run: true, reason: 'market open', next_run_ms: null };
  }

  private msUntilNextWeek(nowUtc: Timestamp): number {
    const now = new Date(nowUtc);
    const dow = now.getUTCDay();
    const daysUntilMonday = dow === 0 ? 1 : 7 - dow + 1;
    return daysUntilMonday * 86_400_000;
  }
}