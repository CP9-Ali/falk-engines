import type { FusionResult, FusionStatus, FusedDelta, FusedRawValue } from './types';
import { computePairwiseDeltas } from './price-difference';
import { detectOutliersMAD } from './outlier-detector';
import { groupSourcesByIndependence, resolveIndependenceKey } from './independence';
import { resolveStatus } from './engine';

export interface SourceValueLike<T> {
  sourceId: string;
  value: T;
  timeBlocked?: boolean;
}

export interface EnrichOptions<T> {
  asOfCutoff: string;
  engineVersion: string;
  reportId?: string;
  fieldName?: string;
  fieldAccessor?: (v: T) => number | null;
  outlierPolicy?: { method: 'MAD' | 'ZSCORE'; threshold: number };
  /** ?8.3 ? map sourceId -> independence group key. Defaults to sourceId (each source its own group). */
  independenceKeys?: Readonly<Record<string, string>>;
}

export interface SourceCounts {
  total: number;
  comparable: number;
  blocked: number;
  dropped_by_policy: number;
  /** ?8.3 ? number of independent evidence groups among USED|NOT_COMPARABLE sources with non-null value. */
  independent_evidence: number;
}

export interface FusionReportAddon {
  report_id: string;
  as_of_cutoff: string;
  policy_version: string;
  engine_version: string;
  deltas: ReadonlyArray<FusedDelta>;
  raw_values: ReadonlyArray<FusedRawValue>;
  source_counts: SourceCounts;
}

export type EnrichedFusionResult<T> = FusionResult<T> & FusionReportAddon;

function defaultAccessor<T>(v: T): number | null {
  const anyV = v as { close?: unknown };
  return typeof anyV?.close === 'number' ? anyV.close : null;
}

function makeReportId(): string {
  return 'rep-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
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

  const anyResult = result as unknown as {
    droppedSources: ReadonlyArray<{ sourceId: string; reason: string }>;
    provenance: ReadonlyArray<{ sourceId: string }>;
    fusedValue: unknown;
  };

  const droppedIds = new Set(anyResult.droppedSources.map((d) => d.sourceId));
  const provenanceIds = new Set(anyResult.provenance.map((p) => p.sourceId));

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
      source_independence_key: resolveIndependenceKey(v.sourceId, independenceKeys),
    };
  });

  // ?? Outlier detection (opt-in) ?????????????????????????????????
  const outlierIds = new Set<string>();
  if (opts.outlierPolicy?.method === 'MAD') {
    const candidates = rawValues
      .filter((r) => r.value !== null && r.status !== 'BLOCKED')
      .map((r) => ({ sourceId: r.sourceId, value: r.value as number }));
    const det = detectOutliersMAD(candidates, opts.outlierPolicy.threshold);
    for (const o of det.outliers) outlierIds.add(o.sourceId);
  }

  rawValues = rawValues.map((r) =>
    outlierIds.has(r.sourceId) && r.status !== 'BLOCKED'
      ? { ...r, status: 'DROPPED', reason: 'OUTLIER_MAD_GT_THRESHOLD' }
      : r,
  );

  // ?? ?8.3 ? Independence grouping ???????????????????????????????
  const usable = rawValues.filter(
    (r) => (r.status === 'USED' || r.status === 'NOT_COMPARABLE') && r.value !== null,
  );
  const groups = groupSourcesByIndependence(
    usable.map((r) => ({ sourceId: r.sourceId })),
    independenceKeys,
  );
  const independent_evidence = groups.length;

  // ?? One representative per independence group (prefer USED) ????
  const priceBySource = new Map<string, number>();
  for (const r of usable) priceBySource.set(r.sourceId, r.value as number);

  const representatives: Array<{ sourceId: string; price: number }> = [];
  for (const g of groups) {
    const usedInGroup = g.sourceIds.find((s) => provenanceIds.has(s));
    const repId = usedInGroup ?? g.sourceIds[0]!;
    const p = priceBySource.get(repId);
    if (typeof p === 'number') representatives.push({ sourceId: repId, price: p });
  }

  const deltas: FusedDelta[] =
    representatives.length >= 2 ? computePairwiseDeltas(representatives) : [];

  const withinTolerance: boolean | null =
    deltas.length === 0
      ? null
      : deltas.every((d) => {
          const base = representatives.find((p) => p.sourceId === d.to)?.price ?? 0;
          if (base === 0) return true;
          return (Math.abs(d.delta_p) / Math.abs(base)) * 10_000 <= policy.toleranceBps;
        });

  const comparable = rawValues.filter(
    (r) => r.status === 'USED' || r.status === 'NOT_COMPARABLE',
  ).length;
  const blocked = rawValues.filter((r) => r.status === 'BLOCKED').length;
  const dropped_by_policy = rawValues.filter((r) => r.status === 'DROPPED').length;

  const status: FusionStatus = resolveStatus({
    total: rawValues.length,
    comparable: independent_evidence,
    blocked,
    droppedByPolicy: dropped_by_policy,
    withinTolerance,
    policyResolved: anyResult.fusedValue !== null && anyResult.fusedValue !== undefined,
    policyFailed: false,
    comparisonSkipped: false,
  });

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
    },
  };
}
