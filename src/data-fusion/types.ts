import type { Timestamp } from '../core/types';

export interface FusionPolicy {
  readonly policyVersion: string;
  readonly priorityOrder: ReadonlyArray<string>;
  readonly conflictStrategy:
    | 'STRICT_PRIORITY'
    | 'MEDIAN'
    | 'REJECT_ON_CONFLICT'
    | 'WEIGHTED_AVERAGE_REQUIRES_APPROVAL';
  readonly toleranceBps: number;
  readonly allowSourceSwitching: boolean;
}

export interface SourceValue<T> {
  readonly sourceId: string;
  readonly value: T;
  readonly eventTime: Timestamp;
  readonly availabilityTime: Timestamp;
  readonly sourceVersion: number;
  readonly qualityStatus: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL';
  /** Stage 8C: if true, source timezone is UNKNOWN — excluded from time-sensitive comparisons */
  readonly timeBlocked?: boolean;
}

export type FusionStatus =
  | 'CONSISTENT'
  | 'DISCREPANCY'
  | 'UNRESOLVED_CONFLICT'
  | 'INSUFFICIENT_COMPARABLE_DATA'
  | 'FAILED'
  | 'SKIPPED';

export const FUSION_STATUS_VALUES: ReadonlyArray<FusionStatus> = [
  'CONSISTENT', 'DISCREPANCY', 'UNRESOLVED_CONFLICT',
  'INSUFFICIENT_COMPARABLE_DATA', 'FAILED', 'SKIPPED',
] as const;

/** @deprecated use FusionStatus */
export type ConflictStatus = FusionStatus;

export type LegacyConflictStatus =
  | 'NONE' | 'RESOLVED_BY_TOLERANCE' | 'RESOLVED_BY_POLICY'
  | 'UNRESOLVED' | 'TIME_BLOCKED';

export interface FusionResult<T> {
  readonly fusedValue: T | null;
  readonly conflictStatus: ConflictStatus;
  readonly provenance: ReadonlyArray<{ sourceId: string; value: T; weight: number }>;
  readonly droppedSources: ReadonlyArray<{ sourceId: string; reason: string }>;
  readonly asOfCutoff: Timestamp;
  readonly policyVersion: string;
}

// -- ?8.0 ? FusionReport (expanded) ------------------------------
export interface FusedRawValue {
  sourceId: string;
  field: string;
  value: number | null;
  status: 'USED' | 'DROPPED' | 'BLOCKED' | 'NOT_COMPARABLE';
  reason: string;
  lineage_id?: string;
  source_independence_key?: string;
  raw_payload_ref?: string;
}
export interface FusedDelta {
  from: string;
  to: string;
  delta_p: number;
  delta_p_pct: number | null;
}
export interface FusionDroppedSource {
  sourceId: string;
  reason: string;
}
export interface FusionReport {
  report_id: string;
  as_of_cutoff: string;
  policy_version: string;
  engine_version: string;
  conflict_status: FusionStatus;
  fused_value: number | null;
  raw_values: ReadonlyArray<FusedRawValue>;
  deltas: ReadonlyArray<FusedDelta>;
  sources_used: number;
  sources_dropped: ReadonlyArray<FusionDroppedSource>;
  source_counts: {
    total: number;
    comparable: number;
    blocked: number;
    dropped_by_policy: number;
  };
}
