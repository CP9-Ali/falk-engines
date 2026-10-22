import WebSocket from 'ws';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';
import type { LiveSource } from './live-source';

interface BinanceKlineMessage {
  k?: {
    t: number;
    T: number;
    x: boolean;
    o: string;
    h: string;
    l: string;
    c: string;
    v: string;
  };
}

export interface BinanceLiveConfig {
  readonly symbol: string;
  readonly emitInProgress?: boolean;
  readonly onPoint: (p: RawDataPoint<Candle>) => void | Promise<void>;
}

/**
 * ß14: »Ì«‰«  Binance ÕÌ….
 * - «·«› —«÷Ì: «·‘„Ê⁄ «·„€·ﬁ… ›ﬁÿ (no lookahead)
 * - emitInProgress=true: «·‘„Ê⁄ ﬁÌœ «· ﬂÊ¯‰ √Ì÷« (··„—«ﬁ»…)
 */
export class BinanceLiveSource implements LiveSource {
  private ws?: WebSocket;

  constructor(private readonly cfg: BinanceLiveConfig) {}

  async start(): Promise<void> {
    const url = `wss://stream.binance.com:9443/ws/${this.cfg.symbol}@kline_1h`;
    this.ws = new WebSocket(url);

    return new Promise((resolve, reject) => {
      this.ws!.on('open', () => {
        console.log(`[binance] connected: ${this.cfg.symbol}`);
        resolve();
      });

      this.ws!.on('message', async (data: WebSocket.RawData) => {
        try {
          const msg = JSON.parse(data.toString()) as BinanceKlineMessage;
          if (!msg.k) return;
          if (!this.cfg.emitInProgress && !msg.k.x) return;

          const k = msg.k;
          const point: RawDataPoint<Candle> = {
            sourceId: 'binance',
            value: {
              open: parseFloat(k.o),
              high: parseFloat(k.h),
              low: parseFloat(k.l),
              close: parseFloat(k.c),
              volume: parseFloat(k.v),
            },
            eventTime: new Date(k.t).toISOString(),
            closedAt: new Date(k.T + 1).toISOString(),
            arrivalTime: new Date().toISOString(),
            availabilityTime: new Date(k.T + 1).toISOString(),
            version: 1,
            fingerprint: `${this.cfg.symbol}-${k.t}-${k.x ? 'closed' : 'open'}`,
          };

          await this.cfg.onPoint(point);
        } catch (e) {
          console.error('[binance] handler error:', e);
        }
      });

      this.ws!.on('error', (err: Error) => {
        console.error('[binance] ws error:', err.message);
        reject(err);
      });

      this.ws!.on('close', () => {
        console.log('[binance] disconnected');
      });
    });
  }

  async stop(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }
}