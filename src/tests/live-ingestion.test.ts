import { describe, it, expect } from 'vitest';
import { MemoryBuffer } from '../ingestion/memory-buffer';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const T = (h: number) => new Date(Date.UTC(2025, 0, 1, h)).toISOString();
const candle = (h: number): RawDataPoint<Candle> => ({
  sourceId: 'binance',
  value: { open: 100, high: 101, low: 99, close: 100, volume: 10 },
  eventTime: T(h),
  closedAt: T(h + 1),
  arrivalTime: T(h),
  availabilityTime: T(h),
  version: 1,
  fingerprint: `f${h}`,
});

describe('MemoryBuffer (live ingestion)', () => {
  it('push and drain', () => {
    const b = new MemoryBuffer(10);
    b.push(candle(0));
    b.push(candle(1));
    expect(b.stats().size).toBe(2);
    expect(b.drain().length).toBe(2);
    expect(b.stats().size).toBe(0);
  });

  it('drops oldest when full', () => {
    const b = new MemoryBuffer(2);
    b.push(candle(0));
    b.push(candle(1));
    b.push(candle(2));
    const stats = b.stats();
    expect(stats.size).toBe(2);
    expect(stats.dropped).toBe(1);
    expect(stats.produced).toBe(3);
  });

  it('tracks counters', () => {
    const b = new MemoryBuffer(10);
    for (let i = 0; i < 5; i++) b.push(candle(i));
    b.drain();
    for (let i = 5; i < 8; i++) b.push(candle(i));
    const stats = b.stats();
    expect(stats.produced).toBe(8);
    expect(stats.consumed).toBe(5);
    expect(stats.size).toBe(3);
  });

  it('peek does not drain', () => {
    const b = new MemoryBuffer(10);
    b.push(candle(0));
    b.peek();
    expect(b.stats().size).toBe(1);
  });

  it('rejects invalid max size', () => {
    expect(() => new MemoryBuffer(0)).toThrow();
  });

  it('preserves FIFO order', () => {
    const b = new MemoryBuffer(10);
    b.push(candle(0));
    b.push(candle(1));
    b.push(candle(2));
    const drained = b.drain();
    expect(drained[0]!.eventTime).toBe(T(0));
    expect(drained[1]!.eventTime).toBe(T(1));
    expect(drained[2]!.eventTime).toBe(T(2));
  });
});