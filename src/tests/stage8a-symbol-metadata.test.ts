import { describe, it, expect } from 'vitest';
import {
  toCanonical,
  getSourceMetadata,
  areInstrumentsEquivalent,
  SOURCE_METADATA,
} from '../normalization/canonical';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

function mk(sourceId: string): RawDataPoint<Candle> {
  return {
    sourceId,
    value: { open: 100, high: 101, low: 99, close: 100, volume: 10 },
    eventTime: '2025-01-06T10:00:00.000Z',
    closedAt: '2025-01-06T10:01:00.000Z',
    arrivalTime: '2025-01-06T10:00:00.000Z',
    availabilityTime: '2025-01-06T10:01:00.000Z',
    version: 1,
    fingerprint: 'fp-' + sourceId,
  };
}

const lineage = { lineage_id: 'L-stage8a', raw_path: '/raw/stage8a.json' };

describe('Stage 8A — symbol metadata', () => {
  it('binance-paxg: CRYPTO, CEX:BINANCE, USDT/PAXG', () => {
    const c = toCanonical(mk('binance-paxg'), '1m', lineage);
    expect(c.instrument_type).toBe('CRYPTO');
    expect(c.price_source).toBe('CEX:BINANCE');
    expect(c.quote_currency).toBe('USDT');
    expect(c.base_currency).toBe('PAXG');
  });

  it('twelvedata-ws: SPOT, FX:TWELVEDATA, USD/XAU', () => {
    const c = toCanonical(mk('twelvedata-ws'), '1m', lineage);
    expect(c.instrument_type).toBe('SPOT');
    expect(c.price_source).toBe('FX:TWELVEDATA');
    expect(c.quote_currency).toBe('USD');
    expect(c.base_currency).toBe('XAU');
  });

  it('fcsapi-xau: SPOT', () => {
    const c = toCanonical(mk('fcsapi-xau'), '1m', lineage);
    expect(c.instrument_type).toBe('SPOT');
  });

  it('h3-aggregated: AGGREGATED', () => {
    const c = toCanonical(mk('h3-aggregated'), '1m', lineage);
    expect(c.instrument_type).toBe('AGGREGATED');
  });

  it('xaus-api: UNKNOWN', () => {
    const c = toCanonical(mk('xaus-api'), '1m', lineage);
    expect(c.instrument_type).toBe('UNKNOWN');
  });

  it('unmapped source: all UNKNOWN', () => {
    const c = toCanonical(mk('never-seen'), '1m', lineage);
    expect(c.instrument_type).toBe('UNKNOWN');
    expect(c.price_source).toBe('UNKNOWN');
    expect(c.quote_currency).toBe('UNKNOWN');
    expect(c.base_currency).toBe('UNKNOWN');
  });

  it('getSourceMetadata: known source', () => {
    const m = getSourceMetadata('binance-paxg');
    expect(m.instrument_type).toBe('CRYPTO');
    expect(m.price_source).toBe('CEX:BINANCE');
  });

  it('getSourceMetadata: unknown source returns UNKNOWN', () => {
    const m = getSourceMetadata('never-seen');
    expect(m.instrument_type).toBe('UNKNOWN');
  });

  it('every SOURCE_METADATA entry has all 4 fields', () => {
    for (const [, meta] of Object.entries(SOURCE_METADATA)) {
      expect(meta.instrument_type).toBeDefined();
      expect(meta.price_source).toBeTruthy();
      expect(meta.quote_currency).toBeTruthy();
      expect(meta.base_currency).toBeTruthy();
    }
  });

  it('areInstrumentsEquivalent: same source → true', () => {
    const a = toCanonical(mk('binance-paxg'), '1m', lineage);
    const b = toCanonical(mk('binance-paxg'), '1h', lineage);
    expect(areInstrumentsEquivalent(a, b)).toBe(true);
  });

  it('areInstrumentsEquivalent: same canonical_symbol but different source → false', () => {
    const paxg = toCanonical(mk('binance-paxg'), '1m', lineage);
    const xau  = toCanonical(mk('fcsapi-xau'), '1m', lineage);
    // Both have canonical_symbol 'XAUUSD' — but they are NOT the same instrument
    expect(paxg.canonical_symbol).toBe(xau.canonical_symbol);
    expect(areInstrumentsEquivalent(paxg, xau)).toBe(false);
  });
});
