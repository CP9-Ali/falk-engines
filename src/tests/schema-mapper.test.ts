import { describe, it, expect } from 'vitest';
import { mapSchema, explainMapping } from '../normalization/schema-mapper';

describe('SchemaMapper (§7)', () => {
  it('maps TwelveData format', () => {
    const raw = { datetime: '2025-01-01 12:30:00', open: '4000.00', high: '4010.00', low: '3995.00', close: '4005.00', volume: '0' };
    const m = mapSchema(raw);
    expect(m).not.toBeNull();
    expect(m!.open).toBe(4000);
    expect(m!.close).toBe(4005);
    expect(m!.schema_source).toBe('twelvedata');
  });

  it('maps Binance kline array', () => {
    const raw = [1735689600000, '4000', '4010', '3990', '4005', '150', 1735689660000, '0', 100, '0', '0', '0'];
    const m = mapSchema(raw);
    expect(m).not.toBeNull();
    expect(m!.open).toBe(4000);
    expect(m!.volume).toBe(150);
    expect(m!.schema_source).toBe('binance-kline');
  });

  it('maps Binance object', () => {
    const raw = { t: 1735689600000, o: '4000', h: '4010', l: '3990', c: '4005', v: '150' };
    const m = mapSchema(raw);
    expect(m).not.toBeNull();
    expect(m!.close).toBe(4005);
  });

  it('maps FCSAPI format', () => {
    const raw = { t: '2025-01-01 12:30:00', '1': '4000', '2': '4010', '3': '3990', '4': '4005', '5': '0' };
    const m = mapSchema(raw);
    expect(m).not.toBeNull();
    expect(m!.close).toBe(4005);
    expect(m!.schema_source).toBe('fcsapi');
  });

  it('returns null for unknown format', () => {
    expect(mapSchema({ foo: 'bar' })).toBeNull();
    expect(mapSchema({})).toBeNull();
    expect(mapSchema(null)).toBeNull();
  });

  it('explains mapping', () => {
    const e = explainMapping({ datetime: '2025-01-01 00:00:00', open: '1', high: '1', low: '1', close: '1' });
    expect(e.detected).toBe('twelvedata');
    expect(e.mapped).toBe(true);
  });
});