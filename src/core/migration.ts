import { createHash } from 'node:crypto';
import type { VersionBundle } from './types';

/**
 * §2.8: أي تغيير في القاعدة أو الإعداد أو المعادلة ينتج إصداراً جديداً.
 * عند تغيير الإصدار، النتائج القديمة تُعلَّم بأنها "stale" حتى إعادة التحقق.
 * لا تُمسح النتائج القديمة.
 */

export type MigrationStatus = 'CURRENT' | 'STALE' | 'SUPERSEDED' | 'UNKNOWN';

export interface ResultVersionInfo {
  readonly result_id: string;
  readonly versions: VersionBundle;
  readonly produced_at_utc: string;
}

export interface MigrationAssessment {
  readonly result_id: string;
  readonly status: MigrationStatus;
  readonly reason: string;
  readonly requires_recompute: boolean;
  readonly version_delta: ReadonlyArray<{ field: string; old_value: string; new_value: string }>;
}

export class MigrationPolicy {
  constructor(private readonly currentVersions: VersionBundle) {}

  assess(stored: ResultVersionInfo): MigrationAssessment {
    const delta: { field: string; old_value: string; new_value: string }[] = [];

    if (stored.versions.schemaVersion !== this.currentVersions.schemaVersion) {
      delta.push({ field: 'schemaVersion', old_value: stored.versions.schemaVersion, new_value: this.currentVersions.schemaVersion });
    }
    if (stored.versions.policyVersion !== this.currentVersions.policyVersion) {
      delta.push({ field: 'policyVersion', old_value: stored.versions.policyVersion, new_value: this.currentVersions.policyVersion });
    }
    if (stored.versions.configVersion !== this.currentVersions.configVersion) {
      delta.push({ field: 'configVersion', old_value: stored.versions.configVersion, new_value: this.currentVersions.configVersion });
    }
    if (stored.versions.engineVersion !== this.currentVersions.engineVersion) {
      delta.push({ field: 'engineVersion', old_value: stored.versions.engineVersion, new_value: this.currentVersions.engineVersion });
    }

    if (delta.length === 0) {
      return {
        result_id: stored.result_id,
        status: 'CURRENT',
        reason: 'all versions match current',
        requires_recompute: false,
        version_delta: [],
      };
    }

    // §2.8: policyVersion change → النتيجة قد تكون صحيحة وفق السياسة القديمة لكنها لا تُقارن مباشرة
    const policyChanged = delta.some(d => d.field === 'policyVersion');
    const schemaChanged = delta.some(d => d.field === 'schemaVersion');

    if (schemaChanged) {
      return {
        result_id: stored.result_id,
        status: 'SUPERSEDED',
        reason: 'schema changed — result format may be incompatible',
        requires_recompute: true,
        version_delta: delta,
      };
    }

    if (policyChanged) {
      return {
        result_id: stored.result_id,
        status: 'STALE',
        reason: 'policy changed — result valid under old policy only',
        requires_recompute: true,
        version_delta: delta,
      };
    }

    // engine/config only
    return {
      result_id: stored.result_id,
      status: 'STALE',
      reason: 'engine or config changed — verify against new version',
      requires_recompute: false,
      version_delta: delta,
    };
  }

  fingerprintBundle(b: VersionBundle): string {
    return createHash('sha256').update(JSON.stringify(b)).digest('hex').slice(0, 16);
  }
}