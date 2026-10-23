import type { QualityCheck } from './base';

export const structuralCheck: QualityCheck = {
  checkId: 'DQ-STRUCT',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out = [];
    for (const p of ctx.points) {
      const v = p.value;
      const fields: (keyof typeof v)[] = ['open', 'high', 'low', 'close', 'volume'];
      for (const f of fields) {
        if (!Number.isFinite(v[f])) {
          out.push({
            checkId: 'DQ-STRUCT-001', category: 'STRUCTURAL' as const, severity: 'CRITICAL' as const,
            message: `Field "${f}" is not finite at ${p.eventTime}`,
            affectedRange: { from: p.eventTime, to: p.eventTime },
            evidence: { field: f, value: v[f] },
          });
        }
      }
      if (v.high < v.low) {
        out.push({
          checkId: 'DQ-STRUCT-002', category: 'STRUCTURAL' as const, severity: 'CRITICAL' as const,
          message: `high < low at ${p.eventTime}`,
          affectedRange: { from: p.eventTime, to: p.eventTime },
        });
      }
      if (v.open < v.low || v.open > v.high || v.close < v.low || v.close > v.high) {
        out.push({
          checkId: 'DQ-STRUCT-003', category: 'STRUCTURAL' as const, severity: 'HIGH' as const,
          message: `OHLC invariants violated at ${p.eventTime}`,
          affectedRange: { from: p.eventTime, to: p.eventTime },
          evidence: { o: v.open, h: v.high, l: v.low, c: v.close },
        });
      }
      if (v.volume < 0) {
        out.push({
          checkId: 'DQ-STRUCT-004', category: 'STRUCTURAL' as const, severity: 'HIGH' as const,
          message: `Negative volume at ${p.eventTime}`,
          affectedRange: { from: p.eventTime, to: p.eventTime },
        });
      }
    }
    return out;
  },
};