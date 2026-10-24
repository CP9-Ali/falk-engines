const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// ????????? [1/5] types.ts ? add raw_payload_ref ?????????
let typesSrc = fs.readFileSync('src/data-fusion/types.ts', 'utf8');
if (!/raw_payload_ref\?: string;/.test(typesSrc)) {
  typesSrc = typesSrc.replace(
    /(export interface FusedRawValue \{[\s\S]*?source_independence_key\?: string;)/,
    '$1\n  raw_payload_ref?: string;'
  );
  fs.writeFileSync('src/data-fusion/types.ts', typesSrc, 'utf8');
  ok('types.ts ? FusedRawValue.raw_payload_ref added');
} else {
  ok('types.ts ? raw_payload_ref already present');
}

// ????????? [2/5] instrument-matcher.ts (new) ?????????
fs.writeFileSync('src/data-fusion/instrument-matcher.ts', `export type InstrumentMatcher = (a: string | undefined, b: string | undefined) => boolean;

/**
 * ?8.5B ? Default matcher: literal equality.
 * Both undefined ? match (backward compat).
 * One undefined ? match (no info, no conflict).
 * Caller may override to wrap areInstrumentsEquivalent() from canonical.ts.
 */
export const literalInstrumentMatcher: InstrumentMatcher = (a, b) => {
  if (a === undefined || b === undefined) return true;
  return a === b;
};
`, 'utf8');
ok('instrument-matcher.ts');

// ????????? [3/5] enrich.ts ? full ?8.5 rewrite ?????????
fs.writeFileSync('src/data-fusion/enrich.ts', `import type { FusionResult, FusionStatus, FusedDelta, FusedRawValue } from './types';
import { computePairwiseDeltas } from './price-difference';
import { detectOutliersMAD } from './outlier-detector';
import { groupSourcesByIndependence, resolveIndependenceKey } from './independence';
import { alignByTimeBucket, type TimestampedValue } from './timestamp-aligner';
import { compareQuotes, type QuoteComparatorResult } from './quote-comparator';
import { literalInstrumentMatcher, type InstrumentMatcher } from './instrument-matcher';
import { resolveStatus } from './engine';

export interface SourceValueLike<T> {
  sourceId: string;
  value: T;
  timeBlocked?: boolean;
  instrument?: string;
  lineageId?: string;
  /** ?8.5E ? raw payload reference from CanonicalCandle. */
  raw_payload_ref?: string;
  /** ?8.5A ? event time (ISO 8601 UTC) for alignment. */
  timestamp?: string;
  /** ?8.5F ? bid/ask when available. */
  bid?: number;
  ask?: number;
}

export interface EnrichOptions<T> {
  asOfCutoff: string;
  engineVersion: string;
  reportId?: string;
  fieldName?: string;
  fieldAccessor?: (v: T) => number | null;
  outlierPolicy?: { method: 'MAD' | 'ZSCORE'; threshold: number };
  independenceKeys?: Readonly<Record<string, string>>;
  eligibilityByField?: Readonly<Record<string, ReadonlyArray<string>>>;
  referenceInstrument?: string;
  priorityByField?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** ?8.5A ? bucket size in ms; sources in different buckets are dropped. */
  alignmentBucketMs?: number;
  /** ?8.5B ? override the instrument matcher (e.g. semantic). */
  instrumentMatcher?: InstrumentMatcher;
  /** ?8.5C ? skip comparison entirely; status becomes SKIPPED. */
  skipComparison?: boolean;
}

export interface SourceCounts {
  total: number;
  comparable: number;
  blocked: number;
  dropped_by_policy: number;
  independent_evidence: number;
  /** ?8.5A ? sources excluded due to timestamp misalignment. */
  timestamp_misaligned?: number;
}

export interface FusionReportAddon {
  report_id: string;
  as_of_cutoff: string;
  policy_version: string;
  engine_version: string;
  deltas: ReadonlyArray<FusedDelta>;
  raw_values: ReadonlyArray<FusedRawValue>;
  source_counts: SourceCounts;
  sensitive_use_blocked: boolean;
  /** ?8.5F ? quote comparator result when bid/ask data present. */
  quote_comparisons?: QuoteComparatorResult;
}

export type EnrichedFusionResult<T> = FusionResult<T> & FusionReportAddon;

function defaultAccessor<T>(v: T): number | null {
  const anyV = v as { close?: unknown };
  return typeof anyV?.close === 'number' ? anyV.close : null;
}

function makeReportId(): string {
  return 'rep-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function isEligible(
  sourceId: string,
  fieldName: string,
  eligibilityByField: Readonly<Record<string, ReadonlyArray<string>>>,
): boolean {
  const list = eligibilityByField[fieldName];
  if (list === undefined) return true;
  return list.includes(sourceId);
}

function isInstrumentMatch(
  matcher: InstrumentMatcher,
  sourceInstrument: string | undefined,
  referenceInstrument: string | undefined,
): boolean {
  if (referenceInstrument === undefined) return true;
  if (sourceInstrument === undefined) return true;
  return matcher(sourceInstrument, referenceInstrument);
}

function isSensitiveBlocked(status: FusionStatus): boolean {
  return status !== 'CONSISTENT' && status !== 'SKIPPED';
}

export function enrichFusionResult<T>(
  result: FusionResult<T>,
  values: ReadonlyArray<SourceValueLike<T>>,
  policy: { policyVersion: string; toleranceBps: number },
  opts: EnrichOptions<T>,
): EnrichedFusionResult<T> {
  const fieldName = opts.fieldName ?? 'close';
  const accessor = opts.fieldAccessor ?? defaultAccessor;
  const reportId = opts.reportId ?? makeReportId();
  const independenceKeys = opts.independenceKeys ?? {};
  const eligibilityByField = opts.eligibilityByField ?? {};
  const priorityByField = opts.priorityByField ?? {};
  const matcher = opts.instrumentMatcher ?? literalInstrumentMatcher;

  const anyResult = result as unknown as {
    droppedSources: ReadonlyArray<{ sourceId: string; reason: string }>;
    provenance: ReadonlyArray<{ sourceId: string }>;
    fusedValue: unknown;
  };

  const droppedIds = new Set(anyResult.droppedSources.map((d) => d.sourceId));
  const provenanceIds = new Set(anyResult.provenance.map((p) => p.sourceId));

  // [1] Build base raw_values
  let rawValues: FusedRawValue[] = values.map((v) => {
    const price = accessor(v.value);
    const blocked = v.timeBlocked === true;
    const dropped = droppedIds.has(v.sourceId);
    const used = provenanceIds.has(v.sourceId);

    const status: FusedRawValue['status'] = blocked
      ? 'BLOCKED'
      : dropped
      ? 'DROPPED'
      : used
      ? 'USED'
      : 'NOT_COMPARABLE';

    let reason = 'UNKNOWN';
    if (blocked) reason = 'BLOCKED_TIME';
    else if (dropped) {
      const d = anyResult.droppedSources.find((x) => x.sourceId === v.sourceId);
      reason = d?.reason ?? 'DROPPED';
    } else if (used) reason = 'USED';

    return {
      sourceId: v.sourceId,
      field: fieldName,
      value: price,
      status,
      reason,
      ...(v.lineageId !== undefined ? { lineage_id: v.lineageId } : {}),
      ...(v.raw_payload_ref !== undefined ? { raw_payload_ref: v.raw_payload_ref } : {}),
      source_independence_key: resolveIndependenceKey(v.sourceId, independenceKeys),
    };
  });

  // [2] Eligibility filter
  rawValues = rawValues.map((r) => {
    if (r.status === 'BLOCKED' || r.status === 'DROPPED') return r;
    if (!isEligible(r.sourceId, fieldName, eligibilityByField)) {
      return { ...r, status: 'DROPPED' as const, reason: 'NOT_ELIGIBLE_FOR_FIELD' };
    }
    return r;
  });

  // [3] Instrument filter
  if (opts.referenceInstrument !== undefined) {
    const instrumentBySource = new Map<string, string | undefined>();
    for (const v of values) instrumentBySource.set(v.sourceId, v.instrument);
    rawValues = rawValues.map((r) => {
      if (r.status === 'BLOCKED' || r.status === 'DROPPED') return r;
      const ins = instrumentBySource.get(r.sourceId);
      if (!isInstrumentMatch(matcher, ins, opts.referenceInstrument)) {
        return { ...r, status: 'DROPPED' as const, reason: 'INSTRUMENT_MISMATCH' };
      }
      return r;
    });
  }

  // [4] ?8.5A ? timestamp alignment
  let failureReason: string | null = null;
  let timestamp_misaligned = 0;
  if (opts.alignmentBucketMs !== undefined && opts.skipComparison !== true) {
    try {
      const usableWithTs: TimestampedValue<number>[] = [];
      const tsBySource = new Map<string, string>();
      for (const v of values) {
        if (v.timestamp !== undefined) tsBySource.set(v.sourceId, v.timestamp);
      }
      for (const r of rawValues) {
        if (r.status !== 'USED' && r.status !== 'NOT_COMPARABLE') continue;
        if (r.value === null) continue;
        const ts = tsBySource.get(r.sourceId);
        if (ts === undefined) continue;
        usableWithTs.push({ sourceId: r.sourceId, timestamp: ts, value: r.value });
      }
      if (usableWithTs.length >= 2) {
        const buckets = alignByTimeBucket(usableWithTs, opts.alignmentBucketMs);
        if (buckets.length > 1) {
          let modalIdx = 0;
          for (let i = 1; i < buckets.length; i++) {
            if (buckets[i]!.entries.length > buckets[modalIdx]!.entries.length) modalIdx = i;
          }
          const modalIds = new Set(buckets[modalIdx]!.entries.map((e) => e.sourceId));
          rawValues = rawValues.map((r) => {
            if (r.status !== 'USED' && r.status !== 'NOT_COMPARABLE') return r;
            if (!usableWithTs.some((u) => u.sourceId === r.sourceId)) return r;
            if (modalIds.has(r.sourceId)) return r;
            timestamp_misaligned += 1;
            return { ...r, status: 'DROPPED' as const, reason: 'TIMESTAMP_MISALIGNED' };
          });
        }
      }
    } catch (err) {
      failureReason = 'ALIGNMENT_FAILED: ' + (err instanceof Error ? err.message : String(err));
    }
  }

  // [5] Outliers
  if (opts.outlierPolicy?.method === 'MAD' && opts.skipComparison !== true && failureReason === null) {
    try {
      const candidates = rawValues
        .filter((r) => r.value !== null && r.status !== 'BLOCKED' && r.status !== 'DROPPED')
        .map((r) => ({ sourceId: r.sourceId, value: r.value as number }));
      const det = detectOutliersMAD(candidates, opts.outlierPolicy.threshold);
      const outlierIds = new Set(det.outliers.map((o) => o.sourceId));
      rawValues = rawValues.map((r) =>
        outlierIds.has(r.sourceId) && r.status !== 'BLOCKED' && r.status !== 'DROPPED'
          ? { ...r, status: 'DROPPED' as const, reason: 'OUTLIER_MAD_GT_THRESHOLD' }
          : r,
      );
    } catch (err) {
      if (failureReason === null) {
        failureReason = 'OUTLIER_FAILED: ' + (err instanceof Error ? err.message : String(err));
      }
    }
  }

  // [6] Independence grouping (always computed for reporting)
  const usable = rawValues.filter(
    (r) => (r.status === 'USED' || r.status === 'NOT_COMPARABLE') && r.value !== null,
  );
  const groups = groupSourcesByIndependence(
    usable.map((r) => ({ sourceId: r.sourceId })),
    independenceKeys,
  );
  const independent_evidence = groups.length;

  // [7] ?8.5C ? priority-aware representatives + deltas
  let representatives: Array<{ sourceId: string; price: number }> = [];
  let deltas: FusedDelta[] = [];
  if (opts.skipComparison !== true && failureReason === null) {
    try {
      const priority = priorityByField[fieldName] ?? [];
      const priorityIndex = new Map<string, number>();
      priority.forEach((sid, i) => priorityIndex.set(sid, i));

      const priceBySource = new Map<string, number>();
      for (const r of usable) priceBySource.set(r.sourceId, r.value as number);

      for (const g of groups) {
        const usedInGroup = g.sourceIds.find((s) => provenanceIds.has(s));
        const prioritized = g.sourceIds
          .filter((s) => priorityIndex.has(s))
          .sort((a, b) => priorityIndex.get(a)! - priorityIndex.get(b)!);
        const repId = usedInGroup ?? prioritized[0] ?? g.sourceIds[0]!;
        const p = priceBySource.get(repId);
        if (typeof p === 'number') representatives.push({ sourceId: repId, price: p });
      }

      deltas = representatives.length >= 2 ? computePairwiseDeltas(representatives) : [];
    } catch (err) {
      failureReason = 'DELTAS_FAILED: ' + (err instanceof Error ? err.message : String(err));
      deltas = [];
    }
  }

  // [8] ?8.5F ? quote comparison
  let quote_comparisons: QuoteComparatorResult | undefined = undefined;
  if (opts.skipComparison !== true && failureReason === null) {
    try {
      const quotes = values
        .filter((v) => typeof v.bid === 'number' && typeof v.ask === 'number')
        .map((v) => ({ sourceId: v.sourceId, bid: v.bid as number, ask: v.ask as number }));
      if (quotes.length > 0) quote_comparisons = compareQuotes(quotes);
    } catch (err) {
      failureReason = 'QUOTES_FAILED: ' + (err instanceof Error ? err.message : String(err));
    }
  }

  // [9] withinTolerance
  const withinTolerance: boolean | null =
    deltas.length === 0
      ? null
      : deltas.every((d) => {
          const base = representatives.find((p) => p.sourceId === d.to)?.price ?? 0;
          if (base === 0) return true;
          return (Math.abs(d.delta_p) / Math.abs(base)) * 10_000 <= policy.toleranceBps;
        });

  // [10] Compute counts
  const comparable = rawValues.filter(
    (r) => r.status === 'USED' || r.status === 'NOT_COMPARABLE',
  ).length;
  const blocked = rawValues.filter((r) => r.status === 'BLOCKED').length;
  const dropped_by_policy = rawValues.filter((r) => r.status === 'DROPPED').length;

  // [11] Status
  let status: FusionStatus;
  if (opts.skipComparison === true) {
    status = 'SKIPPED';
  } else if (failureReason !== null) {
    status = 'FAILED';
  } else {
    status = resolveStatus({
      total: rawValues.length,
      comparable: independent_evidence,
      blocked,
      droppedByPolicy: dropped_by_policy,
      withinTolerance,
      policyResolved: anyResult.fusedValue !== null && anyResult.fusedValue !== undefined,
      policyFailed: false,
      comparisonSkipped: false,
    });
  }

  return {
    ...result,
    conflictStatus: status,
    report_id: reportId,
    as_of_cutoff: opts.asOfCutoff,
    policy_version: policy.policyVersion,
    engine_version: opts.engineVersion,
    deltas,
    raw_values: rawValues,
    source_counts: {
      total: rawValues.length,
      comparable,
      blocked,
      dropped_by_policy,
      independent_evidence,
      timestamp_misaligned,
    },
    sensitive_use_blocked: isSensitiveBlocked(status),
    ...(quote_comparisons !== undefined ? { quote_comparisons } : {}),
  };
}
`, 'utf8');
ok('enrich.ts (?8.5)');

// ????????? [4/5] test file ?????????
fs.writeFileSync('src/tests/fusion-enrich-8-5.test.ts', `import { describe, it, expect } from 'vitest';
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
`, 'utf8');
ok('fusion-enrich-8-5.test.ts');

console.log('\nDONE. ?8.5 files written.');
