import type { AuditLog } from '../audit/audit-log';
import { FalkError } from '../core/errors';
import { isAtOrBefore, now } from '../core/time';
import { engineVersion } from '../core/versions';
import type { FusionPolicy, FusionResult, SourceValue } from './types';
import type { Timestamp } from '../core/types';

export interface FusionReport {
  readonly report_id: string;
  readonly as_of_cutoff: string;
  readonly policy_version: string;
  readonly engine_version: string;
  readonly conflict_status: string;
  readonly fused_value: number | null;
  readonly sources_used: number;
  readonly sources_dropped: ReadonlyArray<{ sourceId: string; reason: string }>;
  readonly provenance: ReadonlyArray<{ sourceId: string; weight: number }>;
  readonly created_at_utc: string;
}

const V = {
  schemaVersion: '1.0',
  configVersion: '1.0',
} as const;

export class DataFusionEngine {
  private readonly lastChosenSource = new Map<string, string>();

  constructor(private readonly audit: AuditLog, private readonly engineVersion: string) {}

  fuse<T extends { close: number }>(
    inputs: ReadonlyArray<SourceValue<T>>,
    policy: FusionPolicy,
    asOfCutoff: Timestamp,
    actor: string,
    streamKey: string = 'default',
  ): FusionResult<T> {
    const available = inputs.filter(s => isAtOrBefore(s.availabilityTime, asOfCutoff));
    const usable = available.filter(s => s.qualityStatus !== 'FAIL');
    const dropped = available
      .filter(s => s.qualityStatus === 'FAIL')
      .map(s => ({ sourceId: s.sourceId, reason: 'QUALITY_FAIL' as const }));

    if (usable.length === 0) {
      return {
        fusedValue: null,
        conflictStatus: 'UNRESOLVED',
        provenance: [],
        droppedSources: dropped,
        asOfCutoff,
        policyVersion: policy.policyVersion,
      };
    }

    const prioritized = [...usable].sort((a, b) => {
      const ia = policy.priorityOrder.indexOf(a.sourceId);
      const ib = policy.priorityOrder.indexOf(b.sourceId);
      return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia)
           - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib);
    });

    let chosen = prioritized[0]!;

    const previous = this.lastChosenSource.get(streamKey);
    if (previous && previous !== chosen.sourceId && !policy.allowSourceSwitching) {
      const prev = prioritized.find(s => s.sourceId === previous);
      this.audit.append({
        eventType: 'FUSION_SWITCH_BLOCKED',
        engine: 'DataFusion',
        eventTime: asOfCutoff,
        recordTime: now(),
        actor,
        refs: { streamKey },
        versions: {
          schemaVersion: V.schemaVersion,
          policyVersion: policy.policyVersion,
          configVersion: V.configVersion,
          engineVersion: this.engineVersion,
        },
        payload: {
          attempted: chosen.sourceId,
          kept: prev?.sourceId ?? null,
          reason: prev ? 'kept-priority' : 'previous-not-available',
        },
      });
      if (prev) {
        chosen = prev;
      }
    }
    this.lastChosenSource.set(streamKey, chosen.sourceId);

    const closes = prioritized.map(s => s.value.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const spreadBps = min > 0 ? ((max - min) / min) * 10_000 : 0;

    let conflictStatus: FusionResult<T>['conflictStatus'] = 'NONE';
    let fusedValue: T | null = null;
    let provenance: FusionResult<T>['provenance'] = [];

    if (prioritized.length === 1) {
      fusedValue = chosen.value;
      provenance = [{ sourceId: chosen.sourceId, value: chosen.value, weight: 1 }];
    } else if (spreadBps <= policy.toleranceBps) {
      fusedValue = chosen.value;
      conflictStatus = 'RESOLVED_BY_TOLERANCE';
      provenance = prioritized.map(s => ({
        sourceId: s.sourceId,
        value: s.value,
        weight: s.sourceId === chosen.sourceId ? 1 : 0,
      }));
    } else {
      switch (policy.conflictStrategy) {
        case 'STRICT_PRIORITY':
          fusedValue = chosen.value;
          conflictStatus = 'RESOLVED_BY_POLICY';
          provenance = prioritized.map(s => ({
            sourceId: s.sourceId,
            value: s.value,
            weight: s.sourceId === chosen.sourceId ? 1 : 0,
          }));
          break;
        case 'MEDIAN': {
          const sorted = [...prioritized].sort((a, b) => a.value.close - b.value.close);
          const med = sorted[Math.floor(sorted.length / 2)]!;
          fusedValue = med.value;
          conflictStatus = 'RESOLVED_BY_POLICY';
          provenance = prioritized.map(s => ({
            sourceId: s.sourceId,
            value: s.value,
            weight: s.sourceId === med.sourceId ? 1 : 0,
          }));
          break;
        }
        case 'REJECT_ON_CONFLICT':
          fusedValue = null;
          conflictStatus = 'UNRESOLVED';
          provenance = prioritized.map(s => ({
            sourceId: s.sourceId,
            value: s.value,
            weight: 0,
          }));
          break;
        case 'WEIGHTED_AVERAGE_REQUIRES_APPROVAL':
          throw new FalkError(
            'WEIGHTED_AVERAGE requires explicit approval (§1.1, §16)',
            'WEIGHTED_AVERAGE_REQUIRES_APPROVAL',
          );
      }
    }

    this.audit.append({
      eventType: 'FUSION_APPLIED',
      engine: 'DataFusion',
      eventTime: asOfCutoff,
      recordTime: now(),
      actor,
      refs: { streamKey },
      versions: {
        schemaVersion: V.schemaVersion,
        policyVersion: policy.policyVersion,
        configVersion: V.configVersion,
        engineVersion: this.engineVersion,
      },
      payload: {
        conflictStatus,
        usableSources: prioritized.length,
        chosen: chosen.sourceId,
      },
    });

    return {
      fusedValue,
      conflictStatus,
      provenance,
      droppedSources: dropped,
      asOfCutoff,
      policyVersion: policy.policyVersion,
    };
  }

  /** §6: يحوّل نتيجة fusion إلى تقرير قابل للحفظ */
  buildReport(
    result: FusionResult<any>,
    policy: FusionPolicy,
  ): FusionReport {
    return {
      report_id: 'frep-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      as_of_cutoff: result.asOfCutoff,
      policy_version: policy.policyVersion,
      engine_version: engineVersion('fusion'),
      conflict_status: result.conflictStatus,
      fused_value: result.fusedValue && (result.fusedValue as any).close !== undefined
        ? (result.fusedValue as any).close
        : null,
      sources_used: result.provenance.length,
      sources_dropped: result.droppedSources.map(d => ({ sourceId: d.sourceId, reason: d.reason })),
      provenance: result.provenance.map(p => ({ sourceId: p.sourceId, weight: p.weight })),
      created_at_utc: new Date().toISOString(),
    };
  }
}