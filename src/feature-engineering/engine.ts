import type { AuditLog } from '../audit/audit-log';
import { FalkError } from '../core/errors';
import { LookaheadGuard, now } from '../core/time';
import type { Timestamp } from '../core/types';
import type { FeatureComputeResult, FeatureDefinition } from './types';
import type { FeatureRegistry } from './registry';

export interface BatchRequest {
  readonly requestId: string;
  readonly asOfCutoff: Timestamp;
  readonly snapshotRef: { readonly snapshotId: string; readonly contentFingerprint: string };
  readonly fusionPolicyVersion: string;
  readonly targets: ReadonlyArray<{ featureId: string; definitionVersion: string }>;
  readonly inputs: ReadonlyMap<string, unknown>;
  readonly actor: string;
}

export class FeatureEngineeringEngine {
  constructor(
    private readonly registry: FeatureRegistry,
    private readonly config: { engineVersion: string; policyVersion: string; configVersion: string },
    private readonly audit: AuditLog,
  ) {}

  computeBatch(req: BatchRequest): ReadonlyMap<string, FeatureComputeResult> {
    const results = new Map<string, FeatureComputeResult>();
    const guard = new LookaheadGuard(req.asOfCutoff);
    const order = this.topoOrder(req.targets);

    for (const featureId of order) {
      const target = req.targets.find(t => t.featureId === featureId);
      if (!target) continue;
      const def = this.registry.get(featureId, target.definitionVersion);

      const failedDep = def.dependencies.some(d => {
        const r = results.get(d);
        return !r || ['COMPUTATION_FAILED', 'INSUFFICIENT_INPUTS', 'UNAVAILABLE'].includes(r.status);
      });
      if (failedDep) {
        results.set(featureId, this.makeEmpty(def, req, 'INSUFFICIENT_INPUTS', 'Dependency unavailable'));
        continue;
      }

      const inputs = req.inputs.get(featureId);
      if (inputs === undefined) {
        results.set(featureId, this.makeEmpty(def, req, 'INSUFFICIENT_INPUTS', 'Missing inputs'));
        continue;
      }

      let result: FeatureComputeResult;
      try {
        result = def.compute({
          asOfCutoff: req.asOfCutoff,
          definitionVersion: def.definitionVersion,
          policyVersion: req.fusionPolicyVersion,
          guard,
          inputs,
          parameters: def.parameters ?? {},
          dependencyResults: results,
          snapshotRef: req.snapshotRef,
        });
      } catch (err) {
        result = this.makeEmpty(def, req, 'COMPUTATION_FAILED', (err as Error).message);
      }

      if (result.status === 'VALID' && result.value !== null) {
        for (const rule of def.validationRules) {
          if (!rule.check(result.value as never)) {
            result = { ...result, status: 'UNDER_VALIDATION', error: 'Rule "' + rule.name + '" failed' };
            break;
          }
        }
      }

      this.audit.append({
        eventType: 'FEATURE_COMPUTED',
        engine: 'FeatureEngineering',
        eventTime: req.asOfCutoff,
        recordTime: now(),
        actor: req.actor,
        refs: { snapshotId: req.snapshotRef.snapshotId },
        versions: {
          schemaVersion: '1.0',
          policyVersion: req.fusionPolicyVersion,
          configVersion: this.config.configVersion,
          engineVersion: this.config.engineVersion,
        },
        payload: { featureId, definitionVersion: def.definitionVersion, status: result.status },
      });

      results.set(featureId, result);
    }
    return results;
  }

  computeAffected(req: BatchRequest, invalidatedFeatureIds: ReadonlySet<string>): ReadonlyMap<string, FeatureComputeResult> {
    const affected = new Set<string>(invalidatedFeatureIds);
    let changed = true;
    while (changed) {
      changed = false;
      for (const def of this.registry.all()) {
        if (affected.has(def.featureId)) continue;
        if (def.dependencies.some(d => affected.has(d))) { affected.add(def.featureId); changed = true; }
      }
    }
    return this.computeBatch({ ...req, targets: req.targets.filter(t => affected.has(t.featureId)) });
  }

  private topoOrder(targets: BatchRequest['targets']): string[] {
    const visiting = new Set<string>(), visited = new Set<string>();
    const order: string[] = [];
    const byId = new Map(targets.map(t => [t.featureId, t]));
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new FalkError('Dependency cycle at ' + id, 'DEPENDENCY_CYCLE');
      visiting.add(id);
      const t = byId.get(id);
      if (t) {
        const def = this.registry.get(t.featureId, t.definitionVersion);
        for (const d of def.dependencies) visit(d);
      }
      visiting.delete(id);
      visited.add(id);
      order.push(id);
    };
    for (const t of targets) visit(t.featureId);
    return order;
  }

  private makeEmpty(def: FeatureDefinition, req: BatchRequest, status: FeatureComputeResult['status'], error: string): FeatureComputeResult {
    return {
      featureId: def.featureId, definitionVersion: def.definitionVersion,
      status, value: null,
      asOfCutoff: req.asOfCutoff, computedAt: now(),
      availabilityTime: null, error,
      parameters: def.parameters ?? {},
      snapshotRef: req.snapshotRef,
      fusionPolicyVersion: req.fusionPolicyVersion,
    };
  }
}