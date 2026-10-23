import { describe, it, expect } from 'vitest';
import { checkPrice, checkVolume, decimalPlaces } from '../normalization/precision-handler';

describe('PrecisionHandler (§7)', () => {
  it('valid price passes', () => {
    expect(checkPrice(4015.5).passed).toBe(true);
  });

  it('too many decimals fails', () => {
    expect(checkPrice(4015.123456789).passed).toBe(false);
  });

  it('out of range fails', () => {
    expect(checkPrice(100000).passed).toBe(false);
    expect(checkPrice(100).passed).toBe(false);
  });

  it('NaN fails', () => {
    expect(checkPrice(NaN).passed).toBe(false);
  });

  it('volume passes', () => {
    expect(checkVolume(1500).passed).toBe(true);
    expect(checkVolume(1500.5).passed).toBe(true);
  });

  it('negative volume fails', () => {
    expect(checkVolume(-1).passed).toBe(false);
  });

  it('decimalPlaces counts correctly', () => {
    expect(decimalPlaces(4015)).toBe(0);
    expect(decimalPlaces(4015.5)).toBe(1);
    expect(decimalPlaces(4015.123)).toBe(3);
  });
});