import type { QualityCheck, CheckContext, Candle } from './base';

/**
 * §6.2: كشف التكرار الفعلي.
 * المفتاح: (sourceId, eventTime). إذا تكرر → نسخة مصدر مكررة.
 */
export const duplicateCheck: QualityCheck = {
  checkId: 'DQ-DUPLICATE',
  run(ctx: CheckContext<Candle>) {
    const out = [];
    const seen = new Map<string, { count: number; first: number }>();
    for (const p of ctx.points) {
      const key = p.sourceId + '|' + p.eventTime;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { count: 1, first: new Date(p.eventTime).getTime() });
      } else {
        existing.count++;
        if (existing.count === 2) {
          out.push({
            checkId: 'DQ-DUPLICATE-001', category: 'STRUCTURAL' as const, severity: 'HIGH' as const,
            message: 'duplicate candle at ' + p.eventTime + ' from ' + p.sourceId,
            affectedRange: { from: p.eventTime, to: p.eventTime },
            evidence: { key, occurrences: existing.count },
          });
        }
      }
    }
    return out;
  },
};