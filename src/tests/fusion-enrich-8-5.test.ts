import { describe, it, expect } from 'vitest';
import { enrichFusionResult } from '../data-fusion/enrich';
import { literalInstrumentMatcher } from '../data-fusion/instrument-matcher';

type Src = {
  sourceId: string;
  value: { close: number };
  timeBlocked?: boolean;
  instrument?: string;
  lineageId?: string;
  raw_payload_ref?: string;
  timestamp?: string;
  bid?: number;
  ask?: number;
};

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

// ?? A. Timestamp Aligner ??????????????????????????????????????
describe('?8.5A ? timestamp alignment', () => {
  it('no alignmentBucketMs ? no effect (backward compat)', () => {
    const r = enrichFusionResult(
      mkResult(),
      [
        mkSrc('A', 100, { timestamp: '2026-01-01T00:00:00Z' }),
        mkSrc('B', 100.1, { timestamp: '2026-01-01T05:00:00Z' }),
      ],
      policy, opts,
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.source_counts.timestamp_misaligned).toBe(0);
  });

  it('same bucket ? all kept', () => {
    const r = enrichFusionResult(
      mkResult(),
      [
        mkSrc('A', 100, { timestamp: '2026-01-01T00:00:05Z' }),
        mkSrc('B', 100.1, { timestamp: '2026-01-01T00:00:30Z' }),
      ],
      policy,
      { ...opts, alignmentBucketMs: 60_000 },
    );
    expect(r.source_counts.timestamp_misaligned).toBe(0);
    expect(r.conflictStatus).toBe('CONSISTENT');
  });

  it('different buckets ? minority dropped with TIMESTAMP_MISALIGNED', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }, { sourceId: 'B' }, { sourceId: 'C' }] }),
      [
        mkSrc('A', 100, { timestamp: '2026-01-01T00:00:05Z' }),
        mkSrc('B', 100.1, { timestamp: '2026-01-01T00:00:30Z' }),
        mkSrc('C', 200, { timestamp: '2026-01-01T05:00:00Z' }),
      ],
      policy,
      { ...opts, alignmentBucketMs: 60_000 },
    );
    expect(r.source_counts.timestamp_misaligned).toBe(1);
    const c = r.raw_values.find((v) => v.sourceId === 'C')!;
    expect(c.status).toBe('DROPPED');
    expect(c.reason).toBe('TIMESTAMP_MISALIGNED');
  });

  it('sources without timestamp preserved', () => {
    const r = enrichFusionResult(
      mkResult(),
      [
        mkSrc('A', 100, { timestamp: '2026-01-01T00:00:05Z' }),
        mkSrc('B', 100.1),   // no timestamp
      ],
      policy,
      { ...opts, alignmentBucketMs: 60_000 },
    );
    expect(r.raw_values.find((v) => v.sourceId === 'B')!.reason).not.toBe('TIMESTAMP_MISALIGNED');
  });

  it('invalid timestamp ? FAILED', () => {
    const r = enrichFusionResult(
      mkResult(),
      [
        mkSrc('A', 100, { timestamp: 'not-a-date' }),
        mkSrc('B', 100.1, { timestamp: '2026-01-01T00:00:30Z' }),
      ],
      policy,
      { ...opts, alignmentBucketMs: 60_000 },
    );
    expect(r.conflictStatus).toBe('FAILED');
    expect(r.sensitive_use_blocked).toBe(true);
  });
});

// ?? B. Semantic Instrument Matcher ?????????????????????????????
describe('?8.5B ? instrument matcher override', () => {
  it('default literal matcher is strict equality', () => {
    const r = enrichFusionResult(
      mkResult(),
      [
        mkSrc('A', 100, { instrument: 'XAUUSD.spot' }),
        mkSrc('B', 100, { instrument: 'XAUUSD' }),
      ],
      policy,
      { ...opts, referenceInstrument: 'XAUUSD' },
    );
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.reason).toBe('INSTRUMENT_MISMATCH');
  });

  it('custom matcher allows equivalent aliases', () => {
    const customMatcher = (a: string | undefined, b: string | undefined): boolean => {
      if (a === undefined || b === undefined) return true;
      return a.split('.')[0] === b.split('.')[0];
    };
    const r = enrichFusionResult(
      mkResult(),
      [
        mkSrc('A', 100, { instrument: 'XAUUSD.spot' }),
        mkSrc('B', 100, { instrument: 'XAUUSD' }),
      ],
      policy,
      { ...opts, referenceInstrument: 'XAUUSD', instrumentMatcher: customMatcher },
    );
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.reason).not.toBe('INSTRUMENT_MISMATCH');
    expect(r.conflictStatus).toBe('CONSISTENT');
  });

  it('missing instrument ? passes', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy,
      { ...opts, referenceInstrument: 'XAUUSD' },
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
  });

  it('literalInstrumentMatcher handles undefined', () => {
    expect(literalInstrumentMatcher(undefined, 'X')).toBe(true);
    expect(literalInstrumentMatcher('X', undefined)).toBe(true);
    expect(literalInstrumentMatcher(undefined, undefined)).toBe(true);
    expect(literalInstrumentMatcher('A', 'A')).toBe(true);
    expect(literalInstrumentMatcher('A', 'B')).toBe(false);
  });
});

