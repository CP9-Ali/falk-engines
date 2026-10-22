import type { AuditLog } from '../audit/audit-log';
import type { FeatureComputeResult, FeatureStatus } from '../feature-engineering/types';
import type { FusionPolicy } from '../data-fusion/types';
import type { QualityCheck, Candle } from '../data-quality/checks/base';
import type { QualityVerdict } from '../data-quality/types';
import type { ExecutionStatus, RawDataPoint, TaskState } from '../core/types';
import { DataQualityEngine } from '../data-quality/engine';
import { DataFusionEngine } from '../data-fusion/engine';
import { FeatureEngineeringEngine } from '../feature-engineering/engine';
import type { FeatureRegistry } from '../feature-engineering/registry';
import { Task } from '../orchestration/task';
import { AuthorizationService, type Principal } from '../security/permissions';
import { SchemaValidator } from '../contracts/schema-validator';
import type { MetricsRegistry } from '../monitoring/metrics';

export interface PipelineSource {
  readonly sourceId: string;
  readonly points: ReadonlyArray<RawDataPoint<Candle>>;
}

export interface PipelineInput {
  readonly taskId: string;
  readonly requestId: string;
  readonly actor: Principal;
  readonly asOfCutoff: string;
  readonly snapshotRef: { readonly snapshotId: string; readonly contentFingerprint: string };
  readonly sources: ReadonlyArray<PipelineSource>;
  readonly fusionPolicy: FusionPolicy;
  readonly featureTargets: ReadonlyArray<{ featureId: string; definitionVersion: string }>;
  readonly featureInputs: ReadonlyMap<string, unknown>;
}

export interface PipelineResult {
  readonly taskId: string;
  readonly finalState: TaskState;
  readonly executionStatus: ExecutionStatus;
  readonly qualityBefore: ReadonlyArray<QualityVerdict>;
  readonly qualityAfter: QualityVerdict | null;
  readonly fused: { readonly value: number | null; readonly conflictStatus: string } | null;
  readonly features: ReadonlyMap<string, FeatureComputeResult>;
  readonly auditEventCount: number;
  readonly errorMessage: string | null;
}

const mapFeatureStatus = (s: FeatureStatus): ExecutionStatus => {
  switch (s) {
    case 'VALID': return 'SUCCESS';
    case 'UNDER_VALIDATION': return 'SUCCESS_PARTIAL';
    case 'UNAVAILABLE':
    case 'INSUFFICIENT_INPUTS': return 'INSUFFICIENT_DATA';
    case 'COMPUTATION_FAILED': return 'RETRYABLE_ERROR';
  }
};

