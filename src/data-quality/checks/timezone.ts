import type { QualityCheck } from './base';
import type { QualityFinding } from '../types';
import { SOURCE_TIMEZONE } from '../../normalization/canonical';

/**
 * DQ-TIMEZONE: يحذر عندما لا يكون للمصدر منطقة زمنية مسجلة
 */
export const timezoneCheck: QualityCheck = {
  checkId: 'DQ-TIMEZONE',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out: QualityFinding[] = [];
    const tz = SOURCE_TIMEZONE[ctx.sourceId];
    if (tz) return out;

    out.push({
      checkId: 'DQ-TIMEZONE-001',
      category: 'FRESHNESS' as const,
      severity: 'HIGH' as const,
      message: 'source ' + ctx.sourceId + ' has no registered timezone — time-sensitive comparisons will be blocked downstream',
      affectedRange: { from: ctx.range.from, to: ctx.range.to },
      evidence: { sourceId: ctx.sourceId },
    });
    return out;
  },
};