// ?? C. SKIPPED ?????????????????????????????????????????????????
describe('?8.5C ? skipComparison', () => {
  it('skipComparison: true ? status SKIPPED', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100.2)],
      policy,
      { ...opts, skipComparison: true },
    );
    expect(r.conflictStatus).toBe('SKIPPED');
    expect(r.sensitive_use_blocked).toBe(false);
  });

  it('SKIPPED still reports raw_values + counts', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy,
      { ...opts, skipComparison: true },
    );
    expect(r.raw_values).toHaveLength(2);
    expect(r.source_counts.total).toBe(2);
    expect(r.source_counts.independent_evidence).toBe(2);
    expect(r.deltas).toEqual([]);
  });

  it('SKIPPED ignores alignmentBucketMs', () => {
    const r = enrichFusionResult(
      mkResult(),
      [
        mkSrc('A', 100, { timestamp: 'not-a-date' }),
        mkSrc('B', 100, { timestamp: '2026-01-01T00:00:30Z' }),
      ],
      policy,
      { ...opts, skipComparison: true, alignmentBucketMs: 60_000 },
    );
    expect(r.conflictStatus).toBe('SKIPPED');   // not FAILED
  });
});

// ?? E. raw_payload_ref ?????????????????????????????????????????
describe('?8.5E ? raw_payload_ref propagation', () => {
  it('raw_payload_ref appears on FusedRawValue', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { raw_payload_ref: 'raw-A-001' }), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.raw_payload_ref).toBe('raw-A-001');
  });

  it('missing raw_payload_ref ? undefined', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100)], policy, opts);
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.raw_payload_ref).toBeUndefined();
  });
});

// ?? F. Quote Comparator ????????????????????????????????????????
describe('?8.5F ? quote comparisons', () => {
  it('no bid/ask ? quote_comparisons undefined', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100)], policy, opts);
    expect(r.quote_comparisons).toBeUndefined();
  });

  it('bid/ask on all sources ? comparisons computed', () => {
    const r = enrichFusionResult(
      mkResult(),
      [
        mkSrc('A', 100, { bid: 99.5, ask: 100.5 }),
        mkSrc('B', 100, { bid: 99.8, ask: 100.2 }),
      ],
      policy, opts,
    );
    expect(r.quote_comparisons).toBeDefined();
    expect(r.quote_comparisons!.comparisons).toHaveLength(2);
    expect(r.quote_comparisons!.cross_spread_abs).not.toBeNull();
  });

  it('mixed bid/ask only compares those with data', () => {
    const r = enrichFusionResult(
      mkResult(),
      [
        mkSrc('A', 100, { bid: 99, ask: 101 }),
        mkSrc('B', 100),   // no bid/ask
      ],
      policy, opts,
    );
    expect(r.quote_comparisons).toBeDefined();
    expect(r.quote_comparisons!.comparisons).toHaveLength(1);
  });
});

// ?? Backward compat with ?8.4 ?????????????????????????????????
describe('?8.5 ? backward compat with ?8.4', () => {
  it('no new options ? same behavior as ?8.4', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100.2)], policy, opts);
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.source_counts.timestamp_misaligned).toBe(0);
    expect(r.quote_comparisons).toBeUndefined();
  });

  it('priority still works', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [] }),
      [mkSrc('A', 100), mkSrc('B', 100.5)],
      policy,
      { ...opts, priorityByField: { close: ['B', 'A'] } },
    );
    expect(r.deltas).toHaveLength(1);
    expect(r.deltas[0]!.from).toBe('B');
  });

  it('eligibility + instrument + alignment combined ? FAILED only if computation fails', () => {
    const r = enrichFusionResult(
      mkResult(),
      [
        mkSrc('A', 100, { timestamp: '2026-01-01T00:00:05Z', instrument: 'XAUUSD', bid: 99, ask: 101 }),
        mkSrc('B', 100.2, { timestamp: '2026-01-01T00:00:30Z', instrument: 'XAUUSD', bid: 99, ask: 101 }),
      ],
      policy,
      {
        ...opts,
        alignmentBucketMs: 60_000,
        referenceInstrument: 'XAUUSD',
        eligibilityByField: { close: ['A', 'B'] },
      },
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.quote_comparisons).toBeDefined();
  });
});
