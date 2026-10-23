import type { QualityCheck } from './base';

/**
 * §6: Missing Detector — يفصل بين:
 * - سجل مفقود تماماً (لا موجود)
 * - حقل مفقود داخل سجل (None/undefined)
 * - قيمة سالبة غير منطقية
 *
 * يختلف عن completeness: completeness يبحث عن فجوات زمنية،
 * missing يبحث عن حقول/سجلات غير موجودة.
 */
export const missingCheck: QualityCheck = {
  checkId: 'DQ-MISSING',
  run(ctx) {
    const out = [];
    const requiredFields = ['open', 'high', 'low', 'close', 'volume'];

    for (const p of ctx.points) {
      // 1) السجل نفسه — له eventTime؟
      if (!p.eventTime || p.eventTime === '') {
        out.push({
          checkId: 'DQ-MISSING-001', category: 'COMPLETENESS' as const, severity: 'CRITICAL' as const,
          message: 'record missing event_time',
          evidence: { sourceId: p.sourceId, fingerprint: p.fingerprint },
        });
        continue;
      }

      // 2) الحقول داخل السجل
      for (const field of requiredFields) {
        const v = (p.value as any)[field];
        if (v === null || v === undefined) {
          out.push({
            checkId: 'DQ-MISSING-002', category: 'COMPLETENESS' as const, severity: 'HIGH' as const,
            message: 'field "' + field + '" missing at ' + p.eventTime,
            affectedRange: { from: p.eventTime, to: p.eventTime },
            evidence: { field, value: v },
          });
        } else if (typeof v === 'number' && v < 0 && field !== 'volume') {
          out.push({
            checkId: 'DQ-MISSING-003', category: 'COMPLETENESS' as const, severity: 'HIGH' as const,
            message: 'field "' + field + '" has negative value (' + v + ') at ' + p.eventTime,
            affectedRange: { from: p.eventTime, to: p.eventTime },
          });
        } else if (typeof v === 'number' && v < 0 && field === 'volume') {
          out.push({
            checkId: 'DQ-MISSING-004', category: 'COMPLETENESS' as const, severity: 'WARNING' as const,
            message: 'volume negative (' + v + ') at ' + p.eventTime,
            affectedRange: { from: p.eventTime, to: p.eventTime },
          });
        }
      }

      // 3) availability_time مفقود
      if (!p.availabilityTime) {
        out.push({
          checkId: 'DQ-MISSING-005', category: 'COMPLETENESS' as const, severity: 'HIGH' as const,
          message: 'record missing availability_time at ' + p.eventTime,
          affectedRange: { from: p.eventTime, to: p.eventTime },
        });
      }
    }
    return out;
  },
};