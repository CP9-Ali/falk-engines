import type { QualityCheck } from './base';

export const completenessCheck: QualityCheck = {
  checkId: 'DQ-COMPLETE',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out = [];
    const pts = [...ctx.points].sort(
      (a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime(),
    );
    if (pts.length === 0) {
      return [{
        checkId: 'DQ-COMPLETE-000', category: 'COMPLETENESS' as const, severity: 'CRITICAL' as const,
        message: 'No data at all in requested range',
        affectedRange: ctx.range,
      }];
    }
    const cadence = ctx.expectedCadenceMs;
    const wantFrom = new Date(ctx.range.from).getTime();
    const wantTo = new Date(ctx.range.to).getTime();
    const first = new Date(pts[0]!.eventTime).getTime();
    const last  = new Date(pts[pts.length - 1]!.eventTime).getTime();

    if (first - wantFrom > cadence) {
      out.push({
        checkId: 'DQ-COMPLETE-001', category: 'COMPLETENESS' as const, severity: 'HIGH' as const,
        message: `Missing range start (first=${pts[0]!.eventTime})`,
        affectedRange: { from: ctx.range.from, to: pts[0]!.eventTime },
      });
    }
    if (wantTo - last > cadence) {
      out.push({
        checkId: 'DQ-COMPLETE-002', category: 'COMPLETENESS' as const, severity: 'HIGH' as const,
        message: `Missing range end (last=${pts[pts.length - 1]!.eventTime})`,
        affectedRange: { from: pts[pts.length - 1]!.eventTime, to: ctx.range.to },
      });
    }
    for (let i = 1; i < pts.length; i++) {
      const gap = new Date(pts[i]!.eventTime).getTime() - new Date(pts[i - 1]!.eventTime).getTime();
      if (gap > cadence * 2) {
        out.push({
          checkId: 'DQ-COMPLETE-003', category: 'COMPLETENESS' as const, severity: 'HIGH' as const,
          message: `Gap of ${Math.round(gap / 1000)}s`,
          affectedRange: { from: pts[i - 1]!.eventTime, to: pts[i]!.eventTime },
        });
      }
    }
    return out;
  },
};