import type { QualityCheck } from './base';

/**
 * §6: Timestamp Validator — يفحص:
 * - الترتيب الرتيب (monotonic)
 * - تأخر الوصول (arrival - event)
 * - قيمة غير منطقية (event في المستقبل البعيد)
 * - availability < event (مستحيل منطقياً)
 */
export const timestampCheck: QualityCheck = {
  checkId: 'DQ-TIMESTAMP',
  run(ctx) {
    const out = [];
    const nowMs = new Date(ctx.asOfCutoff).getTime();
    const MAX_DELAY_MS = 5 * 60_000; // 5 دقائق
    let prevEventMs = 0;

    for (const p of ctx.points) {
      const eventMs = new Date(p.eventTime).getTime();
      const arrivalMs = new Date(p.arrivalTime).getTime();
      const availabilityMs = new Date(p.availabilityTime).getTime();

      // 1) غير قابل للتحليل
      if (!Number.isFinite(eventMs)) {
        out.push({
          checkId: 'DQ-TIMESTAMP-001', category: 'FRESHNESS' as const, severity: 'CRITICAL' as const,
          message: 'invalid event_time: ' + p.eventTime,
          affectedRange: { from: ctx.range.from, to: ctx.range.to },
        });
        continue;
      }

      // 2) حدث في المستقبل (بعد cutoff)
      if (eventMs > nowMs + 60_000) {
        out.push({
          checkId: 'DQ-TIMESTAMP-002', category: 'FRESHNESS' as const, severity: 'HIGH' as const,
          message: 'event_time in future: ' + p.eventTime + ' > ' + ctx.asOfCutoff,
          affectedRange: { from: p.eventTime, to: p.eventTime },
        });
      }

      // 3) availability < event (مستحيل: لا يمكن أن تكون متاحة قبل حدوثها)
      if (Number.isFinite(availabilityMs) && availabilityMs < eventMs - 1000) {
        out.push({
          checkId: 'DQ-TIMESTAMP-003', category: 'FRESHNESS' as const, severity: 'HIGH' as const,
          message: 'availability_time (' + p.availabilityTime + ') < event_time (' + p.eventTime + ')',
          affectedRange: { from: p.eventTime, to: p.eventTime },
        });
      }

      // 4) تأخر الوصول الكبير
      if (Number.isFinite(arrivalMs) && arrivalMs - eventMs > MAX_DELAY_MS) {
        out.push({
          checkId: 'DQ-TIMESTAMP-004', category: 'FRESHNESS' as const, severity: 'WARNING' as const,
          message: 'arrival delayed ' + Math.round((arrivalMs - eventMs) / 1000) + 's',
          affectedRange: { from: p.eventTime, to: p.arrivalTime },
        });
      }

      // 5) ترتيب رتيب
      if (prevEventMs > 0 && eventMs < prevEventMs - 1000) {
        out.push({
          checkId: 'DQ-TIMESTAMP-005', category: 'FRESHNESS' as const, severity: 'HIGH' as const,
          message: 'event_time out of order: ' + p.eventTime + ' < ' + new Date(prevEventMs).toISOString(),
          affectedRange: { from: new Date(prevEventMs).toISOString(), to: p.eventTime },
        });
      }
      prevEventMs = eventMs;
    }
    return out;
  },
};