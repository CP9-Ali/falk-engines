import { describe, it, expect, beforeEach } from 'vitest';
import { rmSync } from 'node:fs';
import { ConflictLog } from '../data-fusion/conflict-record';

const TEST_DIR = '.backup-conflicts-test';

describe('ConflictLog (§12)', () => {
  beforeEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('records conflict', () => {
    const cl = new ConflictLog(TEST_DIR);
    const c = cl.record({
      as_of_cutoff: '2025-01-01T00:00:00Z',
      policy_version: 'p1',
      stream_key: 'gold',
      sources: [
        { source_id: 'A', close: 4000, weight: 1 },
        { source_id: 'B', close: 4005, weight: 0 },
      ],
      spread_bps: 12.5,
      resolution: 'RESOLVED_BY_POLICY',
      resolved_by: 'STRICT_PRIORITY',
    });
    expect(c.conflict_id).toMatch(/^conf-/);
    expect(cl.count()).toBe(1);
  });

  it('filters by resolution', () => {
    const cl = new ConflictLog(TEST_DIR);
    cl.record({ as_of_cutoff: '2025-01-01T00:00:00Z', policy_version: 'p1', stream_key: 'g', sources: [], spread_bps: 10, resolution: 'RESOLVED_BY_POLICY', resolved_by: 'STRICT_PRIORITY' });
    cl.record({ as_of_cutoff: '2025-01-01T00:01:00Z', policy_version: 'p1', stream_key: 'g', sources: [], spread_bps: 10, resolution: 'UNRESOLVED', resolved_by: 'REJECT' });
    cl.record({ as_of_cutoff: '2025-01-01T00:02:00Z', policy_version: 'p1', stream_key: 'g', sources: [], spread_bps: 5, resolution: 'RESOLVED_BY_TOLERANCE', resolved_by: 'TOLERANCE' });

    expect(cl.byResolution('RESOLVED_BY_POLICY').length).toBe(1);
    expect(cl.byResolution('UNRESOLVED').length).toBe(1);
    expect(cl.count()).toBe(3);
  });

  it('persists across instances', () => {
    const a = new ConflictLog(TEST_DIR);
    a.record({ as_of_cutoff: '2025-01-01T00:00:00Z', policy_version: 'p1', stream_key: 'g', sources: [], spread_bps: 10, resolution: 'UNRESOLVED', resolved_by: 'REJECT' });
    const b = new ConflictLog(TEST_DIR);
    expect(b.count()).toBe(1);
  });
});