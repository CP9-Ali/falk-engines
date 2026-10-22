import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, chmodSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AuditLog } from '../audit/audit-log';
import { newId } from '../core/ids';
import { now } from '../core/time';
import { FalkError } from '../core/errors';

export type SnapshotKind = 'FULL' | 'INCREMENTAL';

export interface Snapshot {
  readonly snapshotId: string;
  readonly kind: SnapshotKind;
  readonly parentSnapshotId?: string;
  readonly createdAt: string;
  readonly payload: string;
  readonly payloadHash: string;
}

export interface OffsiteSink {
  store(s: Snapshot): void;
  load(snapshotId: string): Snapshot | null;
  list(): ReadonlyArray<string>;
}

export interface BackupPolicy {
  readonly rpoMs: number;
  readonly rtoMs: number;
  readonly offsiteRequired: boolean;
}

export interface RestoreResult {
  readonly ok: boolean;
  readonly rtoActualMs: number;
  readonly withinRto: boolean;
  readonly integrityOk: boolean;
}

const V = {
  schemaVersion: '1.0',
  policyVersion: 'backup-v1',
  configVersion: '1.0',
  engineVersion: '1.0',
} as const;

const hashPayload = (p: string): string =>
  createHash('sha256').update(p).digest('hex');

// ───────────────────────────────────────────────────────
// InMemoryOffsite — للاختبارات
// ───────────────────────────────────────────────────────
export class InMemoryOffsite implements OffsiteSink {
  readonly store_ = new Map<string, Snapshot>();
  store(s: Snapshot): void {
    this.store_.set(s.snapshotId, s);
  }
  load(snapshotId: string): Snapshot | null {
    return this.store_.get(snapshotId) ?? null;
  }
  list(): ReadonlyArray<string> {
    return [...this.store_.keys()];
  }
}

// ───────────────────────────────────────────────────────
// LocalFileOffsite — WORM محلي داخل المشروع
// ───────────────────────────────────────────────────────
export class LocalFileOffsite implements OffsiteSink {
  private readonly snapshotsDir: string;
  private readonly indexPath: string;

  constructor(baseDir = '.backup') {
    this.snapshotsDir = join(baseDir, 'snapshots');
    this.indexPath = join(baseDir, 'index.jsonl');
    mkdirSync(this.snapshotsDir, { recursive: true });
  }

  store(s: Snapshot): void {
    const filePath = join(this.snapshotsDir, `${s.snapshotId}.json`);
    if (existsSync(filePath)) {
      throw new FalkError(
        `Snapshot ${s.snapshotId} already exists (WORM)`,
        'SNAPSHOT_EXISTS',
      );
    }

    const body = JSON.stringify(s, null, 2);
    writeFileSync(filePath, body, { encoding: 'utf-8' });

    try {
      chmodSync(filePath, 0o444);
    } catch {
      // Windows قد يرفض chmod — نتجاهل
    }

    const idxLine = JSON.stringify({
      snapshotId: s.snapshotId,
      kind: s.kind,
      createdAt: s.createdAt,
      payloadHash: s.payloadHash,
    }) + '\n';
    appendFileSync(this.indexPath, idxLine, 'utf-8');
  }

  load(snapshotId: string): Snapshot | null {
    const filePath = join(this.snapshotsDir, `${snapshotId}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8')) as Snapshot;
    } catch {
      return null;
    }
  }

  list(): ReadonlyArray<string> {
    if (!existsSync(this.snapshotsDir)) return [];
    return readdirSync(this.snapshotsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  verifyIntegrity(snapshotId: string): boolean {
    const s = this.load(snapshotId);
    if (!s) return false;
    return hashPayload(s.payload) === s.payloadHash;
  }

  count(): number {
    return this.list().length;
  }
}

// ───────────────────────────────────────────────────────
// BackupManager
// ───────────────────────────────────────────────────────
export class BackupManager {
  private snapshots: Snapshot[] = [];
  private lastVerifiedAt?: string;

  constructor(
    private readonly audit: AuditLog,
    readonly policy: BackupPolicy,
    private readonly offsite: OffsiteSink,
  ) {}

  takeSnapshot(kind: SnapshotKind, payload: string, actor: string): Snapshot {
    const parent = this.snapshots[this.snapshots.length - 1];
    const base = {
      snapshotId: newId('snap'),
      kind,
      payload,
      payloadHash: hashPayload(payload),
      createdAt: now(),
    };
    const s: Snapshot = Object.freeze(
      kind === 'INCREMENTAL' && parent
        ? { ...base, parentSnapshotId: parent.snapshotId }
        : base,
    ) as Snapshot;
    this.snapshots.push(s);
    if (this.policy.offsiteRequired) this.offsite.store(s);
    this.audit.append({
      eventType: 'BACKUP_TAKEN',
      engine: 'Backup',
      eventTime: s.createdAt,
      recordTime: now(),
      actor,
      refs: { snapshotId: s.snapshotId, payloadHash: s.payloadHash },
      versions: V,
      payload: { kind, parent: s.parentSnapshotId ?? null },
    });
    return s;
  }

  testRestore(snapshotId: string, actor: string): RestoreResult {
    const s = this.offsite.load(snapshotId);
    if (!s) {
      throw new FalkError(
        `Snapshot ${snapshotId} not found offsite`,
        'SNAPSHOT_NOT_FOUND',
      );
    }
    const start = Date.now();
    const integrityOk = hashPayload(s.payload) === s.payloadHash;
    const duration = Date.now() - start;
    this.lastVerifiedAt = now();
    const result: RestoreResult = {
      ok: integrityOk,
      rtoActualMs: duration,
      withinRto: duration <= this.policy.rtoMs,
      integrityOk,
    };
    this.audit.append({
      eventType: integrityOk ? 'RESTORE_TESTED' : 'RESTORE_INTEGRITY_FAILED',
      engine: 'Backup',
      eventTime: now(),
      recordTime: now(),
      actor,
      refs: { snapshotId },
      versions: V,
      payload: {
        rtoActualMs: duration,
        withinRto: result.withinRto,
        integrityOk,
      },
    });
    return result;
  }

  currentRpoGapMs(): number {
    if (this.snapshots.length < 2) return 0;
    const last = this.snapshots[this.snapshots.length - 1]!;
    const prev = this.snapshots[this.snapshots.length - 2]!;
    return new Date(last.createdAt).getTime() - new Date(prev.createdAt).getTime();
  }

  lastVerifiedRestore(): string | undefined {
    return this.lastVerifiedAt;
  }
}