import {
  readFileSync, writeFileSync, mkdirSync,
  accessSync, chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { OffsiteSink, Snapshot } from './backup-manager';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface LocalWormConfig {
  readonly rootDir: string;
  readonly retentionDays?: number;
}

interface ManifestEntry {
  readonly snapshotId: string;
  readonly payloadHash: string;
  readonly kind: 'FULL' | 'INCREMENTAL';
  readonly createdAt: string;
  readonly lockedUntil: string;
  readonly sizeBytes: number;
}

interface Manifest {
  readonly version: 1;
  readonly entries: ManifestEntry[];
}

export interface VerifyReport {
  readonly ok: boolean;
  readonly violations: ReadonlyArray<string>;
  readonly lockedCount: number;
  readonly totalCount: number;
}

export class LocalWormOffsite implements OffsiteSink {
  private readonly snapshotsDir: string;
  private readonly manifestPath: string;
  private readonly retentionDays: number;

  constructor(cfg: LocalWormConfig) {
    this.snapshotsDir = join(cfg.rootDir, 'snapshots');
    this.manifestPath = join(cfg.rootDir, 'manifest.json');
    this.retentionDays = cfg.retentionDays ?? 2555;
  }

  store(s: Snapshot): void {
    mkdirSync(this.snapshotsDir, { recursive: true });
    const filePath = join(this.snapshotsDir, `${s.snapshotId}.json`);

    try {
      accessSync(filePath);
      throw new Error(`WORM violation: snapshot ${s.snapshotId} already exists`);
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }

    writeFileSync(filePath, s.payload, 'utf-8');
    try { chmodSync(filePath, 0o444); } catch { /* Windows fallback */ }

    const manifest = this.readManifest();
    const lockedUntil = new Date();
    lockedUntil.setDate(lockedUntil.getDate() + this.retentionDays);

    const newEntry: ManifestEntry = {
      snapshotId: s.snapshotId,
      payloadHash: s.payloadHash,
      kind: s.kind,
      createdAt: s.createdAt,
      lockedUntil: lockedUntil.toISOString(),
      sizeBytes: Buffer.byteLength(s.payload, 'utf-8'),
    };

    const entries = manifest.entries.filter(e => e.snapshotId !== s.snapshotId);
    entries.push(newEntry);
    this.writeManifest({ version: 1, entries });
  }

  load(snapshotId: string): Snapshot | null {
    const filePath = join(this.snapshotsDir, `${snapshotId}.json`);
    let payload: string;
    try {
      payload = readFileSync(filePath, 'utf-8');
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }

    const manifest = this.readManifest();
    const entry = manifest.entries.find(e => e.snapshotId === snapshotId);
    if (!entry) {
      throw new Error(`Snapshot ${snapshotId} exists but not in manifest — possible tampering`);
    }
    if (sha256(payload) !== entry.payloadHash) {
      throw new Error(`Integrity violation for ${snapshotId}: payload hash mismatch`);
    }

    return {
      snapshotId,
      kind: entry.kind,
      payload,
      payloadHash: entry.payloadHash,
      createdAt: entry.createdAt,
    };
  }

  list(): ReadonlyArray<string> {
    return this.readManifest().entries.map(e => e.snapshotId);
  }

  verifyAll(): VerifyReport {
    const manifest = this.readManifest();
    const violations: string[] = [];
    let lockedCount = 0;
    const now = new Date();

    for (const entry of manifest.entries) {
      if (new Date(entry.lockedUntil) > now) lockedCount++;
      const filePath = join(this.snapshotsDir, `${entry.snapshotId}.json`);
      try {
        const payload = readFileSync(filePath, 'utf-8');
        if (sha256(payload) !== entry.payloadHash) {
          violations.push(`${entry.snapshotId}: hash mismatch (tampered)`);
        }
      } catch (e: any) {
        if (e.code === 'ENOENT') {
          violations.push(`${entry.snapshotId}: file missing (locked until ${entry.lockedUntil})`);
        } else {
          violations.push(`${entry.snapshotId}: ${e.message}`);
        }
      }
    }

    return {
      ok: violations.length === 0,
      violations,
      lockedCount,
      totalCount: manifest.entries.length,
    };
  }

  private readManifest(): Manifest {
    try {
      return JSON.parse(readFileSync(this.manifestPath, 'utf-8')) as Manifest;
    } catch (e: any) {
      if (e.code === 'ENOENT') return { version: 1, entries: [] };
      throw e;
    }
  }

  private writeManifest(m: Manifest): void {
    writeFileSync(this.manifestPath, JSON.stringify(m, null, 2), 'utf-8');
  }
}