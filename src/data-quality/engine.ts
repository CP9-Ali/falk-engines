import type { AuditLog } from '../audit/audit-log';
import { newId } from '../core/ids';
import { now } from '../core/time';
import { engineVersion } from '../core/versions';
import type { QualityCheck, CheckContext, Candle } from './checks/base';
import type {
  QualityFinding, QualityVerdict, RefreshRequest, QualityReport, UsageDecision,
} from './types';
import type { RawDataPoint, DataReference } from '../core/types';

export interface QualityConfig {
  readonly engineVersion: string;
  readonly policyVersion: string;
  readonly configVersion: string;
  /** §6.5: rules version — optional, defaults to '1.0.0' */
  readonly qualityRulesVersion?: string;
}

/** §6.4: derive usage decision from findings */
function computeUsageDecision(findings: ReadonlyArray<QualityFinding>): UsageDecision {
  const hasCritical = findings.some(f => f.severity === 'CRITICAL');
  const hasHigh = findings.some(f => f.severity === 'HIGH');
  const structuralOk = !hasCritical;
  const fullOk = !hasCritical && !hasHigh;
  const volumeIssue = findings.some(f => f.checkId.includes('MISSING') && f.message.toLowerCase().includes('volume'));
  const timestampIssue = findings.some(f => f.category === 'FRESHNESS' && (f.severity === 'HIGH' || f.severity === 'CRITICAL'));

  return {
    rsi_atr: structuralOk,
    source_comparison: structuralOk && !timestampIssue,
    volume_profile: fullOk && !volumeIssue,
    delta_cvd: false,       // §6.4: OHLC insufficient
    order_flow: false,      // §6.4: no Level-2
    news_analysis: fullOk && !timestampIssue,
  };
}

export class DataQualityEngine {
  constructor(
    private readonly config: QualityConfig,
    private readonly checks: ReadonlyArray<QualityCheck>,
    private readonly audit: AuditLog,
  ) {}

  assess(input: {
    dataReference: DataReference;
    /** §6.5 — optional, defaults to 'XAUUSD' */
    instrument?: string;
    /** §6.5 — optional, defaults to 'unknown' */
    timeframe?: string;
    points: ReadonlyArray<RawDataPoint<Candle>>;
    range: { from: string; to: string };
    asOfCutoff: string;
    expectedCadenceMs: number;
    actor: string;
  }): { verdict: QualityVerdict; refreshRequests: ReadonlyArray<RefreshRequest> } {
    const instrument = input.instrument ?? 'XAUUSD';
    const timeframe = input.timeframe ?? 'unknown';
    const qualityRulesVersion = this.config.qualityRulesVersion ?? '1.0.0';

    const ctx: CheckContext = {
      sourceId: input.dataReference.sourceId,
      instrument,
      timeframe,
      points: input.points,
      range: input.range,
      expectedCadenceMs: input.expectedCadenceMs,
      asOfCutoff: input.asOfCutoff,
    };
    const findings: QualityFinding[] = this.checks.flatMap(c => [...c.run(ctx)]);

    const hasCritical = findings.some(f => f.severity === 'CRITICAL');
    const hasHigh = findings.some(f => f.severity === 'HIGH');
    const overallStatus = hasCritical ? 'FAIL' : hasHigh ? 'PASS_WITH_WARNINGS' : 'PASS';
    const suitableForTask = !hasCritical;
    const usage = computeUsageDecision(findings);
    const evaluatedAt = now();

    // §6.5: QualityReport artifact
    const report: QualityReport = {
      reportId: newId('qrep'),
      check_id: newId('qck'),
      dataSnapshot: input.dataReference,
      source: input.dataReference.sourceId,
      instrument,
      timeframe,
      range: input.range,
      evaluated_at_utc: evaluatedAt,
      quality_rules_version: qualityRulesVersion,
      engine_version: engineVersion('quality'),
      findings,
      defects_count: findings.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH').length,
      warnings_count: findings.filter(f => f.severity === 'INFO' || f.severity === 'WARNING').length,
      suitable_for: usage,
      overall_status: overallStatus,
    };

    const verdict: QualityVerdict = {
      overallStatus,
      findings,
      suitableForTask,
      suitable_for: usage,
      dataReference: input.dataReference,
      instrument,
      timeframe,
      evaluatedAt,
      asOfCutoff: input.asOfCutoff,
      policyVersion: this.config.policyVersion,
      qualityRulesVersion,
      report,
    };

    const refreshRequests: RefreshRequest[] = findings
      .filter(f => f.category === 'COMPLETENESS' && f.affectedRange)
      .map(f => ({
        requestId: newId('refresh'),
        sourceId: input.dataReference.sourceId,
        range: f.affectedRange!,
        reason: f.checkId + ': ' + f.message,
        requestedAt: input.asOfCutoff,
      }));

    this.audit.append({
      eventType: 'QUALITY_ASSESSED',
      engine: 'DataQuality',
      eventTime: input.asOfCutoff,
      recordTime: now(),
      actor: input.actor,
      refs: { snapshotId: input.dataReference.snapshotId, reportId: report.reportId },
      versions: {
        schemaVersion: '1.0',
        policyVersion: this.config.policyVersion,
        configVersion: this.config.configVersion,
        engineVersion: this.config.engineVersion,
      },
      payload: {
        overallStatus, suitableForTask, suitable_for: usage,
        findingsCount: findings.length, refreshRequestsCount: refreshRequests.length,
        reportId: report.reportId, instrument, timeframe,
      },
    });

    return { verdict, refreshRequests };
  }
}