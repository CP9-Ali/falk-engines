import type { FusionResult, FusionStatus, FusedDelta, FusedRawValue } from './types';
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

      // ?8.5 fix ? order representatives by priority before emitting deltas.
      representatives.sort((a, b) => {
        const ia = priorityIndex.get(a.sourceId);
        const ib = priorityIndex.get(b.sourceId);
        if (ia !== undefined && ib !== undefined) return ia - ib;
        if (ia !== undefined) return -1;
        if (ib !== undefined) return 1;
        return 0;
      });

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
