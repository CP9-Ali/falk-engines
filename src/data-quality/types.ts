import type { DataReference, Timestamp } from '../core/types';

export type Severity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
export type CheckCategory = 'STRUCTURAL' | 'COMPLETENESS' | 'FRESHNESS' | 'ANOMALY' | 'SUITABILITY';

export interface QualityFinding {
  readonly checkId: string;
  readonly category: CheckCategory;
  readonly severity: Severity;
  readonly message: string;
  readonly affectedRange?: { readonly from: Timestamp; readonly to: Timestamp };
  readonly evidence?: Record<string, unknown>;
}

export interface QualityVerdict {
  readonly overallStatus: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL';
  readonly findings: ReadonlyArray<QualityFinding>;
  readonly suitableForTask: boolean;
  readonly dataReference: DataReference;
  readonly evaluatedAt: Timestamp;
  readonly asOfCutoff: Timestamp;
  readonly policyVersion: string;
}

export interface RefreshRequest {
  readonly requestId: string;
  readonly sourceId: string;
  readonly range: { readonly from: Timestamp; readonly to: Timestamp };
  readonly reason: string;
  readonly requestedAt: Timestamp;
}