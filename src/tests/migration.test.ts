import { describe, it, expect } from 'vitest';
import { MigrationPolicy } from '../core/migration';
import type { VersionBundle } from '../core/types';

const V1: VersionBundle = { schemaVersion: '1.0', policyVersion: 'p1', configVersion: 'c1', engineVersion: 'e1' };
const V2: VersionBundle = { schemaVersion: '1.0', policyVersion: 'p2', configVersion: 'c1', engineVersion: 'e1' };
const V3: VersionBundle = { schemaVersion: '2.0', policyVersion: 'p1', configVersion: 'c1', engineVersion: 'e1' };
const V4: VersionBundle = { schemaVersion: '1.0', policyVersion: 'p1', configVersion: 'c2', engineVersion: 'e1' };

describe('MigrationPolicy (§2.8)', () => {
  it('CURRENT when versions match', () => {
    const mp = new MigrationPolicy(V1);
    const r = mp.assess({ result_id: 'r1', versions: V1, produced_at_utc: '2025-01-01T00:00:00Z' });
    expect(r.status).toBe('CURRENT');
    expect(r.requires_recompute).toBe(false);
    expect(r.version_delta.length).toBe(0);
  });

  it('STALE when policy changed', () => {
    const mp = new MigrationPolicy(V2);
    const r = mp.assess({ result_id: 'r1', versions: V1, produced_at_utc: '2025-01-01T00:00:00Z' });
    expect(r.status).toBe('STALE');
    expect(r.requires_recompute).toBe(true);
    expect(r.reason).toContain('policy');
    expect(r.version_delta.some(d => d.field === 'policyVersion')).toBe(true);
  });

  it('SUPERSEDED when schema changed', () => {
    const mp = new MigrationPolicy(V3);
    const r = mp.assess({ result_id: 'r1', versions: V1, produced_at_utc: '2025-01-01T00:00:00Z' });
    expect(r.status).toBe('SUPERSEDED');
    expect(r.requires_recompute).toBe(true);
    expect(r.reason).toContain('schema');
  });

  it('STALE when only config changed (no recompute)', () => {
    const mp = new MigrationPolicy(V4);
    const r = mp.assess({ result_id: 'r1', versions: V1, produced_at_utc: '2025-01-01T00:00:00Z' });
    expect(r.status).toBe('STALE');
    expect(r.requires_recompute).toBe(false);
  });

  it('fingerprintBundle is deterministic', () => {
    const mp = new MigrationPolicy(V1);
    expect(mp.fingerprintBundle(V1)).toBe(mp.fingerprintBundle(V1));
    expect(mp.fingerprintBundle(V1)).not.toBe(mp.fingerprintBundle(V2));
  });
});