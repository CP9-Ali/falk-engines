import WebSocket from 'ws';
import 'dotenv/config';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';
import { RawStore, type RawRef } from '../storage/raw-store';
import { CheckpointManager } from './checkpoint';
import { RateLimitManager } from './rate-limiter';
import { ErrorQueue } from './error-queue';

interface Bar { start: number; open: number; high: number; low: number; close: number; }

export interface Timeframe {
  label: string;
  ms: number;
  twelveDataInterval: string;
  historySize: number;
}

export const TIMEFRAMES: Timeframe[] = [
  { label: '1m',  ms: 60_000,        twelveDataInterval: '1min',   historySize: 100 },
  { label: '5m',  ms: 300_000,       twelveDataInterval: '5min',   historySize: 100 },
  { label: '15m', ms: 900_000,       twelveDataInterval: '15min',  historySize: 100 },
  { label: '1h',  ms: 3_600_000,     twelveDataInterval: '1h',     historySize: 100 },
  { label: '4h',  ms: 14_400_000,    twelveDataInterval: '4h',     historySize: 60  },
  { label: '1d',  ms: 86_400_000,    twelveDataInterval: '1day',   historySize: 60  },
  { label: '1w',  ms: 604_800_000,   twelveDataInterval: '1week',  historySize: 30  },
];

export interface RawInfo {
  readonly sourceSymbol: string;
  readonly fetchMethod: 'history' | 'live-tick' | 'live-kline';
  readonly lineage: RawRef;
}

export type CandleHandler = (tfLabel: string, point: RawDataPoint<Candle>, isHistory: boolean, rawInfo: RawInfo) => void;

export class TwelveDataWsSource {
  readonly name = 'twelvedata-ws';
  private ws: WebSocket | null = null;
  private started = false;
  private lastTickAt = 0;
  private lastErrorLogAt = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private currentBars = new Map<string, Bar>();
  private lastEmittedBarStart = new Map<string, number>();
  private readonly rawStore = new RawStore();
  private readonly checkpoints = new CheckpointManager();
  private readonly rateLimit = new RateLimitManager();
  private readonly errors = new ErrorQueue();

  constructor(
    private readonly apiKey: string,
    private readonly symbol: string,
    private readonly timeframes: Timeframe[],
    private readonly onCandle: CandleHandler,
    private readonly onTick: (price: number, ts: string) => void,
    private readonly onHealthChange: (healthy: boolean) => void,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.connect();
    this.loadAllHistoriesInBackground().catch(e => console.error('[TD-WS] History loader:', (e as Error).message));
  }

  stop(): void {
    this.started = false;
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
  }

  isHealthy(now = Date.now()): boolean {
    return this.lastTickAt > 0 && (now - this.lastTickAt) < 30000;
  }

  private async loadAllHistoriesInBackground(): Promise<void> {
    for (const tf of this.timeframes) {
      try { await this.loadHistory(tf); }
      catch (e) { this.logErr('History ' + tf.label + ': ' + (e as Error).message); }
      await new Promise(r => setTimeout(r, 8500));
    }
    console.log('[TD-WS] All histories loaded');
  }

