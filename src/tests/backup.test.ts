import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { BackupManager, InMemoryOffsite } from '../backup/backup-manager';

describe('§12 Backup & Recovery', () => {
  it('full + incremental chain', () => {
    const audit = new HashChainAuditLog();
    const off = new InMemoryOffsite();
    const mgr = new BackupManager(audit, { rpoMs: 60_000, rtoMs: 5_000, offsiteRequired: true }, off);
    const s1 = mgr.takeSnapshot('FULL', 'fp1', 'admin');
    const s2 = mgr.takeSnapshot('INCREMENTAL', 'fp2', 'admin');
    expect(s2.parentSnapshotId).toBe(s1.snapshotId);
    expect(off.list().length).toBe(2);
  });

  it('restore from offsite within RTO', () => {
    const audit = new HashChainAuditLog();
    const off = new InMemoryOffsite();
    const mgr = new BackupManager(audit, { rpoMs: 60_000, rtoMs: 5_000, offsiteRequired: true }, off);
    const s = mgr.takeSnapshot('FULL', 'fp-critical', 'admin');
    const r = mgr.testRestore(s.snapshotId, 'admin');
    expect(r.ok).toBe(true);
    expect(r.withinRto).toBe(true);
    expect(r.integrityOk).toBe(true);
    expect(off.load(s.snapshotId)?.payload).toBe('fp-critical');
  });

  it('rejects restore of unknown snapshot', () => {
    const mgr = new BackupManager(new HashChainAuditLog(),
      { rpoMs: 1000, rtoMs: 1000, offsiteRequired: true }, new InMemoryOffsite());
    expect(() => mgr.testRestore('nonexistent', 'admin')).toThrow();
  });
});