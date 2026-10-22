import { LookaheadGuard } from '../core/time';
import type { Timestamp } from '../core/types';
import type { FeatureComputeResult, FeatureDefinition } from './types';

export interface ShadowComparison {
  readonly featureId: string;
  readonly oldVersion: string;
  readonly newVersion: string;
  readonly oldStatus: string;
  readonly newStatus: string;
  readonly oldValue: unknown;
  readonly newValue: unknown;
  readonly match: boolean;
  readonly reason: string;
}

export class ShadowTester {
  compare<In, Out>(
    oldDef: FeatureDefinition<In, Out>,
    newDef: FeatureDefinition<In, Out>,
    inputs: In,
    asOfCutoff: Timestamp,
    snapshotRef: { snapshotId: string; contentFingerprint: string },
    policyVersion: string,
  ): ShadowComparison {
    const guard = new LookaheadGuard(asOfCutoff);
    const ctx = {
      asOfCutoff,
      policyVersion,
      guard,
      inputs,
      dependencyResults: new Map<string, FeatureComputeResult>(),
      snapshotRef,
    };

    const runOne = (def: FeatureDefinition<In, Out>): FeatureComputeResult => {
      try {
        return def.compute({ ...ctx, definitionVersion: def.definitionVersion });
      } catch (e) {
        return {
          featureId: def.featureId,
          definitionVersion: def.definitionVersion,
          status: 'COMPUTATION_FAILED' as const,
          value: null,
          asOfCutoff,
          computedAt: asOfCutoff,
          availabilityTime: null,
          error: (e as Error).message,
          snapshotRef,
          fusionPolicyVersion: policyVersion,
        };
      }
    };

    const oldResult = runOne(oldDef);
    const newResult = runOne(newDef);

    const match =
      oldResult.status === newResult.status &&
      JSON.stringify(oldResult.value) === JSON.stringify(newResult.value);

    return {
      featureId: oldDef.featureId,
      oldVersion: oldDef.definitionVersion,
      newVersion: newDef.definitionVersion,
      oldStatus: oldResult.status,
      newStatus: newResult.status,
      oldValue: oldResult.value,
      newValue: newResult.value,
      match,
      reason: match ? 'identical results on test data' : 'divergence detected',
    };
  }
}