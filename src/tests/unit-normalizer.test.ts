import { describe, it, expect } from 'vitest';
import { canCompare, canUseVolume, resolveUnits } from '../normalization/unit-normalizer';

describe('UnitNormalizer (§7)', () => {
  it('resolves known source', () => {
    const u = resolveUnits('twelvedata-ws');
    expect(u.price_unit).toBe('USD/oz');
    expect(u.known).toBe(true);
  });

  it('unknown source', () => {
    const u = resolveUnits('unknown-source');
    expect(u.known).toBe(false);
    expect(u.price_unit).toBe('UNKNOWN');
  });

  it('compare same units', () => {
    const r = canCompare('twelvedata-ws', 'binance-paxg');
    expect(r.compatible).toBe(true);
  });

  it('volume profile only for known volume', () => {
    expect(canUseVolume('binance-paxg').allowed).toBe(true);
    expect(canUseVolume('twelvedata-ws').allowed).toBe(false);
    expect(canUseVolume('twelvedata-ws').reason).toContain('UNKNOWN');
  });
});