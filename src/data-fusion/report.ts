import type { FusionReport, FusionDroppedSource } from './types';
import type { EnrichedFusionResult } from './enrich';

function defaultAccessor<T>(v: T): number | null {
  const anyV = v as { close?: unknown };
  return typeof anyV?.close === 'number' ? anyV.close : null;
}

export function toFusionReport<T>(
  enriched: EnrichedFusionResult<T>,
  accessor: (v: T) => number | null = defaultAccessor,
): FusionReport {
  const rawFused = enriched.fusedValue as unknown as T | null | undefined;
  const fusedNumber: number | null =
    rawFused === null || rawFused === undefined ? null : accessor(rawFused);

  const sources_dropped: FusionDroppedSource[] = enriched.raw_values
    .filter((r) => r.status === 'DROPPED')
    .map((r) => ({ sourceId: r.sourceId, reason: r.reason }));

  const sources_used = enriched.raw_values.filter((r) => r.status === 'USED').length;

  return {
    report_id: enriched.report_id,
    as_of_cutoff: enriched.as_of_cutoff,
    policy_version: enriched.policy_version,
    engine_version: enriched.engine_version,
    conflict_status: enriched.conflictStatus,
    fused_value: fusedNumber,
    raw_values: enriched.raw_values,
    deltas: enriched.deltas,
    sources_used,
    sources_dropped,
    source_counts: {
      total: enriched.source_counts.total,
      comparable: enriched.source_counts.comparable,
      blocked: enriched.source_counts.blocked,
      dropped_by_policy: enriched.source_counts.dropped_by_policy,
    },
  };
}
