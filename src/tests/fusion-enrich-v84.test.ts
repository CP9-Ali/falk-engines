import { describe, it, expect } from 'vitest';
import { enrichFusionResult } from '../data-fusion/enrich';

type Src = { sourceId: string; value: { close: number }; timeBlocked?: boolean; instrument?: string; lineageId?: string };
const mkSrc = (id: string, close: number, extra: Partial<Src> = {}): Src => ({
  sourceId: id,
  value: { close },
  ...extra,
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

describe('?8.4A ? eligibility per field', () => {
  it('no policy ? all eligible', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100)], policy, opts);
    expect(r.raw_values.every((v) => v.reason !== 'NOT_ELIGIBLE_FOR_FIELD')).toBe(true);
  });
  it('eligibility restricts sources for that field', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }, { sourceId: 'C' }] }),
      [mkSrc('A', 100), mkSrc('B', 100), mkSrc('C', 100)],
      policy,
      { ...opts, eligibilityByField: { close: ['A', 'C'] } },
    );
    const b = r.raw_values.find((v) => v.sourceId === 'B')!;
    expect(b.status).toBe('DROPPED');
    expect(b.reason).toBe('NOT_ELIGIBLE_FOR_FIELD');
  });
  it('other-field rules do not affect this field', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100), mkSrc('C', 100)],
      policy,
      { ...opts, eligibilityByField: { volume: ['A'] } },
    );
    expect(r.raw_values.every((v) => v.reason !== 'NOT_ELIGIBLE_FOR_FIELD')).toBe(true);
  });
  it('ineligible sources reduce independent_evidence', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }] }),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy,
      { ...opts, eligibilityByField: { close: ['A'] } },
    );
    expect(r.source_counts.independent_evidence).toBe(1);
    expect(r.conflictStatus).toBe('INSUFFICIENT_COMPARABLE_DATA');
  });
});

describe('?8.4B ? instrument matching', () => {
  it('no referenceInstrument ? no filter', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { instrument: 'XAUUSD.spot' }), mkSrc('B', 100, { instrument: 'XAUUSD.fut' })],
      policy, opts,
    );
    expect(r.raw_values.every((v) => v.reason !== 'INSTRUMENT_MISMATCH')).toBe(true);
  });
  it('mismatch ? DROPPED with INSTRUMENT_MISMATCH', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { instrument: 'XAUUSD.spot' }), mkSrc('B', 100, { instrument: 'XAUUSD.fut' })],
      policy,
      { ...opts, referenceInstrument: 'XAUUSD.spot' },
    );
    const b = r.raw_values.find((v) => v.sourceId === 'B')!;
    expect(b.status).toBe('DROPPED');
    expect(b.reason).toBe('INSTRUMENT_MISMATCH');
  });
  it('all matching ? deltas computed', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { instrument: 'XAUUSD.spot' }), mkSrc('B', 100, { instrument: 'XAUUSD.spot' })],
      policy,
      { ...opts, referenceInstrument: 'XAUUSD.spot' },
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.deltas).toHaveLength(1);
  });
  it('missing instrument ? passes', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { instrument: 'XAUUSD.spot' }), mkSrc('B', 100)],
      policy,
      { ...opts, referenceInstrument: 'XAUUSD.spot' },
    );
    expect(r.raw_values.find((v) => v.sourceId === 'B')!.reason).not.toBe('INSTRUMENT_MISMATCH');
  });
});

describe('?8.4C ? priority per field', () => {
  it('priority breaks tie when USED absent', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [] }),
      [mkSrc('A', 100), mkSrc('B', 100.5), mkSrc('C', 100.1)],
      policy,
      {
        ...opts,
        independenceKeys: { A: 'K1', B: 'K1', C: 'K2' },
        priorityByField: { close: ['B', 'A'] },
      },
    );
    expect(r.deltas).toHaveLength(1);
    expect(r.deltas[0]!.delta_p).toBeCloseTo(0.4, 5);
  });
  it('USED beats priority', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }] }),
      [mkSrc('A', 100), mkSrc('B', 101), mkSrc('C', 105)],
      policy,
      {
        ...opts,
        independenceKeys: { A: 'K1', B: 'K1', C: 'K2' },
        priorityByField: { close: ['B', 'A'] },
      },
    );
    expect(r.deltas[0]!.delta_p).toBeCloseTo(-5, 5);
  });
});

describe('?8.4D ? sensitive_use_blocked', () => {
  it('CONSISTENT ? not blocked', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100)], policy, opts);
    expect(r.sensitive_use_blocked).toBe(false);
  });
  it('DISCREPANCY ? blocked', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 105)], policy, opts);
    expect(r.conflictStatus).toBe('DISCREPANCY');
    expect(r.sensitive_use_blocked).toBe(true);
  });
  it('INSUFFICIENT_COMPARABLE_DATA ? blocked', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'B' }], droppedSources: [{ sourceId: 'A', reason: 'TIME_BLOCKED' }] }),
      [mkSrc('A', 100, { timeBlocked: true }), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.conflictStatus).toBe('INSUFFICIENT_COMPARABLE_DATA');
    expect(r.sensitive_use_blocked).toBe(true);
  });
});

describe('?8.4E ? lineage_id propagation', () => {
  it('lineageId ? lineage_id on FusedRawValue', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { lineageId: 'lin-A-001' }), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.lineage_id).toBe('lin-A-001');
  });
  it('missing lineageId ? undefined', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100)], policy, opts);
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.lineage_id).toBeUndefined();
  });
});
