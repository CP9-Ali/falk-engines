import { describe, it, expect } from 'vitest';
import {
  toCanonical,
  SYMBOL_MAPPING_VERSION,
  UNIT_MAPPING_VERSION,
  PRECISION_MAPPING_VERSION,
  VOLUME_MAPPING_VERSION,
} from '../normalization/canonical';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

function mk(sourceId: string, overrides: Partial<RawDataPoint<Candle>> = {}): RawDataPoint<Candle> {
  return {
    sourceId,
    value: { open: 100, high: 101, low: 99, close: 100, volume: 10 },
    eventTime: '2025-01-06T10:00:00.000Z',
    closedAt: '2025-01-06T10:01:00.000Z',
    arrivalTime: '2025-01-06T10:00:00.000Z',
    availabilityTime: '2025-01-06T10:01:00.000Z',
    version: 1,
    fingerprint: 'fp-' + sourceId,
    ...overrides,
  };
}

const lineage = { lineage_id: 'L-stage8b', raw_path: '/raw/stage8b.json' };

describe('Stage 8B — source_timestamp preservation', () => {
  it('source_timestamp uses raw.sourceTimestamp when provided', () => {
    const c = toCanonical(
      mk('binance-paxg', { sourceTimestamp: '2025-01-06T10:00:00.123456+00:00' }),
      '1m', lineage,
    );
    expect(c.source_timestamp).toBe('2025-01-06T10:00:00.123456+00:00');
    expect(c.event_time_utc).toBe('2025-01-06T10:00:00.000Z');
    expect(c.source_timestamp).not.toBe(c.event_time_utc);
  });

  it('source_timestamp falls back to eventTime when sourceTimestamp is absent', () => {
    const c = toCanonical(mk('binance-paxg'), '1m', lineage);
    expect(c.source_timestamp).toBe(c.event_time_utc);
  });

  it('source_timestamp preserves sub-second precision from source', () => {
    const original = '2025-01-06T14:30:45.999888';
    const c = toCanonical(
      mk('fcsapi-xau', { sourceTimestamp: original }),
      '1m', lineage,
    );
    expect(c.source_timestamp).toBe(original);
  });
});

describe('Stage 8B — per-mapping versions', () => {
  it('every candle has all 4 mapping versions', () => {
    const c = toCanonical(mk('binance-paxg'), '1m', lineage);
    expect(c.symbol_mapping_version).toBe(SYMBOL_MAPPING_VERSION);
    expect(c.unit_mapping_version).toBe(UNIT_MAPPING_VERSION);
    expect(c.precision_mapping_version).toBe(PRECISION_MAPPING_VERSION);
    expect(c.volume_mapping_version).toBe(VOLUME_MAPPING_VERSION);
  });

  it('version constants are non-empty semver-like strings', () => {
    for (const v of [SYMBOL_MAPPING_VERSION, UNIT_MAPPING_VERSION, PRECISION_MAPPING_VERSION, VOLUME_MAPPING_VERSION]) {
      expect(v).toMatch(/^[0-9]+[.][0-9]+[.][0-9]+$/);
    }
  });

  it('all version fields populated for unmapped source too', () => {
    const c = toCanonical(mk('never-seen'), '1m', lineage);
    expect(c.symbol_mapping_version).toBeDefined();
    expect(c.unit_mapping_version).toBeDefined();
    expect(c.precision_mapping_version).toBeDefined();
    expect(c.volume_mapping_version).toBeDefined();
  });
});
