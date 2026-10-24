export type Id = string;
export type Timestamp = string;
export type Fingerprint = string;

export interface TimeContext {
  readonly eventTime: Timestamp;
  readonly arrivalTime: Timestamp;
  readonly processingTime: Timestamp;
  readonly asOfCutoff: Timestamp;
}

export interface DataReference {
  readonly snapshotId: Id;
  readonly contentFingerprint: Fingerprint;
  readonly sourceId: string;
  readonly range: { readonly from: Timestamp; readonly to: Timestamp };
}

export interface VersionBundle {
  readonly schemaVersion: string;
  readonly policyVersion: string;
  readonly configVersion: string;
  readonly engineVersion: string;
}

export type ExecutionStatus =
  | 'SUCCESS' | 'SUCCESS_PARTIAL' | 'NO_RESULT'
  | 'INSUFFICIENT_DATA' | 'FAILED'
  | 'RETRYABLE_ERROR' | 'SKIPPED';

export type TaskState =
  | 'RECEIVED' | 'VALIDATING' | 'PROCESSING' | 'WAITING_FOR_DATA'
  | 'PARTIAL' | 'READY_FOR_ACCEPTANCE' | 'COMPLETED'
  | 'REJECTED' | 'FAILED' | 'CANCELLED' | 'SUPERSEDED';

export interface RawDataPoint<T = unknown> {
  readonly sourceId: string;
  readonly value: T;
  readonly eventTime: Timestamp;
  readonly closedAt?: Timestamp;
  readonly arrivalTime: Timestamp;
  readonly availabilityTime: Timestamp;
  readonly version: number;
  readonly fingerprint: Fingerprint;
  /** Stage 8B: original timestamp as provided by source (pre-UTC conversion) */
  readonly sourceTimestamp?: string;
}