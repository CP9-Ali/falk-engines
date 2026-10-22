import { FalkError } from '../core/errors';
import type { FeatureDefinition } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFeatureDef = FeatureDefinition<any, any>;

export class FeatureRegistry {
  private readonly defs = new Map<string, AnyFeatureDef>();

  register(def: AnyFeatureDef): void {
    const key = `${def.featureId}@${def.definitionVersion}`;
    if (this.defs.has(key)) throw new FalkError(`Duplicate definition ${key}`, 'DUPLICATE_FEATURE_DEF');
    this.defs.set(key, def);
  }

  get(featureId: string, definitionVersion: string): AnyFeatureDef {
    const def = this.defs.get(`${featureId}@${definitionVersion}`);
    if (!def) throw new FalkError(`Unknown feature ${featureId}@${definitionVersion}`, 'UNKNOWN_FEATURE');
    return def;
  }

  all(): ReadonlyArray<AnyFeatureDef> { return [...this.defs.values()]; }
}