import type { QualityCheck, CheckContext, Candle } from './base';

export const schemaCheck: QualityCheck = {
  checkId: 'DQ-SCHEMA',
  run(ctx: CheckContext<Candle>) {
    const out = [];
    const required: Record<string, 'number' | 'string'> = {
      open: 'number', high: 'number', low: 'number', close: 'number', volume: 'number',
    };
    for (const p of ctx.points) {
      for (const [field, expected] of Object.entries(required)) {
        const v = (p.value as any)[field];
        if (v === undefined || v === null) {
          out.push({
            checkId: 'DQ-SCHEMA-001', category: 'STRUCTURAL' as const, severity: 'CRITICAL' as const,
            message: 'missing field "' + field + '" at ' + p.eventTime,
            affectedRange: { from: p.eventTime, to: p.eventTime },
          });
        } else if (typeof v !== expected) {
          out.push({
            checkId: 'DQ-SCHEMA-002', category: 'STRUCTURAL' as const, severity: 'HIGH' as const,
            message: 'field "' + field + '" has type ' + typeof v + ' (expected ' + expected + ')',
            affectedRange: { from: p.eventTime, to: p.eventTime },
          });
        }
      }
      if (!p.sourceId) {
        out.push({
          checkId: 'DQ-SCHEMA-003', category: 'STRUCTURAL' as const, severity: 'HIGH' as const,
          message: 'missing sourceId at ' + p.eventTime,
          affectedRange: { from: p.eventTime, to: p.eventTime },
        });
      }
      if (!p.eventTime || !p.availabilityTime) {
        out.push({
          checkId: 'DQ-SCHEMA-004', category: 'STRUCTURAL' as const, severity: 'HIGH' as const,
          message: 'missing event/availability time',
          affectedRange: { from: p.eventTime || ctx.range.from, to: p.eventTime || ctx.range.to },
        });
      }
    }
    return out;
  },
};