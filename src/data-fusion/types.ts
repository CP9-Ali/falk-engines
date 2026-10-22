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
}

export type ConflictStatus =
  | 'NONE' | 'RESOLVED_BY_TOLERANCE' | 'RESOLVED_BY_POLICY' | 'UNRESOLVED';

export interface FusionResult<T> {
  readonly fusedValue: T | null;
  readonly conflictStatus: ConflictStatus;
  readonly provenance: ReadonlyArray<{ sourceId: string; value: T; weight: number }>;
  readonly droppedSources: ReadonlyArray<{ sourceId: string; reason: string }>;
  readonly asOfCutoff: Timestamp;
  readonly policyVersion: string;
}