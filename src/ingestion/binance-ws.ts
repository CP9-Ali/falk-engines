import WebSocket from 'ws';
import { Kafka } from 'kafkajs';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const kafka = new Kafka({ clientId: 'falk-binance', brokers: ['localhost:9092'] });
const producer = kafka.producer();

interface BinanceKlineMessage {
  k?: {
    t: number; T: number; x: boolean;
    o: string; h: string; l: string; c: string; v: string;
  };
}

export async function startBinanceFeed(symbol = 'btcusdt'): Promise<void> {
  await producer.connect();
  const url = `wss://stream.binance.com:9443/ws/${symbol}@kline_1h`;
  const ws = new WebSocket(url);

  ws.on('message', async (data: WebSocket.RawData) => {
    const msg = JSON.parse(data.toString()) as BinanceKlineMessage;
    if (!msg.k || !msg.k.x) return;

    const k = msg.k;
    const eventMs = k.t;
    const point: RawDataPoint<Candle> = {
      sourceId: 'binance',
      value: {
        open:   parseFloat(k.o),
        high:   parseFloat(k.h),
        low:    parseFloat(k.l),
        close:  parseFloat(k.c),
        volume: parseFloat(k.v),
      },
      eventTime: new Date(eventMs).toISOString(),
      closedAt: new Date(k.T + 1).toISOString(),
      arrivalTime: new Date().toISOString(),
      availabilityTime: new Date(k.T + 1).toISOString(),
      version: 1,
      fingerprint: `${symbol}-${eventMs}`,
    };

    await producer.send({
      topic: 'market-data',
      messages: [{ key: symbol, value: JSON.stringify(point) }],
    });
    console.log(`[${symbol}] ${point.value.close} -> Kafka`);
  });

  ws.on('error', (err: Error) => console.error('WS error:', err));
}
