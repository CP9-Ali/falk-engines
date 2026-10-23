import type { QualityCheck } from './base';

export interface FreshnessConfig { readonly maxLagMs: number; }

export const makeFreshnessCheck = (cfg: FreshnessConfig): QualityCheck => ({
  checkId: 'DQ-FRESH',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    if (ctx.points.length === 0) return [];
    const last = [...ctx.points]
      .map(p => new Date(p.eventTime).getTime())
      .reduce((a, b) => Math.max(a, b), 0);
    const cutoff = new Date(ctx.asOfCutoff).getTime();
    const lag = cutoff - last;
    if (lag > cfg.maxLagMs) {
      return [{
        checkId: 'DQ-FRESH-001', category: 'FRESHNESS' as const, severity: 'HIGH' as const,
        message: `Data is ${Math.round(lag / 1000)}s stale (max ${Math.round(cfg.maxLagMs / 1000)}s)`,
        affectedRange: { from: new Date(last).toISOString(), to: ctx.asOfCutoff },
      }];
    }
    return [];
  },
});