  private async loadHistory(tf: Timeframe): Promise<void> {
    console.log('[TD-WS] Loading ' + tf.label + ' history...');

    const cp = this.checkpoints.get('twelvedata-ws', tf.label);
    const lastSync = cp ? new Date(cp.last_event_time_utc).getTime() : 0;

    let outputsize = tf.historySize;
    if (lastSync > 0) {
      const gapMs = Date.now() - lastSync;
      const missingBars = Math.ceil(gapMs / tf.ms);
      outputsize = Math.min(tf.historySize, missingBars + 10);
      console.log('[TD-WS] ' + tf.label + ' checkpoint found, requesting ' + outputsize + ' bars (was ' + tf.historySize + ')');
    }

    const url = 'https://api.twelvedata.com/time_series?symbol=' +
      encodeURIComponent(this.symbol) +
      '&interval=' + tf.twelveDataInterval +
      '&outputsize=' + outputsize +
      '&timezone=UTC&apikey=' +
      encodeURIComponent(this.apiKey);
    const permit = await this.rateLimit.waitUntilAllowed('twelvedata-ws');
    if (!permit.allowed) {
      this.errors.push({ source_id: 'twelvedata-ws', operation: 'history-fetch-' + tf.label, reason: permit.reason });
      this.logErr(tf.label + ': rate limited (' + permit.reason + ')');
      return;
    }
    const res = await fetch(url);
    if (res.status === 429) {
      this.rateLimit.reportRateLimit('twelvedata-ws');
      this.errors.push({ source_id: 'twelvedata-ws', operation: 'history-fetch-' + tf.label, reason: 'HTTP 429' });
      this.logErr(tf.label + ': HTTP 429');
      return;
    }
    this.rateLimit.reportSuccess('twelvedata-ws');
    const data = (await res.json()) as any;
    if (data.status === 'error') { this.logErr(tf.label + ': ' + (data.message || 'API error')); return; }
    if (!data.values || !Array.isArray(data.values)) return;

    let count = 0;
    const now = Date.now();
    const values = [...data.values].reverse();

    for (const v of values) {
      const dt = String(v.datetime).replace(' ', 'T') + 'Z';
      const barStart = new Date(dt).getTime();
      if (!Number.isFinite(barStart)) continue;
      if (barStart + tf.ms > now) continue;
      if (barStart <= lastSync) continue;

      const o = parseFloat(v.open), h = parseFloat(v.high);
      const l = parseFloat(v.low), c = parseFloat(v.close);
      if (!Number.isFinite(o) || !Number.isFinite(c)) continue;
      this.lastEmittedBarStart.set(tf.label, barStart);

      const p: RawDataPoint<Candle> = {
        sourceId: 'twelvedata-ws',
        value: { open: o, high: h, low: l, close: c, volume: 0 },
        eventTime: new Date(barStart).toISOString(),
        closedAt: new Date(barStart + tf.ms + 1).toISOString(),
        arrivalTime: new Date().toISOString(),
        availabilityTime: new Date(barStart + tf.ms + 1).toISOString(),
        version: 1,
        fingerprint: 'tdws-' + tf.label + '-' + barStart,
      };

      const lineage = this.rawStore.save({
        source_id: 'twelvedata-ws',
        source_symbol: this.symbol,
        timeframe: tf.label,
        event_time_utc: p.eventTime,
        fetch_method: 'history',
        fetched_at_utc: new Date().toISOString(),
        payload: v,
      });

      this.onCandle(tf.label, p, true, { sourceSymbol: this.symbol, fetchMethod: 'history', lineage });
      this.checkpoints.update('twelvedata-ws', tf.label, p.eventTime, lineage.payload_hash);
      count++;
    }
    console.log('[TD-WS] Loaded ' + count + ' new ' + tf.label + ' bars');
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
      if (this.started) { console.warn('[TD-WS] Closed, reconnect 5s'); setTimeout(() => this.connect(), 5000); }
    });

    ws.on('error', (e) => { this.logErr(e.message); this.onHealthChange(false); });
  }

  private handleTick(price: number, tsMs: number): void {
    if (!Number.isFinite(price)) return;
    this.lastTickAt = Date.now();
    this.onHealthChange(true);
    this.onTick(price, new Date(tsMs).toISOString());

    const now = Date.now();
    for (const tf of this.timeframes) {
      const barStart = Math.floor(now / tf.ms) * tf.ms;
      const cur = this.currentBars.get(tf.label);
      if (cur && barStart > cur.start) {
        this.emitClosedBar(tf, cur);
        this.currentBars.set(tf.label, { start: barStart, open: price, high: price, low: price, close: price });
      } else if (cur) {
        cur.high = Math.max(cur.high, price);
        cur.low = Math.min(cur.low, price);
        cur.close = price;
      } else {
        this.currentBars.set(tf.label, { start: barStart, open: price, high: price, low: price, close: price });
      }
    }
  }

  private emitClosedBar(tf: Timeframe, bar: Bar): void {
    const last = this.lastEmittedBarStart.get(tf.label) || 0;
    if (bar.start <= last) return;
    this.lastEmittedBarStart.set(tf.label, bar.start);

    const p: RawDataPoint<Candle> = {
      sourceId: 'twelvedata-ws',
      value: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: 0 },
      eventTime: new Date(bar.start).toISOString(),
      closedAt: new Date(bar.start + tf.ms + 1).toISOString(),
      arrivalTime: new Date().toISOString(),
      availabilityTime: new Date(bar.start + tf.ms + 1).toISOString(),
      version: 1,
      fingerprint: 'tdws-' + tf.label + '-' + bar.start,
    };

    const lineage = this.rawStore.save({
      source_id: 'twelvedata-ws',
      source_symbol: this.symbol,
      timeframe: tf.label,
      event_time_utc: p.eventTime,
      fetch_method: 'live-tick',
      fetched_at_utc: new Date().toISOString(),
      payload: {
        kind: 'aggregated-from-ticks',
        bar: { start: bar.start, open: bar.open, high: bar.high, low: bar.low, close: bar.close },
        generated_at: new Date().toISOString(),
      },
    });

    this.onCandle(tf.label, p, false, { sourceSymbol: this.symbol, fetchMethod: 'live-tick', lineage });
    this.checkpoints.update('twelvedata-ws', tf.label, p.eventTime, lineage.payload_hash);
  }

  private logErr(msg: string): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt > 30000) { this.lastErrorLogAt = now; console.warn('[TD-WS] ' + msg); }
  }
}