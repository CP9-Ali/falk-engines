import type { QualityCheck } from './base';

export interface AnomalyConfig {
  readonly deviationRatioThreshold: number;
  readonly neighborCount: number;
}

export const makeAnomalyCheck = (cfg: AnomalyConfig): QualityCheck => ({
  checkId: 'DQ-ANOMALY',
  run(ctx) {
    const out = [];
    const pts = [...ctx.points].sort(
      (a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime(),
    );
    if (pts.length < cfg.neighborCount * 2 + 1) return [];

    for (let i = cfg.neighborCount; i < pts.length - cfg.neighborCount; i++) {
      const neighbors = [
        ...pts.slice(i - cfg.neighborCount, i),
        ...pts.slice(i + 1, i + 1 + cfg.neighborCount),
      ].map(p => p.value.close);
      const median = medianOf(neighbors);
      const cur = pts[i]!.value.close;
      if (median === 0) continue;
      const deviation = Math.abs(cur - median) / Math.abs(median);
      if (deviation > cfg.deviationRatioThreshold) {
        out.push({
          checkId: 'DQ-ANOMALY-001',
          category: 'ANOMALY' as const,
          severity: 'HIGH' as const,
          message: `Solo deviation ${(deviation * 100).toFixed(2)}% at ${pts[i]!.eventTime}`,
          affectedRange: { from: pts[i]!.eventTime, to: pts[i]!.eventTime },
          evidence: { value: cur, neighborMedian: median },
        });
      }
    }
    return out;
  },
});

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}