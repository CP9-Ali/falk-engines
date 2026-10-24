import { FusionReport, FusionStatus, LegacyConflictStatus } from './types';

const LEGACY_MAP: Record<LegacyConflictStatus, FusionStatus> = {
  NONE: 'CONSISTENT',
  RESOLVED_BY_TOLERANCE: 'CONSISTENT',
  RESOLVED_BY_POLICY: 'CONSISTENT',
  UNRESOLVED: 'UNRESOLVED_CONFLICT',
  TIME_BLOCKED: 'INSUFFICIENT_COMPARABLE_DATA',
};

export function migrateLegacyStatus(
  legacy: LegacyConflictStatus,
  ctx: { totalSources: number; blockedSources: number } = { totalSources: 2, blockedSources: 0 },
): FusionStatus {
  if (legacy === 'NONE' && ctx.totalSources < 2) return 'INSUFFICIENT_COMPARABLE_DATA';
  return LEGACY_MAP[legacy];
}

export function migrateLegacyReport(legacy: Record<string, unknown>): FusionReport {
  const status = migrateLegacyStatus(
    (legacy.conflict_status ?? legacy.status ?? 'NONE') as LegacyConflictStatus,
    {
      totalSources: Number(legacy.sources_total ?? legacy.sources_used ?? 1),
      blockedSources: Number(legacy.sources_blocked ?? 0),
    },
  );
  return {
    report_id: String(legacy.report_id ?? 'migrated'),
    as_of_cutoff: String(legacy.as_of_cutoff ?? new Date(0).toISOString()),
    policy_version: String(legacy.policy_version ?? 'legacy'),
    engine_version: String(legacy.engine_version ?? 'legacy'),
    conflict_status: status,
    fused_value: typeof legacy.fused_value === 'number' ? legacy.fused_value : null,
    raw_values: [],
    deltas: [],
    sources_used: Number(legacy.sources_used ?? 0),
    sources_dropped: [],
    source_counts: {
      total: Number(legacy.sources_total ?? legacy.sources_used ?? 0),
      comparable: Number(legacy.sources_used ?? 0),
      blocked: Number(legacy.sources_blocked ?? 0),
      dropped_by_policy: 0,
    },
  };
}
