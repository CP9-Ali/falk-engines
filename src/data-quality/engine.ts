import type { AuditLog } from '../audit/audit-log';
import { newId } from '../core/ids';
import { now } from '../core/time';
import type { QualityCheck, CheckContext, Candle } from './checks/base';
import type { QualityFinding, QualityVerdict, RefreshRequest } from './types';
import type { RawDataPoint, DataReference } from '../core/types';

export interface QualityConfig {
  readonly engineVersion: string;
  readonly policyVersion: string;
  readonly configVersion: string;
}

export class DataQualityEngine {
  constructor(
    private readonly config: QualityConfig,
    private readonly checks: ReadonlyArray<QualityCheck>,
    private readonly audit: AuditLog,
  ) {}

  assess(input: {
    dataReference: DataReference;
    points: ReadonlyArray<RawDataPoint<Candle>>;
    range: { from: string; to: string };
    asOfCutoff: string;
    expectedCadenceMs: number;
    actor: string;
  }): { verdict: QualityVerdict; refreshRequests: ReadonlyArray<RefreshRequest> } {
    const ctx: CheckContext = {
      sourceId: input.dataReference.sourceId,
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

    const verdict: QualityVerdict = {
      overallStatus, findings, suitableForTask,
      dataReference: input.dataReference,
      evaluatedAt: now(),
      asOfCutoff: input.asOfCutoff,
      policyVersion: this.config.policyVersion,
    };

    const refreshRequests: RefreshRequest[] = findings
      .filter(f => f.category === 'COMPLETENESS' && f.affectedRange)
      .map(f => ({
        requestId: newId('refresh'),
        sourceId: input.dataReference.sourceId,
        range: f.affectedRange!,
        reason: `${f.checkId}: ${f.message}`,
        requestedAt: input.asOfCutoff,
      }));

    this.audit.append({
      eventType: 'QUALITY_ASSESSED',
      engine: 'DataQuality',
      eventTime: input.asOfCutoff, recordTime: now(),
      actor: input.actor,
      refs: { snapshotId: input.dataReference.snapshotId },
      versions: {
        schemaVersion: '1.0',
        policyVersion: this.config.policyVersion,
        configVersion: this.config.configVersion,
        engineVersion: this.config.engineVersion,
      },
      payload: { overallStatus, suitableForTask, findings: findings.length, refreshRequests: refreshRequests.length },
    });

    return { verdict, refreshRequests };
  }
}