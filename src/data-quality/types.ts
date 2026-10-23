import type { DataReference, Timestamp } from '../core/types';

export type Severity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
export type CheckCategory = 'STRUCTURAL' | 'COMPLETENESS' | 'FRESHNESS' | 'ANOMALY' | 'SUITABILITY';

/** §6.4: decision per use-case */
export interface UsageDecision {
  readonly rsi_atr: boolean;
  readonly source_comparison: boolean;
  readonly volume_profile: boolean;
  readonly delta_cvd: boolean;
  readonly order_flow: boolean;
  readonly news_analysis: boolean;
}

export interface QualityFinding {
  readonly checkId: string;
  readonly checkVersion?: string;
  readonly category: CheckCategory;
  readonly severity: Severity;
  readonly message: string;
  readonly affectedRange?: { readonly from: Timestamp; readonly to: Timestamp };
  readonly evidence?: Record<string, unknown>;
}

/** §6.5: Quality report artifact */
export interface QualityReport {
  readonly reportId: string;
  readonly check_id: string;
  readonly dataSnapshot: DataReference;
  readonly source: string;
  readonly instrument: string;
  readonly timeframe: string;
  readonly range: { readonly from: Timestamp; readonly to: Timestamp };
  readonly evaluated_at_utc: Timestamp;
  readonly quality_rules_version: string;
  readonly engine_version: string;
  readonly findings: ReadonlyArray<QualityFinding>;
  readonly defects_count: number;
  readonly warnings_count: number;
  readonly suitable_for: UsageDecision;
  readonly overall_status: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL';
}

export interface QualityVerdict {
  readonly overallStatus: 'PASS' | 'PASS_WITH_WARNINGS' | 'FAIL';
  readonly findings: ReadonlyArray<QualityFinding>;
  /** @deprecated — kept for backward compatibility; use suitable_for */
  readonly suitableForTask: boolean;
  readonly suitable_for: UsageDecision;
  readonly dataReference: DataReference;
  readonly instrument: string;
  readonly timeframe: string;
  readonly evaluatedAt: Timestamp;
  readonly asOfCutoff: Timestamp;
  readonly policyVersion: string;
  readonly qualityRulesVersion: string;
  readonly report: QualityReport;
}

export interface RefreshRequest {
  readonly requestId: string;
  readonly sourceId: string;
  readonly range: { readonly from: Timestamp; readonly to: Timestamp };
  readonly reason: string;
  readonly requestedAt: Timestamp;
}