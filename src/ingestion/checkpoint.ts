import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Checkpoint {
  readonly source_id: string;
  readonly timeframe: string;
  readonly last_event_time_utc: string;
  readonly last_payload_hash: string;
  readonly updated_at_utc: string;
}

export class CheckpointManager {
  private readonly dir: string;

  constructor(baseDir = '.backup/checkpoints') {
    this.dir = baseDir;
    mkdirSync(this.dir, { recursive: true });
  }

  private path(sourceId: string, timeframe: string): string {
    const safe = sourceId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.dir, safe + '-' + timeframe + '.json');
  }

  get(sourceId: string, timeframe: string): Checkpoint | null {
    const p = this.path(sourceId, timeframe);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as Checkpoint;
    } catch {
      return null;
    }
  }

  /** §5: لا يتقدم قبل نجاح الحفظ */
  update(sourceId: string, timeframe: string, eventTimeUtc: string, payloadHash: string): void {
    const existing = this.get(sourceId, timeframe);
    if (existing && new Date(eventTimeUtc).getTime() <= new Date(existing.last_event_time_utc).getTime()) {
      return;
    }
    const cp: Checkpoint = {
      source_id: sourceId,
      timeframe,
      last_event_time_utc: eventTimeUtc,
      last_payload_hash: payloadHash,
      updated_at_utc: new Date().toISOString(),
    };
    writeFileSync(this.path(sourceId, timeframe), JSON.stringify(cp, null, 2), 'utf-8');
  }
}