import 'dotenv/config';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

interface Bar {
  start: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export class TwelveDataXauPoller {
  private timer?: NodeJS.Timeout;
  private started = false;
  private lastTickPrice: number | null = null;
  private currentBar: Bar | null = null;
  private lastTickLogAt = 0;
  private lastErrorLogAt = 0;
  private lastEmittedBarStart = 0;

  constructor(
    private readonly apiKey: string,
    private readonly onCandle: (point: RawDataPoint<Candle>, isHistory: boolean) => void,
    private readonly onTick: (price: number, ts: string) => void,
    private readonly pollMs = 12000,
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      console.warn('[XAU] Poller already started (duplicate start prevented)');
      return;
    }
    this.started = true;
    await this.loadHistory();
    console.log('[XAU] Poller started (' + (this.pollMs / 1000) + 's)');
    this.tick();
    this.timer = setInterval(() => this.tick(), this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.started = false;
  }

  private async loadHistory(): Promise<void> {
    try {
      console.log('[XAU] Loading 100 historical bars...');
      const url = 'https://api.twelvedata.com/time_series?symbol=' +
        encodeURIComponent('XAU/USD') +
        '&interval=1min&outputsize=20&timezone=UTC&apikey=' +
        encodeURIComponent(this.apiKey);
      const res = await fetch(url);
      const data = (await res.json()) as any;
      if (data.status === 'error') {
        this.logError('History: ' + (data.message || 'API error'));
        return;
      }
      if (!data.values || !Array.isArray(data.values)) return;

      let count = 0;
      const values = [...data.values].reverse();
      const now = Date.now();

      for (const v of values) {
        const dt = String(v.datetime).replace(' ', 'T') + 'Z';
        const barStart = new Date(dt).getTime();
        if (!Number.isFinite(barStart)) continue;
        if (barStart + 60_000 > now) continue;
        if (barStart <= this.lastEmittedBarStart) continue;

        const o = parseFloat(v.open);
        const h = parseFloat(v.high);
        const l = parseFloat(v.low);
        const c = parseFloat(v.close);
        if (!Number.isFinite(o) || !Number.isFinite(c)) continue;

        this.lastEmittedBarStart = barStart;
        const point: RawDataPoint<Candle> = {
          sourceId: 'twelvedata-xau',
          value: { open: o, high: h, low: l, close: c, volume: 0 },
          eventTime: new Date(barStart).toISOString(),
          closedAt: new Date(barStart + 60_000 + 1).toISOString(),
          arrivalTime: new Date().toISOString(),
          availabilityTime: new Date(barStart + 60_000 + 1).toISOString(),
          version: 1,
          fingerprint: 'xau-' + barStart,
        };
        this.onCandle(point, true);
        count++;
      }

      console.log('[XAU] Loaded ' + count + ' historical bars');
    } catch (err) {
      this.logError('History: ' + (err as Error).message);
    }
  }

  private async tick(): Promise<void> {
    try {
      const url = 'https://api.twelvedata.com/time_series?symbol=' +
        encodeURIComponent('XAU/USD') +
        '&interval=1min&outputsize=2&timezone=UTC&apikey=' +
        encodeURIComponent(this.apiKey);

      const res = await fetch(url);
      if (!res.ok) { this.logError('HTTP ' + res.status); return; }
      const data = (await res.json()) as any;
      if (data.status === 'error') { this.logError(data.message || 'API error'); return; }
      if (!data.values || data.values.length === 0) return;

      const currentPrice = parseFloat(data.values[0].close);
      if (!Number.isFinite(currentPrice)) return;

      const now = Date.now();
      const currentMinuteStart = Math.floor(now / 60_000) * 60_000;

      if (this.currentBar && currentMinuteStart > this.currentBar.start) {
        this.emitClosedBar(this.currentBar);
        this.currentBar = {
          start: currentMinuteStart,
          open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice,
        };
      } else if (this.currentBar) {
        this.currentBar.high = Math.max(this.currentBar.high, currentPrice);
        this.currentBar.low = Math.min(this.currentBar.low, currentPrice);
        this.currentBar.close = currentPrice;
      } else {
        this.currentBar = {
          start: currentMinuteStart,
          open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice,
        };
      }

      if (this.lastTickPrice === null || currentPrice !== this.lastTickPrice) {
        this.lastTickPrice = currentPrice;
        this.onTick(currentPrice, new Date().toISOString());
        if (now - this.lastTickLogAt > 30_000) {
          this.lastTickLogAt = now;
          console.log('[XAU-TICK] ' + currentPrice.toFixed(2));
        }
      }
    } catch (err) {
      this.logError((err as Error).message);
    }
  }

  private emitClosedBar(bar: Bar): void {
    if (bar.start <= this.lastEmittedBarStart) return;
    this.lastEmittedBarStart = bar.start;
    const point: RawDataPoint<Candle> = {
      sourceId: 'twelvedata-xau',
      value: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 },
      eventTime: new Date(bar.start).toISOString(),
      closedAt: new Date(bar.start + 60_000 + 1).toISOString(),
      arrivalTime: new Date().toISOString(),
      availabilityTime: new Date(bar.start + 60_000 + 1).toISOString(),
      version: 1,
      fingerprint: 'xau-' + bar.start,
    };
    this.onCandle(point, false);
  }

  private logError(msg: string): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt > 30_000) {
      this.lastErrorLogAt = now;
      console.warn('[XAU] Poll failed: ' + msg);
    }
  }
}