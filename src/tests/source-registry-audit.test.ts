import { describe, it, expect } from 'vitest';
import { SourceRegistry } from '../ingestion/source-registry';

describe('Source Registry (§4) — Honesty Audit', () => {
  const registry = new SourceRegistry();

  it('every source has 13 fields present', () => {
    for (const cap of registry.all()) {
      expect(cap.source_id).toBeDefined();
      expect(cap.source_name).toBeDefined();
      expect(cap.source_type).toBeDefined();
      expect(cap.connection_type).toBeDefined();
      expect(cap.instrument_id).toBeDefined();
      expect(cap.canonical_symbol).toBeDefined();
      expect(cap.data_capabilities).toBeDefined();
      expect(cap.timestamp_semantics).toBeDefined();
      expect(cap.volume_semantics).toBeDefined();
      expect(cap.historical_coverage).toBeDefined();
      expect(cap.rate_limits).toBeDefined();
      expect(cap.license_and_retention).toBeDefined();
      expect(cap.config_version).toBeDefined();
    }
  });

  it('every source declares verification notes', () => {
    for (const cap of registry.all()) {
      expect(cap.verification_notes.length).toBeGreaterThan(0);
    }
  });

  it('no source claims VERIFIED for untested historical coverage start', () => {
    for (const cap of registry.all()) {
      if (cap.historical_coverage.from !== null) {
        expect(cap.historical_coverage.status).toBe('VERIFIED');
      }
    }
  });

  it('no source claims VERIFIED orderbook unless tested', () => {
    for (const cap of registry.all()) {
      if (cap.data_capabilities.orderbook === 'VERIFIED') {
        throw new Error(cap.source_id + ' claims VERIFIED orderbook but no test exists');
      }
    }
  });

  it('TwelveData volume is not claimed VERIFIED', () => {
    const td = registry.get('twelvedata-ws')!;
    expect(td.data_capabilities.volume).not.toBe('VERIFIED');
    expect(td.volume_semantics).toBe('UNKNOWN');
  });

  it('Binance rate limit not claimed VERIFIED (never stress-tested)', () => {
    const b = registry.get('binance-paxg')!;
    expect(b.rate_limits.status).toBe('UNVERIFIED');
  });

  it('Binance historical coverage start is null (not tested from 2020)', () => {
    const b = registry.get('binance-paxg')!;
    expect(b.historical_coverage.from).toBeNull();
  });
});