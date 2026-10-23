import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

/**
 * عند بدء عملية جديدة: historiesByTf يبدأ فارغاً.
 * لكن raw files موجودة على القرص.
 * هذه الوحدة تعيد بناء historiesByTf من raw files.
 *
 * النتيجة: Checkpoint يحفظ API calls، HistoryRestorer يحفظ In-Memory State.
 */
export class HistoryRestorer {
  constructor(private readonly rawDir = '.backup/raw') {}

  /** يقرأ كل الـ raw snapshots لفريم معين ويرجع أحدث maxBars */
  restore(sourceId: string, timeframe: string, maxBars = 200): RawDataPoint<Candle>[] {
    const dir = join(this.rawDir, sourceId, timeframe);
    if (!existsSync(dir)) return [];

    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    const points: RawDataPoint<Candle>[] = [];

    for (const file of files) {
      try {
        const raw = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
        const p = this.toCandle(raw, sourceId);
        if (p) points.push(p);
      } catch {
        // skip corrupt
      }
    }

    // رتب زمنياً، احتفظ بأحدث maxBars
    points.sort((a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());
    if (points.length > maxBars) {
      return points.slice(-maxBars);
    }
    return points;
  }

  private toCandle(raw: any, sourceId: string): RawDataPoint<Candle> | null {
    if (!raw.payload) return null;
    const p = raw.payload;

    // TwelveData format
    if (p.datetime && p.open && p.close) {
      const t = new Date(String(p.datetime).replace(' ', 'T') + 'Z').getTime();
      if (!Number.isFinite(t)) return null;
      const o = parseFloat(p.open), h = parseFloat(p.high), l = parseFloat(p.low), c = parseFloat(p.close);
      if (!Number.isFinite(o) || !Number.isFinite(c)) return null;
      return {
        sourceId,
        value: { open: o, high: h, low: l, close: c, volume: 0 },
        eventTime: new Date(t).toISOString(),
        closedAt: new Date(t + 60_000).toISOString(),
        arrivalTime: new Date().toISOString(),
        availabilityTime: new Date(t + 60_000).toISOString(),
        version: 1,
        fingerprint: raw.lineage_id || ('restored-' + t),
      };
    }

    // Binance kline format
    if (p.o !== undefined && p.c !== undefined) {
      const t = Number(p.t);
      if (!Number.isFinite(t)) return null;
      return {
        sourceId,
        value: {
          open: parseFloat(p.o), high: parseFloat(p.h),
          low: parseFloat(p.l), close: parseFloat(p.c),
          volume: parseFloat(p.v || '0'),
        },
        eventTime: new Date(t).toISOString(),
        closedAt: new Date(t + 60_000).toISOString(),
        arrivalTime: new Date().toISOString(),
        availabilityTime: new Date(t + 60_000).toISOString(),
        version: 1,
        fingerprint: raw.lineage_id || ('restored-' + t),
      };
    }

    return null;
  }
}