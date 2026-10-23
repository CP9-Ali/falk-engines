import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RawRecord {
  readonly source_id: string;
  readonly source_symbol: string;
  readonly timeframe: string;
  readonly event_time_utc: string;
  readonly fetch_method: 'history' | 'live-tick' | 'live-kline';
  readonly fetched_at_utc: string;
  readonly request_id?: string;
  readonly payload: unknown;
}

export interface RawRef {
  readonly lineage_id: string;
  readonly raw_path: string;
  readonly payload_hash: string;
}

export class RawStore {
  private readonly baseDir: string;

  constructor(baseDir = '.backup/raw') {
    this.baseDir = baseDir;
    mkdirSync(this.baseDir, { recursive: true });
  }

  save(rec: RawRecord): RawRef {
    const payloadStr = JSON.stringify(rec.payload);
    const payload_hash = createHash('sha256').update(payloadStr).digest('hex');
    const lineage_id = createHash('sha256')
      .update(rec.source_id + '|' + rec.source_symbol + '|' + rec.timeframe + '|' + rec.event_time_utc)
      .digest('hex')
      .slice(0, 24);

    const safeSource = rec.source_id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = join(this.baseDir, safeSource, rec.timeframe);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, lineage_id + '.json');

    if (!existsSync(path)) {
      writeFileSync(path, JSON.stringify({ ...rec, payload_hash, lineage_id }, null, 2), 'utf-8');
    }

    return { lineage_id, raw_path: path, payload_hash };
  }
}