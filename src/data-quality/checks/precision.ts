import type { QualityCheck } from './base';
import type { QualityFinding } from '../types';
import { PRECISION_BY_SOURCE } from '../../normalization/canonical';

/**
 * DQ-PRECISION: يكشف انحراف دقة OHLC عن المواصفة المسجلة في PRECISION_BY_SOURCE
 * يستخدم decimal_places (لا tick_size) لتجنب false positives
 */
export const precisionCheck: QualityCheck = {
  checkId: 'DQ-PRECISION',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out: QualityFinding[] = [];
    const spec = PRECISION_BY_SOURCE[ctx.sourceId];
    if (!spec || !Number.isFinite(spec.decimal_places) || spec.decimal_places < 0) {
      return out;
    }
    const multiplier = Math.pow(10, spec.decimal_places);
    for (const p of ctx.points) {
      for (const field of ['open', 'high', 'low', 'close'] as const) {
        const v = p.value[field];
        if (!Number.isFinite(v)) continue;
        const scaled = v * multiplier;
        const drift = Math.abs(scaled - Math.round(scaled));
        if (drift > 1e-6) {
          out.push({
            checkId: 'DQ-PRECISION-001',
            category: 'ANOMALY' as const,
            severity: 'WARNING' as const,
            message: field + '=' + v + ' exceeds ' + spec.decimal_places + ' decimal places (spec drift)',
            affectedRange: { from: p.eventTime, to: p.eventTime },
            evidence: { field, value: v, drift, specDecimalPlaces: spec.decimal_places },
          });
          break;
        }
      }
    }
    return out;
  },
};
