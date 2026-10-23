import 'dotenv/config';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

interface Bar { start: number; open: number; high: number; low: number; close: number; }

export class XausApiSource {
  readonly name = 'xaus-api';
  private timer?: NodeJS.Timeout;
  private started = false;
  private lastTickAt = 0;
  private lastTickPrice: number | null = null;
  private currentBar: Bar | null = null;
  private lastEmittedBarStart = 0;
  private lastErrAt = 0;

  constructor(
    private readonly onCandle: (p: RawDataPoint<Candle>, isHistory: boolean) => void,
    private readonly onTick: (price: number, ts: string) => void,
    private readonly onHealthChange: (healthy: boolean) => void,
    private readonly pollMs = 10000,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    console.log('[XAUS] Poller started (' + (this.pollMs / 1000) + 's)');
    this.poll();
    this.timer = setInterval(() => this.poll(), this.pollMs);
  }

  stop(): void {
    this.started = false;
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  isHealthy(now = Date.now()): boolean {
    return this.lastTickAt > 0 && (now - this.lastTickAt) < 30000;
  }

  private async poll(): Promise<void> {
    try {
      const res = await fetch('https://xaus.com/api/v1/spot?compact=1', {
        headers: { 'User-Agent': 'falk-engines/1.0' },
      });
      if (!res.ok) { this.logErr('HTTP ' + res.status); return; }
      const data = (await res.json()) as any;
      if (data?.data_state?.status !== 'fresh') {
        this.onHealthChange(false);
        this.logErr('state=' + (data?.data_state?.status || 'unknown'));
        return;
      }
      const price = Number(data?.xau?.price ?? data?.spot_usd_oz);
      if (!Number.isFinite(price)) return;
      const ts = data.updated_at || new Date().toISOString();
      this.handleTick(price, new Date(ts).getTime());
    } catch (e) {
      this.logErr((e as Error).message);
      this.onHealthChange(false);
    }
  }

  private handleTick(price: number, tsMs: number): void {
    if (!Number.isFinite(price)) return;
    this.lastTickAt = Date.now();
    this.lastTickPrice = price;
    this.onHealthChange(true);
    this.onTick(price, new Date(tsMs).toISOString());
    const now = Date.now();
    const m = Math.floor(now / 60000) * 60000;
    if (this.currentBar && m > this.currentBar.start) {
      this.emitClosedBar(this.currentBar);
      this.currentBar = { start: m, open: price, high: price, low: price, close: price };
    } else if (this.currentBar) {
      this.currentBar.high = Math.max(this.currentBar.high, price);
      this.currentBar.low = Math.min(this.currentBar.low, price);
      this.currentBar.close = price;
    } else {
      this.currentBar = { start: m, open: price, high: price, low: price, close: price };
    }
  }

  private emitClosedBar(bar: Bar): void {
    if (bar.start <= this.lastEmittedBarStart) return;
    this.lastEmittedBarStart = bar.start;
    const p: RawDataPoint<Candle> = {
      sourceId: 'xaus-api',
      value: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 },
      eventTime: new Date(bar.start).toISOString(),
      closedAt: new Date(bar.start + 60001).toISOString(),
      arrivalTime: new Date().toISOString(),
      availabilityTime: new Date(bar.start + 60001).toISOString(),
      version: 1, fingerprint: 'xaus-' + bar.start,
    };
    this.onCandle(p, false);
  }

  private logErr(msg: string): void {
    const now = Date.now();
    if (now - this.lastErrAt > 30000) { this.lastErrAt = now; console.warn('[XAUS] ' + msg); }
  }
}