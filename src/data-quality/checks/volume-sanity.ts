import type { QualityCheck } from './base';
import type { QualityFinding } from '../types';
import { VOLUME_SEMANTICS_BY_SOURCE } from '../../normalization/canonical';

/**
 * DQ-VOLUME-SANITY: يكشف قيم حجم غير منطقية لمصادر TICK/REAL
 * - CRITICAL: حجم سالب (مستحيل)
 * - WARNING: > 50% صفر (مشبوه لمصدر TICK)
 * - WARNING: قفزات x1000+ (احتمال وحدة خاطئة)
 * UNKNOWN و CONTRACT مستثنيان (لهما فحصهما الخاص).
 */
export const volumeSanityCheck: QualityCheck = {
  checkId: 'DQ-VOLUME-SANITY',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out: QualityFinding[] = [];
    const semantics = VOLUME_SEMANTICS_BY_SOURCE[ctx.sourceId] ?? 'UNKNOWN';
    if (semantics === 'UNKNOWN' || semantics === 'CONTRACT') return out;

    // 1) Negative volume = CRITICAL
    const negatives = ctx.points.filter(p =>
      Number.isFinite(p.value.volume) && p.value.volume < 0);
    if (negatives.length > 0) {
      const first = negatives[0]!;
      const last = negatives[negatives.length - 1]!;
      out.push({
        checkId: 'DQ-VOLUME-SANITY-001',
        category: 'STRUCTURAL' as const,
        severity: 'CRITICAL' as const,
        message: negatives.length + ' candles with negative volume',
        affectedRange: { from: first.eventTime, to: last.eventTime },
        evidence: {
          count: negatives.length,
          sample: negatives.slice(0, 3).map(p => ({ t: p.eventTime, v: p.value.volume })),
        },
      });
    }

    // 2) >50% zero-volume for TICK/REAL source = WARNING
    const zeros = ctx.points.filter(p => p.value.volume === 0);
    if (ctx.points.length > 0 && zeros.length > ctx.points.length * 0.5) {
      out.push({
        checkId: 'DQ-VOLUME-SANITY-002',
        category: 'ANOMALY' as const,
        severity: 'WARNING' as const,
        message: zeros.length + '/' + ctx.points.length + ' candles with zero volume (suspicious for ' + semantics + ' source)',
        affectedRange: { from: ctx.range.from, to: ctx.range.to },
        evidence: {
          zeroCount: zeros.length,
          totalCount: ctx.points.length,
          semantics,
        },
      });
    }

    // 3) Volume spikes x1000+ = WARNING
    const sorted = [...ctx.points].sort((a, b) =>
      new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());
    let jumpCount = 0;
    let jumpStart: string | null = null;
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!.value.volume;
      const cur = sorted[i]!.value.volume;
      if (Number.isFinite(prev) && Number.isFinite(cur) && prev > 0 && cur > prev * 1000) {
        jumpCount++;
        if (!jumpStart) jumpStart = sorted[i]!.eventTime;
      }
    }
    if (jumpCount > 0 && jumpStart) {
      out.push({
        checkId: 'DQ-VOLUME-SANITY-003',
        category: 'ANOMALY' as const,
        severity: 'WARNING' as const,
        message: jumpCount + ' volume spikes (x1000+)',
        affectedRange: { from: jumpStart, to: jumpStart },
        evidence: { jumpCount },
      });
    }

    return out;
  },
};
