import 'dotenv/config';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

/**
 * TwelveData XAU/USD poller — يجلب سعر الذهب العالمي كل 8 ثوانٍ.
 * Free tier: 8 requests/min, 800/day.
 */
export class TwelveDataXauPoller {
  private lastCandleStart = 0;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly apiKey: string,
    private readonly onCandle: (point: RawDataPoint<Candle>) => void,
    private readonly pollMs = 8000,
  ) {}

  start(): void {
    console.log('[XAU] TwelveData poller started (8s interval)');
    this.tick();
    this.timer = setInterval(() => this.tick(), this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      const url =
        'https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1min&outputsize=2&apikey=' +
        encodeURIComponent(this.apiKey);

      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as any;
      if (!data.values || data.values.length === 0) return;

      for (const v of data.values) {
        const candleStart = new Date(v.datetime + 'Z').getTime();
        if (candleStart <= this.lastCandleStart) continue;
        this.lastCandleStart = candleStart;

        const o = parseFloat(v.open), h = parseFloat(v.high);
        const l = parseFloat(v.low), c = parseFloat(v.close);
        if (!Number.isFinite(o) || !Number.isFinite(c)) continue;

        const point: RawDataPoint<Candle> = {
          sourceId: 'twelvedata-xau',
          value: { open: o, high: h, low: l, close: c, volume: 0 },
          eventTime: new Date(candleStart).toISOString(),
          closedAt: new Date(candleStart + 60_000).toISOString(),
          arrivalTime: new Date().toISOString(),
          availabilityTime: new Date(candleStart + 60_000).toISOString(),
          version: 1,
          fingerprint: 'xau-' + candleStart,
        };
        this.onCandle(point);
      }
    } catch (err) {
      console.warn('[XAU] Poll failed:', (err as Error).message);
    }
  }
}
