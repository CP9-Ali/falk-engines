import type { FusionResult, FusionStatus, FusedDelta, FusedRawValue } from './types';
import { computePairwiseDeltas } from './price-difference';
import { detectOutliersMAD } from './outlier-detector';
import { groupSourcesByIndependence, resolveIndependenceKey } from './independence';
import { resolveStatus } from './engine';

export interface SourceValueLike<T> {
  sourceId: string;
  value: T;
  timeBlocked?: boolean;
  /** ?8.4B ? instrument identity (e.g. 'XAUUSD.spot'). Optional. */
  instrument?: string;
  /** ?8.4E ? lineage id from CanonicalCandle. Optional. */
  lineageId?: string;
}

export interface EnrichOptions<T> {
  asOfCutoff: string;
  engineVersion: string;
  reportId?: string;
  fieldName?: string;
  fieldAccessor?: (v: T) => number | null;
  outlierPolicy?: { method: 'MAD' | 'ZSCORE'; threshold: number };
  independenceKeys?: Readonly<Record<string, string>>;
  /** ?8.4A ? list of eligible source IDs per field. Field missing ? all eligible. */
  eligibilityByField?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** ?8.4B ? expected instrument for this enrichment. Missing ? skip instrument filter. */
  referenceInstrument?: string;
  /** ?8.4C ? priority order per field. Missing ? prefer USED, else first-in-group. */
  priorityByField?: Readonly<Record<string, ReadonlyArray<string>>>;
}

export interface SourceCounts {
  total: number;
  comparable: number;
  blocked: number;
  dropped_by_policy: number;
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
  /** ?8.4D ? true when caller must avoid sensitive uses (conflict exceeded / insufficient / failed). */
  sensitive_use_blocked: boolean;
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
  sourceInstrument: string | undefined,
  referenceInstrument: string | undefined,
): boolean {
  if (referenceInstrument === undefined) return true;
  if (sourceInstrument === undefined) return true;   // no info ? pass (backward compat)
  return sourceInstrument === referenceInstrument;
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

  const anyResult = result as unknown as {
    droppedSources: ReadonlyArray<{ sourceId: string; reason: string }>;
    provenance: ReadonlyArray<{ sourceId: string }>;
    fusedValue: unknown;
  };

  const droppedIds = new Set(anyResult.droppedSources.map((d) => d.sourceId));
  const provenanceIds = new Set(anyResult.provenance.map((p) => p.sourceId));

  // ?? [1] Base raw values ????????????????????????????????????????
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
      source_independence_key: resolveIndependenceKey(v.sourceId, independenceKeys),
    };
  });

  // ?? [2] ?8.4A eligibility filter ???????????????????????????????
  rawValues = rawValues.map((r) => {
    if (r.status === 'BLOCKED') return r;
    if (r.status === 'DROPPED') return r;   // keep fuse's reason
    if (!isEligible(r.sourceId, fieldName, eligibilityByField)) {
      return { ...r, status: 'DROPPED' as const, reason: 'NOT_ELIGIBLE_FOR_FIELD' };
    }
    return r;
  });

  // ?? [3] ?8.4B instrument filter ????????????????????????????????
  if (opts.referenceInstrument !== undefined) {
    const instrumentBySource = new Map<string, string | undefined>();
    for (const v of values) instrumentBySource.set(v.sourceId, v.instrument);
    rawValues = rawValues.map((r) => {
      if (r.status === 'BLOCKED') return r;
      if (r.status === 'DROPPED') return r;
      const ins = instrumentBySource.get(r.sourceId);
      if (!isInstrumentMatch(ins, opts.referenceInstrument)) {
        return { ...r, status: 'DROPPED' as const, reason: 'INSTRUMENT_MISMATCH' };
      }
      return r;
    });
  }

  // ?? [4] outlier detection ??????????????????????????????????????
  const outlierIds = new Set<string>();
  if (opts.outlierPolicy?.method === 'MAD') {
    const candidates = rawValues
      .filter((r) => r.value !== null && r.status !== 'BLOCKED' && r.status !== 'DROPPED')
      .map((r) => ({ sourceId: r.sourceId, value: r.value as number }));
    const det = detectOutliersMAD(candidates, opts.outlierPolicy.threshold);
    for (const o of det.outliers) outlierIds.add(o.sourceId);
  }
  rawValues = rawValues.map((r) =>
    outlierIds.has(r.sourceId) && r.status !== 'BLOCKED' && r.status !== 'DROPPED'
      ? { ...r, status: 'DROPPED' as const, reason: 'OUTLIER_MAD_GT_THRESHOLD' }
      : r,
  );

  // ?? [5] independence grouping ??????????????????????????????????
  const usable = rawValues.filter(
    (r) => (r.status === 'USED' || r.status === 'NOT_COMPARABLE') && r.value !== null,
  );
  const groups = groupSourcesByIndependence(
    usable.map((r) => ({ sourceId: r.sourceId })),
    independenceKeys,
  );
  const independent_evidence = groups.length;

  // ?? [6] ?8.4C priority-aware representatives ???????????????????
  const priority = priorityByField[fieldName] ?? [];
  const priorityIndex = new Map<string, number>();
  priority.forEach((sid, i) => priorityIndex.set(sid, i));

  const priceBySource = new Map<string, number>();
  for (const r of usable) priceBySource.set(r.sourceId, r.value as number);

  const representatives: Array<{ sourceId: string; price: number }> = [];
  for (const g of groups) {
    const usedInGroup = g.sourceIds.find((s) => provenanceIds.has(s));
    const prioritized = g.sourceIds
      .filter((s) => priorityIndex.has(s))
      .sort((a, b) => priorityIndex.get(a)! - priorityIndex.get(b)!);
    const repId = usedInGroup ?? prioritized[0] ?? g.sourceIds[0]!;
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
    sensitive_use_blocked: isSensitiveBlocked(status),
  };
}
