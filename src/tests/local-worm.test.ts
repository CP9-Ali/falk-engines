import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, chmodSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { LocalWormOffsite } from '../backup/local-worm-offsite';
import { BackupManager } from '../backup/backup-manager';
import { HashChainAuditLog } from '../audit/audit-log';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('LocalWormOffsite (§12 WORM)', () => {
  let root: string;
  let sink: LocalWormOffsite;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'falk-worm-'));
    sink = new LocalWormOffsite({ rootDir: root, retentionDays: 30 });
  });

  afterEach(() => {
    try {
      const dir = join(root, 'snapshots');
      for (const f of readdirSync(dir)) chmodSync(join(dir, f), 0o644);
    } catch { /* ignore */ }
    rmSync(root, { recursive: true, force: true });
  });

  it('stores and retrieves snapshot', () => {
    const mgr = new BackupManager(
      new HashChainAuditLog(),
      { rpoMs: 60_000, rtoMs: 10_000, offsiteRequired: true },
      sink,
    );
    const s = mgr.takeSnapshot('FULL', 'hello world', 'test');
    const loaded = sink.load(s.snapshotId);
    expect(loaded).not.toBeNull();
    expect(loaded!.payload).toBe('hello world');
    expect(loaded!.payloadHash).toBe(s.payloadHash);
  });

  it('refuses to overwrite existing snapshot (WORM)', () => {
    const s = {
      snapshotId: 'snap-dup',
      kind: 'FULL' as const,
      payload: 'a',
      payloadHash: sha256('a'),
      createdAt: new Date().toISOString(),
    };
    sink.store(s);
    expect(() => sink.store(s)).toThrow(/WORM violation/);
  });

  it('detects payload tampering', () => {
    const payload = 'original-data';
    const s = {
      snapshotId: 'snap-tamper',
      kind: 'FULL' as const,
      payload,
      payloadHash: sha256(payload),
      createdAt: new Date().toISOString(),
    };
    sink.store(s);

    const filePath = join(root, 'snapshots', 'snap-tamper.json');
    chmodSync(filePath, 0o644);
    writeFileSync(filePath, 'tampered', 'utf-8');

    expect(() => sink.load('snap-tamper')).toThrow(/Integrity violation/);
    const report = sink.verifyAll();
    expect(report.ok).toBe(false);
    expect(report.violations.some(v => v.includes('hash mismatch'))).toBe(true);
  });

  it('detects deletion of snapshot file', () => {
    const payload = 'will-be-deleted';
    const s = {
      snapshotId: 'snap-delete',
      kind: 'FULL' as const,
      payload,
      payloadHash: sha256(payload),
      createdAt: new Date().toISOString(),
    };
    sink.store(s);

    chmodSync(join(root, 'snapshots', 'snap-delete.json'), 0o644);
    rmSync(join(root, 'snapshots', 'snap-delete.json'));

    const report = sink.verifyAll();
    expect(report.ok).toBe(false);
    expect(report.violations.some(v => v.includes('missing'))).toBe(true);
  });

  it('detects tampering with manifest', () => {
    const s = {
      snapshotId: 'snap-manifest',
      kind: 'FULL' as const,
      payload: 'data',
      payloadHash: sha256('data'),
      createdAt: new Date().toISOString(),
    };
    sink.store(s);

    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: 1, entries: [] }), 'utf-8');

    expect(() => sink.load('snap-manifest')).toThrow(/not in manifest/);
  });

  it('lists all snapshots', () => {
    sink.store({ snapshotId: 'a', kind: 'FULL', payload: 'x', payloadHash: sha256('x'), createdAt: '2025-01-01T00:00:00Z' });
    sink.store({ snapshotId: 'b', kind: 'FULL', payload: 'y', payloadHash: sha256('y'), createdAt: '2025-01-02T00:00:00Z' });
    const list = sink.list();
    expect(list).toContain('a');
    expect(list).toContain('b');
    expect(list.length).toBe(2);
  });

  it('returns null for unknown snapshot', () => {
    expect(sink.load('nonexistent')).toBeNull();
  });

  it('records lockedUntil in manifest', () => {
    const s = {
      snapshotId: 'snap-lock',
      kind: 'FULL' as const,
      payload: 'x',
      payloadHash: sha256('x'),
      createdAt: new Date().toISOString(),
    };
    sink.store(s);
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8'));
    expect(manifest.entries[0].lockedUntil).toBeDefined();
    expect(new Date(manifest.entries[0].lockedUntil).getTime()).toBeGreaterThan(Date.now());
  });
});