import { describe, it, expect } from 'vitest';
import { enrichFusionResult } from '../data-fusion/enrich';
import { toFusionReport } from '../data-fusion/report';

type Src = { sourceId: string; value: { close: number } };
const mkSrc = (id: string, close: number): Src => ({ sourceId: id, value: { close } });
const mkResult = (overrides: Record<string, unknown> = {}): any => ({
  conflictStatus: 'CONSISTENT',
  fusedValue: { close: 100 },
  droppedSources: [],
  provenance: [{ sourceId: 'A' }, { sourceId: 'B' }],
  ...overrides,
});
const policy = { policyVersion: 'v1', toleranceBps: 50 };
const opts = { asOfCutoff: '2026-01-01T00:00:00Z', engineVersion: 'test' };

describe('?8.4F ? toFusionReport adapter', () => {
  it('produces FusionReport with all fields populated', () => {
    const enriched = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100.2)], policy, opts);
    const report = toFusionReport(enriched);
    expect(report.report_id).toBe(enriched.report_id);
    expect(report.as_of_cutoff).toBe(opts.asOfCutoff);
    expect(report.policy_version).toBe('v1');
    expect(report.engine_version).toBe('test');
    expect(report.conflict_status).toBe('CONSISTENT');
    expect(report.fused_value).toBe(100);
    expect(report.raw_values).toEqual(enriched.raw_values);
    expect(report.deltas).toEqual(enriched.deltas);
    expect(report.sources_used).toBe(2);
    expect(report.sources_dropped).toEqual([]);
    expect(report.source_counts.total).toBe(2);
    expect(report.source_counts.comparable).toBe(2);
    expect(report.source_counts.blocked).toBe(0);
    expect(report.source_counts.dropped_by_policy).toBe(0);
  });
  it('sources_dropped reflects DROPPED raw values', () => {
    const enriched = enrichFusionResult(
      mkResult({ droppedSources: [{ sourceId: 'B', reason: 'POLICY' }] }),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy, opts,
    );
    expect(toFusionReport(enriched).sources_dropped).toEqual([{ sourceId: 'B', reason: 'POLICY' }]);
  });
  it('null fusedValue ? fused_value: null', () => {
    const enriched = enrichFusionResult(
      mkResult({ fusedValue: null, provenance: [] }),
      [mkSrc('A', 100)],
      policy, opts,
    );
    expect(toFusionReport(enriched).fused_value).toBeNull();
  });
  it('custom accessor extracts fused_value', () => {
    const enriched = enrichFusionResult(
      mkResult({ fusedValue: { open: 55, close: 100 } as any }),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy, opts,
    );
    expect(toFusionReport(enriched, (v: any) => v.open ?? null).fused_value).toBe(55);
  });
});
