import WebSocket from 'ws';
import 'dotenv/config';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

interface Bar { start: number; open: number; high: number; low: number; close: number; }

export class TwelveDataWsSource {
  readonly name = 'twelvedata-ws';
  private ws: WebSocket | null = null;
  private started = false;
  private lastTickPrice: number | null = null;
  private currentBar: Bar | null = null;
  private lastEmittedBarStart = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastTickAt = 0;
  private lastErrorLogAt = 0;

  constructor(
    private readonly apiKey: string,
    private readonly symbol: string,
    private readonly onCandle: (p: RawDataPoint<Candle>, isHistory: boolean) => void,
    private readonly onTick: (price: number, ts: string) => void,
    private readonly onHealthChange: (healthy: boolean) => void,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.loadHistory();
    this.connect();
  }

  stop(): void {
    this.started = false;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
  }

  isHealthy(now = Date.now()): boolean {
    return this.lastTickAt > 0 && (now - this.lastTickAt) < 30000;
  }

  private async loadHistory(): Promise<void> {
    try {
      console.log('[TD-WS] Loading 100 historical bars...');
      const url = 'https://api.twelvedata.com/time_series?symbol=' +
        encodeURIComponent(this.symbol) +
        '&interval=1min&outputsize=100&timezone=UTC&apikey=' +
        encodeURIComponent(this.apiKey);
      const res = await fetch(url);
      const data = (await res.json()) as any;
      if (data.status === 'error') {
        this.logErr('History: ' + (data.message || 'API error'));
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
        const o = parseFloat(v.open), h = parseFloat(v.high);
        const l = parseFloat(v.low), c = parseFloat(v.close);
        if (!Number.isFinite(o) || !Number.isFinite(c)) continue;
        this.lastEmittedBarStart = barStart;
        const p: RawDataPoint<Candle> = {
          sourceId: 'twelvedata-ws',
          value: { open: o, high: h, low: l, close: c, volume: 0 },
          eventTime: new Date(barStart).toISOString(),
          closedAt: new Date(barStart + 60_001).toISOString(),
          arrivalTime: new Date().toISOString(),
          availabilityTime: new Date(barStart + 60_001).toISOString(),
          version: 1, fingerprint: 'tdws-' + barStart,
        };
        this.onCandle(p, true);
        count++;
      }
      console.log('[TD-WS] Loaded ' + count + ' historical bars');
    } catch (e) {
      this.logErr('History: ' + (e as Error).message);
    }
  }

  private connect(): void {
    if (!this.started) return;
    const url = 'wss://ws.twelvedata.com/v1/quotes/price?apikey=' + encodeURIComponent(this.apiKey);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      console.log('[TD-WS] Connected');
      ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: this.symbol } }));
      this.heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: 'heartbeat' }));
      }, 10000);
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.event === 'price' && msg.price) {
          this.handleTick(Number(msg.price), Number(msg.timestamp) * 1000);
        }
      } catch (e) { this.logErr('parse: ' + (e as Error).message); }
    });

    ws.on('close', () => {
      if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
      this.onHealthChange(false);
      if (this.started) { console.warn('[TD-WS] Closed, reconnect in 5s'); setTimeout(() => this.connect(), 5000); }
    });

    ws.on('error', (e) => { this.logErr(e.message); this.onHealthChange(false); });
  }

  private handleTick(price: number, tsMs: number): void {
    if (!Number.isFinite(price)) return;
    this.lastTickAt = Date.now();
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
      sourceId: 'twelvedata-ws',
      value: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 },
      eventTime: new Date(bar.start).toISOString(),
      closedAt: new Date(bar.start + 60001).toISOString(),
      arrivalTime: new Date().toISOString(),
      availabilityTime: new Date(bar.start + 60001).toISOString(),
      version: 1, fingerprint: 'tdws-' + bar.start,
    };
    this.onCandle(p, false);
  }

  private logErr(msg: string): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt > 30000) { this.lastErrorLogAt = now; console.warn('[TD-WS] ' + msg); }
  }
}