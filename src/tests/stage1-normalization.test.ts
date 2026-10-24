import { describe, it, expect } from 'vitest';
import { toCanonical } from '../normalization/canonical';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

function makeRaw(sourceId: string, closedAt?: string): RawDataPoint<Candle> {
  return {
    sourceId,
    value: { open: 100, high: 101, low: 99, close: 100.5, volume: 50 },
    eventTime: '2026-10-24T12:00:00.000Z',
    closedAt,
    arrivalTime: '2026-10-24T12:00:01.000Z',
    availabilityTime: '2026-10-24T12:00:01.000Z',
    version: 1,
    fingerprint: 'fp-stage1',
  };
}

const lineage = { lineage_id: 'L-stage1', raw_path: '/raw/stage1.json' };

describe('Stage 1 normalization', () => {
  it('known source -> source_timezone_status RESOLVED, time_blocked false', () => {
    const c = toCanonical(makeRaw('binance-paxg'), '1m', lineage);
    expect(c.source_timezone_status).toBe('RESOLVED');
    expect(c.time_blocked).toBe(false);
  });

  it('unknown source -> source_timezone_status UNKNOWN, time_blocked true', () => {
    const c = toCanonical(makeRaw('totally-unknown-source'), '1m', lineage);
    expect(c.source_timezone).toBe('UNKNOWN');
    expect(c.source_timezone_status).toBe('UNKNOWN');
    expect(c.time_blocked).toBe(true);
  });

  it('volume_value is null when volume_semantics UNKNOWN', () => {
    const c = toCanonical(makeRaw('twelvedata-ws'), '1m', lineage);
    expect(c.volume_semantics).toBe('UNKNOWN');
    expect(c.volume_value).toBeNull();
  });

  it('volume_value preserves number when semantics known', () => {
    const c = toCanonical(makeRaw('binance-paxg'), '1m', lineage);
    expect(c.volume_semantics).toBe('TICK');
    expect(c.volume_value).toBe(50);
  });

  it('is_final true when closedAt set', () => {
    const c = toCanonical(
      makeRaw('binance-paxg', '2026-10-24T12:01:00.000Z'),
      '1m', lineage,
    );
    expect(c.is_final).toBe(true);
  });

  it('is_final false when closedAt undefined', () => {
    const c = toCanonical(makeRaw('binance-paxg'), '1m', lineage);
    expect(c.is_final).toBe(false);
  });
});
