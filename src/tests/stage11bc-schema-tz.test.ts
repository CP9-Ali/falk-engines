import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { toCanonical } from '../normalization/canonical';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

function mk(sourceId: string, extras: Partial<RawDataPoint<Candle>> = {}): RawDataPoint<Candle> {
  return {
    sourceId,
    value: { open: 100, high: 101, low: 99, close: 100.5, volume: 10 },
    eventTime: '2025-01-06T10:00:00.000Z',
    closedAt: '2025-01-06T10:01:00.000Z',
    arrivalTime: '2025-01-06T10:00:00.000Z',
    availabilityTime: '2025-01-06T10:01:00.000Z',
    version: 1,
    fingerprint: 'fp-' + sourceId,
    ...extras,
  };
}

const lineage = { lineage_id: 'L-11bc', raw_path: '/raw/11bc.json' };

describe('Stage 11C — derivedTimezoneStatus forces UNKNOWN', () => {
  it('derivedTimezoneStatus UNKNOWN overrides known source timezone', () => {
    const c = toCanonical(
      mk('binance-paxg', { derivedTimezoneStatus: 'UNKNOWN' }),
      '1m', lineage,
    );
    expect(c.source_timezone).toBe('UNKNOWN');
    expect(c.source_timezone_status).toBe('UNKNOWN');
    expect(c.time_blocked).toBe(true);
  });

  it('derivedTimezoneStatus undefined keeps normal lookup', () => {
    const c = toCanonical(mk('binance-paxg'), '1m', lineage);
    expect(c.source_timezone).toBe('UTC');
    expect(c.time_blocked).toBe(false);
  });

  it('derivedTimezoneStatus RESOLVED does not override unknown lookup', () => {
    const c = toCanonical(
      mk('totally-unknown', { derivedTimezoneStatus: 'RESOLVED' }),
      '1m', lineage,
    );
    expect(c.source_timezone).toBe('UNKNOWN');
    expect(c.time_blocked).toBe(true);
  });

  it('h3-aggregator.ts sets derivedTimezoneStatus and has KNOWN_UTC_SOURCES', () => {
    const content = readFileSync('src/ingestion/h3-aggregator.ts', 'utf8');
    expect(content).toMatch(/derivedTimezoneStatus/);
    expect(content).toMatch(/KNOWN_UTC_SOURCES/);
    expect(content).toMatch(/upstreamHasUnknownTz/);
  });
});

describe('Stage 11B — schema mapper fallback', () => {
  it('canonical-shaped input passes through unchanged', () => {
    const c = toCanonical(mk('binance-paxg'), '1m', lineage);
    expect(c.open).toBe(100);
    expect(c.high).toBe(101);
    expect(c.low).toBe(99);
    expect(c.close).toBe(100.5);
    expect(c.volume_value).toBe(10);
  });

  it('canonical.ts imports mapSchema and uses ensureCandleShape', () => {
    const content = readFileSync('src/normalization/canonical.ts', 'utf8');
    expect(content).toMatch(/from '\.\/schema-mapper'/);
    expect(content).toMatch(/function ensureCandleShape/);
    expect(content).toMatch(/const val = ensureCandleShape/);
  });

  it('ensureCandleShape preserves volume for TICK-semantics source', () => {
    // binance-paxg has TICK semantics → volume preserved
    const c = toCanonical(mk('binance-paxg'), '1m', lineage);
    expect(c.volume_value).toBe(10);
    expect(c.volume_semantics).toBe('TICK');
  });

  it('UNKNOWN-semantics source nulls volume (per §7, not forced)', () => {
    // fcsapi-xau has UNKNOWN semantics → volume nulled by design
    const c = toCanonical(mk('fcsapi-xau'), '1m', lineage);
    expect(c.volume_semantics).toBe('UNKNOWN');
    expect(c.volume_value).toBeNull();
  });
});
