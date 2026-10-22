import { FalkError } from '../core/errors';
import type { VersionBundle } from '../core/types';

export type ReleaseStatus = 'PROPOSED' | 'CANARY' | 'ACTIVE' | 'ROLLED_BACK' | 'RETIRED';

export interface ReleaseRecord {
  readonly bundle: VersionBundle;
  readonly status: ReleaseStatus;
  readonly activatedAt?: string;
  readonly supersededBy?: VersionBundle;
  readonly notes?: string;
}

export class VersionRegistry {
  private readonly records: ReleaseRecord[] = [];
  private active?: VersionBundle;

  propose(bundle: VersionBundle, notes?: string): void {
    if (this.records.some(r => sameBundle(r.bundle, bundle))) {
      throw new FalkError('Version bundle already proposed', 'DUPLICATE_VERSION');
    }
    this.records.push({ bundle, status: 'PROPOSED', notes });
  }

  setStatus(bundle: VersionBundle, status: ReleaseStatus, notes?: string): void {
    const rec = this.records.find(r => sameBundle(r.bundle, bundle));
    if (!rec) throw new FalkError('Unknown version bundle', 'UNKNOWN_VERSION');
    if (status === 'ACTIVE') {
      if (this.active && !sameBundle(this.active, bundle)) {
        const prev = this.records.find(r => sameBundle(r.bundle, this.active!));
        if (prev) (prev as Mutable<ReleaseRecord>).status = 'RETIRED';
      }
      this.active = bundle;
      (rec as Mutable<ReleaseRecord>).activatedAt = new Date().toISOString();
    } else {
      (rec as Mutable<ReleaseRecord>).status = status;
    }
    if (notes !== undefined) (rec as Mutable<ReleaseRecord>).notes = notes;
  }

  currentActive(): VersionBundle | undefined { return this.active; }
  history(): ReadonlyArray<ReleaseRecord> { return [...this.records]; }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function sameBundle(a: VersionBundle, b: VersionBundle): boolean {
  return a.schemaVersion === b.schemaVersion
      && a.policyVersion === b.policyVersion
      && a.configVersion === b.configVersion
      && a.engineVersion === b.engineVersion;
}