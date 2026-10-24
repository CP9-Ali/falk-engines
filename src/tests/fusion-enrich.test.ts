import { describe, it, expect } from 'vitest';
import { enrichFusionResult } from '../data-fusion/enrich';

type Src = { sourceId: string; value: { close: number }; timeBlocked?: boolean };

const mkSrc = (id: string, close: number, timeBlocked = false): Src => ({
  sourceId: id,
  value: { close },
  ...(timeBlocked ? { timeBlocked: true } : {}),
});

const mkResult = (overrides: Record<string, unknown> = {}): any => ({
  conflictStatus: 'CONSISTENT',
  fusedValue: { close: 100 },
  droppedSources: [],
  provenance: [{ sourceId: 'A' }, { sourceId: 'B' }],
  ...overrides,
});

const policy = { policyVersion: 'v1', toleranceBps: 50 };
const opts   = { asOfCutoff: '2026-01-01T00:00:00Z', engineVersion: 'test' };

describe('?8.2 ? enrichFusionResult', () => {
  it('two clean sources within tolerance ? CONSISTENT', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100.2)],
      policy, opts,
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.deltas).toHaveLength(1);
    expect(r.raw_values.every((v) => v.status === 'USED')).toBe(true);
    expect(r.source_counts.total).toBe(2);
    expect(r.source_counts.comparable).toBe(2);
  });

  it('two sources beyond tolerance ? DISCREPANCY', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 105)],   // 5% > 0.5% tolerance
      policy, opts,
    );
    expect(r.conflictStatus).toBe('DISCREPANCY');
    expect(r.deltas[0]!.delta_p).toBeCloseTo(-5);
  });

  it('only one comparable source ? INSUFFICIENT_COMPARABLE_DATA', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'B' }], droppedSources: [{ sourceId: 'A', reason: 'TIME_BLOCKED' }] }),
      [mkSrc('A', 100, true), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.conflictStatus).toBe('INSUFFICIENT_COMPARABLE_DATA');
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.status).toBe('BLOCKED');
    expect(r.raw_values.find((v) => v.sourceId === 'B')!.status).toBe('USED');
    expect(r.deltas).toEqual([]);
    expect(r.source_counts.blocked).toBe(1);
  });

  it('outlier policy marks far source as DROPPED', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 101), mkSrc('C', 99), mkSrc('D', 200)],
      policy,
      { ...opts, outlierPolicy: { method: 'MAD', threshold: 3.5 } },
    );
    const d = r.raw_values.find((v) => v.sourceId === 'D')!;
    expect(d.status).toBe('DROPPED');
    expect(d.reason).toBe('OUTLIER_MAD_GT_THRESHOLD');
    expect(r.source_counts.dropped_by_policy).toBe(1);
  });

  it('without outlier policy, far source stays USED/NOT_COMPARABLE', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 101), mkSrc('C', 200)],
      policy, opts,
    );
    const c = r.raw_values.find((v) => v.sourceId === 'C')!;
    expect(c.status).not.toBe('DROPPED');
  });

  it('single price ? deltas: []', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }] }),
      [mkSrc('A', 100)],
      policy, opts,
    );
    expect(r.deltas).toEqual([]);
  });

  it('report metadata populated', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.report_id).toMatch(/^rep-/);
    expect(r.as_of_cutoff).toBe('2026-01-01T00:00:00Z');
    expect(r.policy_version).toBe('v1');
    expect(r.engine_version).toBe('test');
  });

  it('custom fieldAccessor reads a different field', () => {
    const srcs = [
      { sourceId: 'A', value: { open: 1, close: 100 } as any },
      { sourceId: 'B', value: { open: 2, close: 101 } as any },
    ];
    const r = enrichFusionResult(
      mkResult(),
      srcs as any,
      policy,
      { ...opts, fieldName: 'open', fieldAccessor: (v: any) => v.open ?? null },
    );
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.value).toBe(1);
    expect(r.raw_values.find((v) => v.sourceId === 'B')!.value).toBe(2);
  });
});
