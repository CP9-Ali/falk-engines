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

export interface FcsapiConfig {
  apiKey: string;
  base: string;
  symbol: string;
  pollMs?: number;
}

export class FcsapiXauPoller {
  private timer?: NodeJS.Timeout;
  private started = false;
  private lastTickPrice: number | null = null;
  private currentBar: Bar | null = null;
  private lastTickLogAt = 0;
  private lastErrorLogAt = 0;
  private lastEmittedBarStart = 0;
  private apiKey: string;
  private base: string;
  private symbol: string;
  private pollMs: number;

  constructor(
    cfg: FcsapiConfig,
    private readonly onCandle: (point: RawDataPoint<Candle>, isHistory: boolean) => void,
    private readonly onTick: (price: number, ts: string) => void,
  ) {
    this.apiKey = cfg.apiKey;
    this.base = (cfg.base || 'https://api-v4.fcsapi.com').replace(/\/$/, '');
    this.symbol = cfg.symbol || 'FX:XAUUSD';
    this.pollMs = cfg.pollMs || 10000;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.loadHistory();
    console.log('[XAU-FCS] Poller started (' + (this.pollMs / 1000) + 's)');
    this.tick();
    this.timer = setInterval(() => this.tick(), this.pollMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.started = false;
  }

  private async loadHistory(): Promise<void> {
    try {
      console.log('[XAU-FCS] Loading 100 historical bars...');
      // FCSAPI history endpoint
      const url = this.base + '/forex/history?symbol=' + encodeURIComponent(this.symbol) +
        '&period=1m&limit=100&access_key=' + encodeURIComponent(this.apiKey);
      const res = await fetch(url);
      const data = (await res.json()) as any;

      // FCSAPI response format: { status: true, response: [{...}] } or { status: false }
      let values: any[] | null = null;
      if (data.status === true && Array.isArray(data.response)) values = data.response;
      else if (Array.isArray(data.response)) values = data.response;
      else if (Array.isArray(data.data)) values = data.data;

      if (!values || values.length === 0) {
        this.logError('History: empty response (verify FCSAPI endpoint)');
        return;
      }

      let count = 0;
      const now = Date.now();
      const sorted = [...values].sort((a, b) => Number(a.t || a.time || a.timestamp || 0) - Number(b.t || b.time || b.timestamp || 0));

      for (const v of sorted) {
        const rawTs = v.t || v.time || v.timestamp || v.date;
        let barStart: number;
        if (typeof rawTs === 'string' && rawTs.indexOf('-') > 0) {
          barStart = new Date(rawTs.replace(' ', 'T') + 'Z').getTime();
        } else {
          const n = Number(rawTs);
          barStart = n > 1e12 ? n : n * 1000;
        }
        if (!Number.isFinite(barStart)) continue;
        if (barStart + 60_000 > now) continue;
        if (barStart <= this.lastEmittedBarStart) continue;

        const o = parseFloat(v.o || v.open || v['1'] || '');
        const h = parseFloat(v.h || v.high || v['2'] || '');
        const l = parseFloat(v.l || v.low || v['3'] || '');
        const c = parseFloat(v.c || v.close || v.price || v['4'] || '');
        if (!Number.isFinite(o) || !Number.isFinite(c)) continue;

        this.lastEmittedBarStart = barStart;
        const point: RawDataPoint<Candle> = {
          sourceId: 'fcsapi-xau',
          value: { open: o, high: h || Math.max(o, c), low: l || Math.min(o, c), close: c, volume: 0 },
          eventTime: new Date(barStart).toISOString(),
          closedAt: new Date(barStart + 60_001).toISOString(),
          arrivalTime: new Date().toISOString(),
          availabilityTime: new Date(barStart + 60_001).toISOString(),
          version: 1,
          fingerprint: 'fcs-' + barStart,
        };
        this.onCandle(point, true);
        count++;
      }

      console.log('[XAU-FCS] Loaded ' + count + ' historical bars');
    } catch (err) {
      this.logError('History: ' + (err as Error).message);
    }
  }

  private async tick(): Promise<void> {
    try {
      const url = this.base + '/forex/latest?symbol=' + encodeURIComponent(this.symbol) +
        '&access_key=' + encodeURIComponent(this.apiKey);
      const res = await fetch(url);
      const data = (await res.json()) as any;

      let price: number | null = null;
      if (data.status === true && data.response) {
        const r = Array.isArray(data.response) ? data.response[0] : data.response;
        price = parseFloat(r?.price || r?.c || r?.close || r?.bid || '');
      } else if (data.price) {
        price = parseFloat(data.price);
      }

      if (!price || !Number.isFinite(price)) return;

      const now = Date.now();
      const currentMinuteStart = Math.floor(now / 60_000) * 60_000;

      if (this.currentBar && currentMinuteStart > this.currentBar.start) {
        this.emitClosedBar(this.currentBar);
        this.currentBar = { start: currentMinuteStart, open: price, high: price, low: price, close: price };
      } else if (this.currentBar) {
        this.currentBar.high = Math.max(this.currentBar.high, price);
        this.currentBar.low = Math.min(this.currentBar.low, price);
        this.currentBar.close = price;
      } else {
        this.currentBar = { start: currentMinuteStart, open: price, high: price, low: price, close: price };
      }

      if (this.lastTickPrice === null || price !== this.lastTickPrice) {
        this.lastTickPrice = price;
        this.onTick(price, new Date().toISOString());
        if (now - this.lastTickLogAt > 30_000) {
          this.lastTickLogAt = now;
          console.log('[XAU-FCS-TICK] ' + price.toFixed(2));
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
      sourceId: 'fcsapi-xau',
      value: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 },
      eventTime: new Date(bar.start).toISOString(),
      closedAt: new Date(bar.start + 60_001).toISOString(),
      arrivalTime: new Date().toISOString(),
      availabilityTime: new Date(bar.start + 60_001).toISOString(),
      version: 1,
      fingerprint: 'fcs-' + bar.start,
    };
    this.onCandle(point, false);
  }

  private logError(msg: string): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt > 30_000) {
      this.lastErrorLogAt = now;
      console.warn('[XAU-FCS] ' + msg);
    }
  }
}