import 'dotenv/config';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

export async function loadBinanceHistory(symbol = 'PAXGUSDT', limit = 100): Promise<RawDataPoint<Candle>[]> {
  const url = 'https://api.binance.com/api/v3/klines?symbol=' + encodeURIComponent(symbol) +
    '&interval=1m&limit=' + limit;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Binance history HTTP ' + res.status);
  const rows = (await res.json()) as any[];
  if (!Array.isArray(rows)) throw new Error('Binance history: invalid response');

  const now = Date.now();
  const points: RawDataPoint<Candle>[] = [];

  for (const r of rows) {
    const openTime = Number(r[0]);
    const closeTime = Number(r[6]);
    if (!Number.isFinite(openTime)) continue;
    if (closeTime > now) continue;

    const o = parseFloat(r[1]);
    const h = parseFloat(r[2]);
    const l = parseFloat(r[3]);
    const c = parseFloat(r[4]);
    const v = parseFloat(r[5]);
    if (!Number.isFinite(o) || !Number.isFinite(c)) continue;

    points.push({
      sourceId: 'binance-paxg',
      value: { open: o, high: h, low: l, close: c, volume: v },
      eventTime: new Date(openTime).toISOString(),
      closedAt: new Date(closeTime).toISOString(),
      arrivalTime: new Date().toISOString(),
      availabilityTime: new Date(closeTime).toISOString(),
      version: 1,
      fingerprint: symbol + '-' + openTime,
    });
  }

  return points;
}