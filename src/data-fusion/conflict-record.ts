import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Timestamp } from '../core/types';

/**
 * §12: ConflictRecord artifact مستقل.
 * سابقاً كان يُسجَّل في AuditLog فقط — الآن artifact مستقل قابل للاستعلام.
 */

export interface ConflictRecord {
  readonly conflict_id: string;
  readonly as_of_cutoff: Timestamp;
  readonly policy_version: string;
  readonly stream_key: string;
  readonly sources: ReadonlyArray<{
    readonly source_id: string;
    readonly close: number;
    readonly weight: number;
  }>;
  readonly spread_bps: number;
  readonly resolution: 'RESOLVED_BY_TOLERANCE' | 'RESOLVED_BY_POLICY' | 'UNRESOLVED';
  readonly resolved_by: string;
  readonly created_at_utc: string;
}

export class ConflictLog {
  private readonly dir: string;
  private readonly path: string;

  constructor(baseDir = '.backup/conflicts') {
    this.dir = baseDir;
    mkdirSync(this.dir, { recursive: true });
    this.path = join(this.dir, 'conflicts.jsonl');
  }

  record(rec: Omit<ConflictRecord, 'conflict_id' | 'created_at_utc'>): ConflictRecord {
    const full: ConflictRecord = {
      conflict_id: 'conf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      created_at_utc: new Date().toISOString(),
      ...rec,
    };
    appendFileSync(this.path, JSON.stringify(full) + '\n', 'utf-8');
    return full;
  }

  list(): ConflictRecord[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, 'utf-8').split('\n').filter(l => l.trim().length > 0);
    const out: ConflictRecord[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return out;
  }

  count(): number { return this.list().length; }

  byResolution(resolution: ConflictRecord['resolution']): ConflictRecord[] {
    return this.list().filter(c => c.resolution === resolution);
  }
}