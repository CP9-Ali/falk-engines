import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

export interface ReplayOptions {
  readonly source_id?: string;
  readonly timeframe?: string;
  readonly from_utc?: string;
  readonly to_utc?: string;
  readonly limit?: number;
}

export interface ReplayRecord {
  readonly lineage_id: string;
  readonly source_id: string;
  readonly timeframe: string;
  readonly event_time_utc: string;
  readonly payload_hash: string;
  readonly payload: unknown;
}

export class ReplayEngine {
  constructor(private readonly rawDir = '.backup/raw') {}

  listAvailable(): { source: string; timeframe: string; count: number }[] {
    const out: { source: string; timeframe: string; count: number }[] = [];
    if (!existsSync(this.rawDir)) return out;
    for (const source of readdirSync(this.rawDir)) {
      const sourcePath = join(this.rawDir, source);
      try {
        for (const tf of readdirSync(sourcePath)) {
          const tfPath = join(sourcePath, tf);
          try {
            const files = readdirSync(tfPath).filter(f => f.endsWith('.json'));
            out.push({ source, timeframe: tf, count: files.length });
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
    return out;
  }

  load(opts: ReplayOptions = {}): ReplayRecord[] {
    const all: ReplayRecord[] = [];
    if (!existsSync(this.rawDir)) return all;

    const sources = opts.source_id ? [opts.source_id] : readdirSync(this.rawDir);
    for (const source of sources) {
      const sourcePath = join(this.rawDir, source);
      if (!existsSync(sourcePath)) continue;

      const tfs = opts.timeframe ? [opts.timeframe] : readdirSync(sourcePath);
      for (const tf of tfs) {
        const tfPath = join(sourcePath, tf);
        if (!existsSync(tfPath)) continue;
        const files = readdirSync(tfPath).filter(f => f.endsWith('.json'));

        for (const file of files) {
          try {
            const raw = JSON.parse(readFileSync(join(tfPath, file), 'utf-8'));
            const ev = raw.event_time_utc as string;
            if (opts.from_utc && new Date(ev).getTime() < new Date(opts.from_utc).getTime()) continue;
            if (opts.to_utc && new Date(ev).getTime() > new Date(opts.to_utc).getTime()) continue;
            all.push({
              lineage_id: raw.lineage_id,
              source_id: raw.source_id,
              timeframe: raw.timeframe,
              event_time_utc: ev,
              payload_hash: raw.payload_hash,
              payload: raw.payload,
            });
          } catch { /* skip */ }
        }
      }
    }

    all.sort((a, b) => new Date(a.event_time_utc).getTime() - new Date(b.event_time_utc).getTime());
    if (opts.limit) return all.slice(0, opts.limit);
    return all;
  }

  toCandle(rec: ReplayRecord): RawDataPoint<Candle> | null {
    const p = rec.payload as any;
    if (!p) return null;

    if (p.datetime && p.open && p.close) {
      const t = new Date(String(p.datetime).replace(' ', 'T') + 'Z').getTime();
      return {
        sourceId: rec.source_id,
        value: {
          open: parseFloat(p.open), high: parseFloat(p.high),
          low: parseFloat(p.low), close: parseFloat(p.close),
          volume: 0,
        },
        eventTime: new Date(t).toISOString(),
        closedAt: new Date(t + 60_000).toISOString(),
        arrivalTime: new Date().toISOString(),
        availabilityTime: new Date(t + 60_000).toISOString(),
        version: 1,
        fingerprint: rec.lineage_id,
      };
    }

    if (p.o !== undefined && p.c !== undefined) {
      const t = Number(p.t);
      return {
        sourceId: rec.source_id,
        value: {
          open: parseFloat(p.o), high: parseFloat(p.h),
          low: parseFloat(p.l), close: parseFloat(p.c),
          volume: parseFloat(p.v),
        },
        eventTime: new Date(t).toISOString(),
        closedAt: new Date(t + 60_000).toISOString(),
        arrivalTime: new Date().toISOString(),
        availabilityTime: new Date(t + 60_000).toISOString(),
        version: 1,
        fingerprint: rec.lineage_id,
      };
    }

    return null;
  }
}