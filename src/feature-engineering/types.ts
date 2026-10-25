import type { FeatureMetadata } from './metadata';
import type { LookaheadGuard } from '../core/time';
import type { Timestamp } from '../core/types';

export type FeatureStatus =
  | 'VALID' | 'UNAVAILABLE' | 'INSUFFICIENT_INPUTS'
  | 'COMPUTATION_FAILED' | 'UNDER_VALIDATION';

export interface FeatureDefinition<Inputs = unknown, Output = unknown> {
  readonly featureId: string;
  readonly definitionVersion: string;
  readonly timeframe: string;
  readonly minHistoryMs: number;
  readonly availabilityRule: {
    readonly requireClosedCandle: boolean;
    readonly expectedLagMs: number;
  };
  readonly inputsRequired: ReadonlyArray<string>;
  readonly dependencies: ReadonlyArray<string>;
  readonly validationRules: ReadonlyArray<{ name: string; check: (v: Output) => boolean }>;
  readonly unit: string;
  readonly parameters: Record<string, number>;
  readonly expectedRange?: { readonly min: number; readonly max: number };
  compute(ctx: FeatureComputeContext<Inputs>): FeatureComputeResult<Output>;
}

export interface FeatureComputeContext<Inputs> {
  readonly asOfCutoff: Timestamp;
  readonly definitionVersion: string;
  readonly policyVersion: string;
  readonly guard: LookaheadGuard;
  readonly inputs: Inputs;
  readonly parameters: Record<string, number>;
  readonly dependencyResults: ReadonlyMap<string, FeatureComputeResult>;
  readonly snapshotRef: { readonly snapshotId: string; readonly contentFingerprint: string };
}

export interface FeatureComputeResult<T = unknown> {
  readonly featureId: string;
  readonly definitionVersion: string;
  readonly status: FeatureStatus;
  readonly value: T | null;
  readonly asOfCutoff: Timestamp;
  readonly computedAt: Timestamp;
  readonly availabilityTime: Timestamp | null;
  readonly error?: string;
  readonly parameters?: Record<string, number>;
  readonly expectedRange?: { readonly min: number; readonly max: number };
  readonly range_check?: 'IN_RANGE' | 'OUT_OF_RANGE' | 'UNKNOWN';
  readonly snapshotRef: { readonly snapshotId: string; readonly contentFingerprint: string };
  readonly fusionPolicyVersion: string;
  readonly metadata?: FeatureMetadata;
}