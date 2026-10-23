import type { QualityCheck, CheckContext, Candle } from './base';

/**
 * §6.1: تحقق عابر للحقول.
 * يكشف حالات لا تكفي فيها الفحوص الفردية.
 */
export const crossFieldCheck: QualityCheck = {
  checkId: 'DQ-CROSS',
  run(ctx: CheckContext<Candle>) {
    const out = [];
    for (const p of ctx.points) {
      const { open, high, low, close, volume } = p.value;

      // open و close يجب أن يكونا داخل [low, high]
      if (Number.isFinite(open) && Number.isFinite(high) && Number.isFinite(low)) {
        if (open < low || open > high) {
          out.push({
            checkId: 'DQ-CROSS-001', category: 'STRUCTURAL' as const, severity: 'HIGH' as const,
            message: 'open outside [low, high] at ' + p.eventTime,
            affectedRange: { from: p.eventTime, to: p.eventTime },
            evidence: { open, low, high },
          });
        }
        if (close < low || close > high) {
          out.push({
            checkId: 'DQ-CROSS-002', category: 'STRUCTURAL' as const, severity: 'HIGH' as const,
            message: 'close outside [low, high] at ' + p.eventTime,
            affectedRange: { from: p.eventTime, to: p.eventTime },
            evidence: { close, low, high },
          });
        }
      }

      // volume يجب أن يكون غير سالب
      if (Number.isFinite(volume) && volume < 0) {
        out.push({
          checkId: 'DQ-CROSS-003', category: 'STRUCTURAL' as const, severity: 'HIGH' as const,
          message: 'negative volume at ' + p.eventTime,
          affectedRange: { from: p.eventTime, to: p.eventTime },
        });
      }

      // high - low يجب أن يكون ≥ 0 (عبر الحقول)
      if (Number.isFinite(high) && Number.isFinite(low) && high < low) {
        out.push({
          checkId: 'DQ-CROSS-004', category: 'STRUCTURAL' as const, severity: 'CRITICAL' as const,
          message: 'high < low (cross-field) at ' + p.eventTime,
          affectedRange: { from: p.eventTime, to: p.eventTime },
        });
      }
    }
    return out;
  },
};