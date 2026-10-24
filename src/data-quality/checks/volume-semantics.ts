import type { QualityCheck } from './base';
import type { QualityFinding } from '../types';
import { VOLUME_SEMANTICS_BY_SOURCE } from '../../normalization/canonical';

/**
 * DQ-VOLUME-SEMANTICS: يحذر عندما يعرض المصدر حجماً لكن دلالته غير مسجلة (UNKNOWN)
 */
export const volumeSemanticsCheck: QualityCheck = {
  checkId: 'DQ-VOLUME-SEMANTICS',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out: QualityFinding[] = [];
    const semantics = VOLUME_SEMANTICS_BY_SOURCE[ctx.sourceId] ?? 'UNKNOWN';
    if (semantics !== 'UNKNOWN') return out;

    const withVolume = ctx.points.filter(p => Number.isFinite(p.value.volume) && p.value.volume > 0);
    if (withVolume.length === 0) return out;

    const first = withVolume[0];
    const last = withVolume[withVolume.length - 1];
    if (!first || !last) return out;

    out.push({
      checkId: 'DQ-VOLUME-SEMANTICS-001',
      category: 'SUITABILITY' as const,
      severity: 'WARNING' as const,
      message: ctx.sourceId + ' reports volume but semantics is UNKNOWN (' + withVolume.length + '/' + ctx.points.length + ' points affected)',
      affectedRange: { from: first.eventTime, to: last.eventTime },
      evidence: {
        sourceId: ctx.sourceId,
        affectedPoints: withVolume.length,
        totalPoints: ctx.points.length,
      },
    });
    return out;
  },
};
