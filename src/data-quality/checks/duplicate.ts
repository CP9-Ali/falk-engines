import type { QualityCheck } from './base';

/**
 * §6.2: record key = source + instrument + timeframe + event time.
 * Detects actual duplicates across the same context.
 */
export const duplicateCheck: QualityCheck = {
  checkId: 'DQ-DUPLICATE',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out = [];
    const inst = ctx.instrument ?? 'XAUUSD';
    const tf = ctx.timeframe ?? 'unknown';
    const seen = new Map<string, { count: number; first: number }>();

    for (const p of ctx.points) {
      // §6.2: full record key
      const key = inst + '|' + tf + '|' + p.sourceId + '|' + p.eventTime;
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, { count: 1, first: new Date(p.eventTime).getTime() });
      } else {
        existing.count++;
        if (existing.count === 2) {
          out.push({
            checkId: 'DQ-DUPLICATE-001',
            checkVersion: '1.0.0',
            category: 'STRUCTURAL' as const,
            severity: 'HIGH' as const,
            message: 'duplicate candle at ' + p.eventTime + ' from ' + p.sourceId,
            affectedRange: { from: p.eventTime, to: p.eventTime },
            evidence: { key, occurrences: existing.count, instrument: inst, timeframe: tf },
          });
        }
      }
    }
    return out;
  },
};