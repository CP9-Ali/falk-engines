import type { QualityCheck } from './base';
import { isAtOrBefore } from '../../core/time';

export interface TaskRequirement {
  readonly minLookbackMs: number;
  readonly maxGapMs: number;
}

export const makeSuitabilityCheck = (req: TaskRequirement): QualityCheck => ({
  checkId: 'DQ-SUIT',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out = [];
    const available = ctx.points
      .filter(p => isAtOrBefore(p.availabilityTime, ctx.asOfCutoff))
      .sort((a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());

    if (available.length === 0) {
      out.push({
        checkId: 'DQ-SUIT-001', category: 'SUITABILITY' as const, severity: 'CRITICAL' as const,
        message: 'No available points at as-of cutoff',
      });
      return out;
    }

    const cutoffMs = new Date(ctx.asOfCutoff).getTime();
    const earliestMs = new Date(available[0]!.eventTime).getTime();
    if (cutoffMs - earliestMs < req.minLookbackMs) {
      out.push({
        checkId: 'DQ-SUIT-002', category: 'SUITABILITY' as const, severity: 'HIGH' as const,
        message: `Insufficient lookback: ${cutoffMs - earliestMs}ms < required ${req.minLookbackMs}ms`,
      });
    }
    for (let i = 1; i < available.length; i++) {
      const gap = new Date(available[i]!.eventTime).getTime() - new Date(available[i - 1]!.eventTime).getTime();
      if (gap > req.maxGapMs) {
        out.push({
          checkId: 'DQ-SUIT-003', category: 'SUITABILITY' as const, severity: 'HIGH' as const,
          message: `Gap ${gap}ms exceeds task maxGap ${req.maxGapMs}ms`,
          affectedRange: { from: available[i - 1]!.eventTime, to: available[i]!.eventTime },
        });
      }
    }
    return out;
  },
});