export function runPipeline(
  input: PipelineInput,
  deps: {
    qualityChecks: ReadonlyArray<QualityCheck>;
    featureRegistry: FeatureRegistry;
    audit: AuditLog;
    auth: AuthorizationService;
    metrics?: MetricsRegistry;
  },
): PipelineResult {
  const task = new Task(input.taskId, input.requestId, deps.audit, input.actor.principalId);
  const actorId = input.actor.principalId;
  const startMs = Date.now();
  deps.metrics?.increment('pipeline.started');

  try {
    deps.auth.enforce(input.actor, 'RUN_TASK');

    const validator = new SchemaValidator();
    const envelopeCheck = validator.validate({
      messageId: `${input.taskId}-msg`,
      requestId: input.requestId,
      messageType: 'FEATURE_COMPUTE_REQUEST',
      sender: 'orchestrator', recipient: 'pipeline',
      schemaVersion: '1.0',
      dataReference: input.snapshotRef,
      timeContext: {
        eventTime: input.asOfCutoff, arrivalTime: input.asOfCutoff,
        processingTime: input.asOfCutoff, asOfCutoff: input.asOfCutoff,
      },
      policyVersion: input.fusionPolicy.policyVersion,
      payload: {}, executionStatus: 'SUCCESS', traceId: `tr-${input.requestId}`,
    });
    if (!envelopeCheck.valid) {
      throw new Error(`Message schema invalid: ${envelopeCheck.errors.map(e => e.field).join(',')}`);
    }

    task.transition('VALIDATING');

    const dq = new DataQualityEngine(
      { engineVersion: '1.0', policyVersion: 'pipeline-v1', configVersion: 'c1' },
      deps.qualityChecks, deps.audit,
    );

    const qualityBefore: QualityVerdict[] = input.sources.map(src => dq.assess({
      dataReference: {
        snapshotId: input.snapshotRef.snapshotId,
        contentFingerprint: input.snapshotRef.contentFingerprint,
        sourceId: src.sourceId,
        range: { from: src.points[0]?.eventTime ?? input.asOfCutoff, to: input.asOfCutoff },
      },
      points: src.points,
      range: { from: src.points[0]?.eventTime ?? input.asOfCutoff, to: input.asOfCutoff },
      asOfCutoff: input.asOfCutoff,
      expectedCadenceMs: 3600_000,
      actor: actorId,
    }).verdict);

    task.transition('PROCESSING');

    const fusion = new DataFusionEngine(deps.audit, '1.0');
    const fusedResult = fusion.fuse(
      input.sources.map((s, i) => {
        const last = s.points[s.points.length - 1];
        const close = last?.value.close ?? 0;
        const qv = qualityBefore[i]!;
        const qualityStatus =
          qv.overallStatus === 'FAIL' ? 'FAIL'
          : qv.overallStatus === 'PASS_WITH_WARNINGS' ? 'PASS_WITH_WARNINGS'
          : 'PASS';
        return {
          sourceId: s.sourceId, value: { close },
          eventTime: last?.eventTime ?? input.asOfCutoff,
          availabilityTime: last?.availabilityTime ?? input.asOfCutoff,
          sourceVersion: last?.version ?? 1,
          qualityStatus,
        };
      }),
      input.fusionPolicy, input.asOfCutoff, actorId, 'pipeline',
    );

    let qualityAfter: QualityVerdict | null = null;
    if (input.sources[0] && fusedResult.fusedValue !== null) {
      const fusedPoint: RawDataPoint<Candle> = {
        sourceId: 'fused',
        value: {
          open: fusedResult.fusedValue.close, high: fusedResult.fusedValue.close,
          low: fusedResult.fusedValue.close, close: fusedResult.fusedValue.close,
          volume: 0,
        },
        eventTime: input.asOfCutoff, closedAt: input.asOfCutoff,
        arrivalTime: input.asOfCutoff, availabilityTime: input.asOfCutoff,
        version: 1, fingerprint: `fused-${input.asOfCutoff}`,
      };
      qualityAfter = dq.assess({
        dataReference: {
          snapshotId: input.snapshotRef.snapshotId,
          contentFingerprint: input.snapshotRef.contentFingerprint,
          sourceId: 'fused', range: { from: input.asOfCutoff, to: input.asOfCutoff },
        },
        points: [fusedPoint],
        range: { from: input.asOfCutoff, to: input.asOfCutoff },
        asOfCutoff: input.asOfCutoff, expectedCadenceMs: 3600_000, actor: actorId,
      }).verdict;
    }

    const fe = new FeatureEngineeringEngine(
      deps.featureRegistry,
      { engineVersion: '1.0', policyVersion: 'pipeline-v1', configVersion: 'c1' },
      deps.audit,
    );
    const features = fe.computeBatch({
      requestId: input.requestId,
      asOfCutoff: input.asOfCutoff,
      snapshotRef: input.snapshotRef,
      fusionPolicyVersion: input.fusionPolicy.policyVersion,
      targets: input.featureTargets,
      inputs: input.featureInputs,
      actor: actorId,
    });

    task.transition('READY_FOR_ACCEPTANCE');

    const statuses = [...features.values()].map(f => f.status);
    let executionStatus: ExecutionStatus;
    if (statuses.length === 0) executionStatus = 'NO_RESULT';
    else if (statuses.every(s => s === 'VALID')) executionStatus = 'SUCCESS';
    else if (statuses.some(s => s === 'VALID')) executionStatus = 'SUCCESS_PARTIAL';
    else if (statuses.some(s => s === 'COMPUTATION_FAILED')) executionStatus = 'RETRYABLE_ERROR';
    else if (statuses.some(s => s === 'INSUFFICIENT_INPUTS')) executionStatus = 'INSUFFICIENT_DATA';
    else executionStatus = 'SKIPPED';

    const versionRefsConsistent =
      fusedResult.policyVersion === input.fusionPolicy.policyVersion &&
      [...features.values()].every(f => f.fusionPolicyVersion === input.fusionPolicy.policyVersion);

    task.tryComplete({
      acceptancePassed: qualityAfter?.suitableForTask ?? true,
      versionRefsConsistent,
      resultStored: features.size > 0,
    });

    const durMs = Date.now() - startMs;
    deps.metrics?.observe('pipeline.duration_ms', durMs);
    deps.metrics?.increment(`pipeline.status.${executionStatus}`);

    return {
      taskId: input.taskId, finalState: task.getState(), executionStatus,
      qualityBefore, qualityAfter,
      fused: { value: fusedResult.fusedValue?.close ?? null, conflictStatus: fusedResult.conflictStatus },
      features,
      auditEventCount: deps.audit.readAll().length,
      errorMessage: null,
    };
  } catch (err) {
    forceFail(task, err as Error);
    deps.metrics?.increment('pipeline.status.FAILED');
    return {
      taskId: input.taskId, finalState: task.getState(), executionStatus: 'FAILED',
      qualityBefore: [], qualityAfter: null, fused: null, features: new Map(),
      auditEventCount: deps.audit.readAll().length,
      errorMessage: (err as Error).message,
    };
  }
}

function forceFail(task: Task, err: Error): void {
  const current = task.getState();
  if (current === 'FAILED' || current === 'REJECTED' || current === 'CANCELLED') return;
  for (const target of ['FAILED', 'REJECTED', 'CANCELLED'] as const) {
    try { task.transition(target, err.message); return; } catch { /* next */ }
  }
}