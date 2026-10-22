import type { ExecutionStatus, Id, Timestamp } from '../core/types';

export type MessageType =
  | 'DATA_INGESTED'
  | 'QUALITY_CHECK_REQUEST'   | 'QUALITY_CHECK_RESULT'
  | 'REFRESH_REQUEST'
  | 'FUSION_REQUEST'          | 'FUSION_RESULT'
  | 'FEATURE_COMPUTE_REQUEST' | 'FEATURE_COMPUTE_RESULT'
  | 'ACCEPTANCE_REQUEST'      | 'ACCEPTANCE_RESULT';

export interface MessageEnvelope<P = unknown> {
  readonly messageId: Id;
  readonly requestId: Id;
  readonly messageType: MessageType;
  readonly sender: string;
  readonly recipient: string;
  readonly schemaVersion: string;
  readonly dataReference: { readonly snapshotId: Id; readonly contentFingerprint: string };
  readonly timeContext: {
    readonly eventTime: Timestamp;
    readonly arrivalTime: Timestamp;
    readonly processingTime: Timestamp;
    readonly asOfCutoff: Timestamp;
  };
  readonly policyVersion: string;
  readonly payload: P;
  readonly executionStatus: ExecutionStatus;
  readonly traceId: Id;
}

export class MessageDeduplicator {
  private readonly seen = new Set<Id>();
  accept(envelope: MessageEnvelope): boolean {
    if (this.seen.has(envelope.messageId)) return false;
    this.seen.add(envelope.messageId);
    return true;
  }
}