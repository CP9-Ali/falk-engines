import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const H3_MS = 3 * 60 * 60 * 1000;

/**
 * §10: يبني H3 من 3 شموع 1h متتالية.
 * لا يُصدر H3 إلا عند اكتمال 3 شموع (الشمعة الناقصة لا تُستخدم).
 * Boundaries: 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 UTC.
 */
export class H3Aggregator {
  private buffer = new Map<number, RawDataPoint<Candle>[]>();

  /** يضيف شمعة 1h. يعيد H3 إن اكتمل الـ bucket. */
  add(h1: RawDataPoint<Candle>): RawDataPoint<Candle> | null {
    const t = new Date(h1.eventTime).getTime();
    if (!Number.isFinite(t)) return null;
    const bucketStart = Math.floor(t / H3_MS) * H3_MS;
    const buf = this.buffer.get(bucketStart) || [];
    buf.push(h1);
    this.buffer.set(bucketStart, buf);

    if (buf.length < 3) return null;

    const sorted = [...buf].sort((a, b) =>
      new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());

    // نتأكد أن الشموع متتالية (لا فجوة ساعة)
    for (let i = 1; i < sorted.length; i++) {
      const gap = new Date(sorted[i]!.eventTime).getTime() - new Date(sorted[i - 1]!.eventTime).getTime();
      if (gap !== 60 * 60 * 1000) {
        // فجوة — نمسح الـ bucket ونعيد البناء
        this.buffer.delete(bucketStart);
        return null;
      }
    }

    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const h3: RawDataPoint<Candle> = {
      sourceId: 'h3-aggregated',
      value: {
        open: first.value.open,
        high: Math.max(...sorted.map(x => x.value.high)),
        low: Math.min(...sorted.map(x => x.value.low)),
        close: last.value.close,
        volume: sorted.reduce((s, x) => s + x.value.volume, 0),
      },
      eventTime: new Date(bucketStart).toISOString(),
      closedAt: new Date(bucketStart + H3_MS).toISOString(),
      arrivalTime: new Date().toISOString(),
      availabilityTime: new Date(bucketStart + H3_MS).toISOString(),
      version: 1,
      fingerprint: 'h3-' + bucketStart,
    };

    this.buffer.delete(bucketStart);
    return h3;
  }

  /** يستعيد H3 التاريخية من كل 1h (كاملة فقط). */
  restoreFromHistory(h1Candles: ReadonlyArray<RawDataPoint<Candle>>): RawDataPoint<Candle>[] {
    const buckets = new Map<number, RawDataPoint<Candle>[]>();
    for (const c of h1Candles) {
      const t = new Date(c.eventTime).getTime();
      if (!Number.isFinite(t)) continue;
      const key = Math.floor(t / H3_MS) * H3_MS;
      const arr = buckets.get(key) || [];
      arr.push(c);
      buckets.set(key, arr);
    }

    const out: RawDataPoint<Candle>[] = [];
    for (const [bucketStart, arr] of buckets.entries()) {
      if (arr.length !== 3) continue;
      const sorted = [...arr].sort((a, b) =>
        new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());

      // التحقق من التسلسل
      let consecutive = true;
      for (let i = 1; i < 3; i++) {
        const gap = new Date(sorted[i]!.eventTime).getTime() - new Date(sorted[i - 1]!.eventTime).getTime();
        if (gap !== 60 * 60 * 1000) { consecutive = false; break; }
      }
      if (!consecutive) continue;

      const first = sorted[0]!;
      const last = sorted[2]!;
      out.push({
        sourceId: 'h3-aggregated',
        value: {
          open: first.value.open,
          high: Math.max(first.value.high, sorted[1]!.value.high, last.value.high),
          low: Math.min(first.value.low, sorted[1]!.value.low, last.value.low),
          close: last.value.close,
          volume: first.value.volume + sorted[1]!.value.volume + last.value.volume,
        },
        eventTime: new Date(bucketStart).toISOString(),
        closedAt: new Date(bucketStart + H3_MS).toISOString(),
        arrivalTime: new Date().toISOString(),
        availabilityTime: new Date(bucketStart + H3_MS).toISOString(),
        version: 1,
        fingerprint: 'h3-' + bucketStart,
      });
    }
    return out.sort((a, b) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());
  }
}