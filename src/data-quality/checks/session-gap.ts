import type { QualityCheck } from './base';
import type { QualityFinding } from '../types';
import { classifySession } from '../../calendar/session-calendar';

/**
 * DQ-SESSION-GAP: يكشف مشاكل التزامن مع ساعات السوق
 * - CRITICAL: candle في ساعة مغلقة (مستحيل منطقياً — مصدر بتوقيت خاطئ)
 * - HIGH: candle مفقودة في ساعة مفتوحة (فقدان بيانات فعلية)
 */
export const sessionGapCheck: QualityCheck = {
  checkId: 'DQ-SESSION-GAP',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out: QualityFinding[] = [];

    // 1) Candles during market-closed hours = CRITICAL (source clock/timezone error)
    const inClosed: typeof ctx.points[number][] = [];
    for (const p of ctx.points) {
      const info = classifySession(p.eventTime);
      if (!info.is_market_open) inClosed.push(p);
    }
    if (inClosed.length > 0) {
      const first = inClosed[0]!;
      const last = inClosed[inClosed.length - 1]!;
      out.push({
        checkId: 'DQ-SESSION-GAP-001',
        category: 'STRUCTURAL' as const,
        severity: 'CRITICAL' as const,
        message: inClosed.length + ' candles during market-closed hours — possible source clock/timezone error',
        affectedRange: { from: first.eventTime, to: last.eventTime },
        evidence: {
          count: inClosed.length,
          sampleTimes: inClosed.slice(0, 3).map(p => p.eventTime),
        },
      });
    }

    // 2) Missing candles during market-open hours = HIGH
    const sorted = [...ctx.points].sort((a, b) =>
      new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());

    let missingCount = 0;
    let gapStart: string | null = null;
    let gapEnd: string | null = null;

    for (let i = 1; i < sorted.length; i++) {
      const prevMs = new Date(sorted[i - 1]!.eventTime).getTime();
      const curMs = new Date(sorted[i]!.eventTime).getTime();
      if (curMs - prevMs <= ctx.expectedCadenceMs * 1.5) continue;

      let walk = prevMs + ctx.expectedCadenceMs;
      let localStart: string | null = null;
      let localEnd: string | null = null;
      let guard = 0;
      while (walk < curMs && guard < 10_000) {
        const info = classifySession(new Date(walk).toISOString());
        if (info.is_market_open) {
          missingCount++;
          if (!localStart) localStart = new Date(walk).toISOString();
          localEnd = new Date(walk).toISOString();
        }
        walk += ctx.expectedCadenceMs;
        guard++;
      }
      if (localStart && !gapStart) gapStart = localStart;
      if (localEnd) gapEnd = localEnd;
    }

    if (missingCount > 0 && gapStart && gapEnd) {
      out.push({
        checkId: 'DQ-SESSION-GAP-002',
        category: 'COMPLETENESS' as const,
        severity: 'HIGH' as const,
        message: missingCount + ' missing candles during market-open hours',
        affectedRange: { from: gapStart, to: gapEnd },
        evidence: { missingCount },
      });
    }

    return out;
  },
};
