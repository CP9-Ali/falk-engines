import { describe, it, expect } from 'vitest';
import { precisionCheck } from '../data-quality/checks/precision';
import { volumeSemanticsCheck } from '../data-quality/checks/volume-semantics';
import { timezoneCheck } from '../data-quality/checks/timezone';
import type { CheckContext, Candle } from '../data-quality/checks/base';
import type { RawDataPoint } from '../core/types';

function makePoint(sourceId: string, candle: Candle, eventTime = '2026-10-24T12:00:00.000Z'): RawDataPoint<Candle> {
  return {
    sourceId,
    value: candle,
    eventTime,
    arrivalTime: '2026-10-24T12:00:01.000Z',
    availabilityTime: '2026-10-24T12:00:01.000Z',
    version: 1,
    fingerprint: 'fp-' + sourceId,
  };
}

function makeCtx(sourceId: string, points: RawDataPoint<Candle>[]): CheckContext<Candle> {
  return {
    sourceId,
    points,
    range: { from: '2026-10-24T00:00:00.000Z', to: '2026-10-24T23:59:59.999Z' },
    expectedCadenceMs: 60_000,
    asOfCutoff: '2026-10-24T23:59:59.999Z',
  };
}

describe('DQ-PRECISION', () => {
  it('passes values within spec decimal_places', () => {
    const ctx = makeCtx('xaus-api', [
      makePoint('xaus-api', { open: 2345.67, high: 2345.89, low: 2345.42, close: 2345.75, volume: 100 }),
    ]);
    expect(precisionCheck.run(ctx)).toHaveLength(0);
  });

  it('flags value exceeding spec decimal_places', () => {
    const ctx = makeCtx('xaus-api', [
      makePoint('xaus-api', { open: 2345.678, high: 2345.89, low: 2345.42, close: 2345.75, volume: 100 }),
    ]);
    const findings = precisionCheck.run(ctx);
    expect(findings).toHaveLength(1);
    const first = findings[0]!;
    expect(first.checkId).toBe('DQ-PRECISION-001');
    expect(first.severity).toBe('WARNING');
  });

  it('returns no findings when source has no precision spec', () => {
    const ctx = makeCtx('unknown-source', [
      makePoint('unknown-source', { open: 1.123456, high: 2, low: 1, close: 1.5, volume: 10 }),
    ]);
    expect(precisionCheck.run(ctx)).toHaveLength(0);
  });
});

describe('DQ-VOLUME-SEMANTICS', () => {
  it('flags volume present with UNKNOWN semantics', () => {
    const ctx = makeCtx('twelvedata-ws', [
      makePoint('twelvedata-ws', { open: 1, high: 2, low: 1, close: 1.5, volume: 100 }),
    ]);
    const findings = volumeSemanticsCheck.run(ctx);
    expect(findings).toHaveLength(1);
    const first = findings[0]!;
    expect(first.checkId).toBe('DQ-VOLUME-SEMANTICS-001');
    expect(first.category).toBe('SUITABILITY');
  });

  it('passes when semantics is known', () => {
    const ctx = makeCtx('binance-paxg', [
      makePoint('binance-paxg', { open: 1, high: 2, low: 1, close: 1.5, volume: 100 }),
    ]);
    expect(volumeSemanticsCheck.run(ctx)).toHaveLength(0);
  });

  it('passes when volume is zero even with UNKNOWN semantics', () => {
    const ctx = makeCtx('twelvedata-ws', [
      makePoint('twelvedata-ws', { open: 1, high: 2, low: 1, close: 1.5, volume: 0 }),
    ]);
    expect(volumeSemanticsCheck.run(ctx)).toHaveLength(0);
  });
});

describe('DQ-TIMEZONE', () => {
  it('flags source with no registered timezone', () => {
    const ctx = makeCtx('made-up-source', [
      makePoint('made-up-source', { open: 1, high: 2, low: 1, close: 1.5, volume: 10 }),
    ]);
    const findings = timezoneCheck.run(ctx);
    expect(findings).toHaveLength(1);
    const first = findings[0]!;
    expect(first.checkId).toBe('DQ-TIMEZONE-001');
    expect(first.severity).toBe('HIGH');
  });

  it('passes when source has registered timezone', () => {
    const ctx = makeCtx('binance-paxg', [
      makePoint('binance-paxg', { open: 1, high: 2, low: 1, close: 1.5, volume: 10 }),
    ]);
    expect(timezoneCheck.run(ctx)).toHaveLength(0);
  });
});
