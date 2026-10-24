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
const opts = { asOfCutoff: '2026-01-01T00:00:00Z', engineVersion: 'test' };

describe('?8.3 ? independence-aware enrichment', () => {
  it('two sources same key ? INSUFFICIENT_COMPARABLE_DATA', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100.2)],
      policy,
      { ...opts, independenceKeys: { A: 'K', B: 'K' } },
    );
    expect(r.conflictStatus).toBe('INSUFFICIENT_COMPARABLE_DATA');
    expect(r.source_counts.independent_evidence).toBe(1);
    expect(r.deltas).toEqual([]);   // same group ? no cross-group pairs
  });

  it('two sources distinct keys ? CONSISTENT', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100.2)],
      policy,
      { ...opts, independenceKeys: { A: 'K1', B: 'K2' } },
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.source_counts.independent_evidence).toBe(2);
    expect(r.deltas).toHaveLength(1);
  });

  it('three sources two keys ? 2 evidence ? CONSISTENT, 1 cross-group delta', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }, { sourceId: 'B' }, { sourceId: 'C' }] }),
      [mkSrc('A', 100), mkSrc('B', 100.1), mkSrc('C', 100.2)],
      policy,
      { ...opts, independenceKeys: { A: 'K1', B: 'K1', C: 'K2' } },
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.source_counts.independent_evidence).toBe(2);
    expect(r.deltas).toHaveLength(1);   // only K1-representative vs K2
  });

  it('raw_values carry source_independence_key', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy,
      { ...opts, independenceKeys: { A: 'K1', B: 'K2' } },
    );
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.source_independence_key).toBe('K1');
    expect(r.raw_values.find((v) => v.sourceId === 'B')!.source_independence_key).toBe('K2');
  });

  it('without independenceKeys each source = own evidence group', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.source_counts.independent_evidence).toBe(2);
  });

  it('collapsed group does not raise status to CONSISTENT alone', () => {
    // A and B republish same feed; C independent; A,B near 200, C=100 ? 2 evidence, out of tolerance
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }, { sourceId: 'B' }, { sourceId: 'C' }] }),
      [mkSrc('A', 200), mkSrc('B', 200.1), mkSrc('C', 100)],
      { policyVersion: 'v1', toleranceBps: 50 },
      { ...opts, independenceKeys: { A: 'K1', B: 'K1', C: 'K2' } },
    );
    expect(r.source_counts.independent_evidence).toBe(2);
    expect(r.deltas).toHaveLength(1);
    expect(['DISCREPANCY', 'UNRESOLVED_CONFLICT']).toContain(r.conflictStatus);
  });
});
