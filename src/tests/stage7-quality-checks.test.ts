import { describe, it, expect } from 'vitest';
import { sessionGapCheck } from '../data-quality/checks/session-gap';
import { volumeSanityCheck } from '../data-quality/checks/volume-sanity';
import type { CheckContext, Candle } from '../data-quality/checks/base';
import type { RawDataPoint } from '../core/types';

function mk(sourceId: string, candle: Candle, eventTime: string): RawDataPoint<Candle> {
  return {
    sourceId,
    value: candle,
    eventTime,
    arrivalTime: eventTime,
    availabilityTime: eventTime,
    version: 1,
    fingerprint: 'fp-' + eventTime,
  };
}

function mkCtx(sourceId: string, points: RawDataPoint<Candle>[]): CheckContext<Candle> {
  return {
    sourceId,
    points,
    range: { from: '2025-01-01T00:00:00.000Z', to: '2025-01-31T23:59:59.999Z' },
    expectedCadenceMs: 60_000,
    asOfCutoff: '2025-01-31T23:59:59.999Z',
  };
}

describe('DQ-SESSION-GAP', () => {
  it('passes continuous candles during market-open hours', () => {
    // Monday Jan 6 2025 10:00-10:04 UTC (LONDON session)
    const points = [
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 10 }, '2025-01-06T10:00:00.000Z'),
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 10 }, '2025-01-06T10:01:00.000Z'),
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 10 }, '2025-01-06T10:02:00.000Z'),
    ];
    expect(sessionGapCheck.run(mkCtx('binance-paxg', points))).toHaveLength(0);
  });

  it('flags candles during market-closed hours as CRITICAL', () => {
    // Saturday Jan 4 2025 12:00 UTC — market closed
    const points = [
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 10 }, '2025-01-04T12:00:00.000Z'),
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 10 }, '2025-01-04T12:01:00.000Z'),
    ];
    const findings = sessionGapCheck.run(mkCtx('binance-paxg', points));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.checkId).toBe('DQ-SESSION-GAP-001');
    expect(findings[0]!.severity).toBe('CRITICAL');
    expect(findings[0]!.category).toBe('STRUCTURAL');
  });

  it('flags missing candles during market-open hours as HIGH', () => {
    // Monday Jan 6 2025: 10:00, 10:01, [gap 10:02-10:05], 10:06
    const points = [
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 10 }, '2025-01-06T10:00:00.000Z'),
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 10 }, '2025-01-06T10:01:00.000Z'),
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 10 }, '2025-01-06T10:06:00.000Z'),
    ];
    const findings = sessionGapCheck.run(mkCtx('binance-paxg', points));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.checkId).toBe('DQ-SESSION-GAP-002');
    expect(findings[0]!.severity).toBe('HIGH');
    expect(findings[0]!.evidence!.missingCount).toBe(4);
  });
});

describe('DQ-VOLUME-SANITY', () => {
  it('passes for known TICK source with reasonable volumes', () => {
    const points = [
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 100 }, '2025-01-06T10:00:00.000Z'),
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 120 }, '2025-01-06T10:01:00.000Z'),
    ];
    expect(volumeSanityCheck.run(mkCtx('binance-paxg', points))).toHaveLength(0);
  });

  it('flags negative volume as CRITICAL', () => {
    const points = [
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 100 }, '2025-01-06T10:00:00.000Z'),
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: -5 }, '2025-01-06T10:01:00.000Z'),
    ];
    const findings = volumeSanityCheck.run(mkCtx('binance-paxg', points));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.checkId).toBe('DQ-VOLUME-SANITY-001');
    expect(findings[0]!.severity).toBe('CRITICAL');
  });

  it('flags >50% zero-volume as WARNING', () => {
    const points = [
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 0 }, '2025-01-06T10:00:00.000Z'),
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 0 }, '2025-01-06T10:01:00.000Z'),
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 5 }, '2025-01-06T10:02:00.000Z'),
    ];
    const findings = volumeSanityCheck.run(mkCtx('binance-paxg', points));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.checkId).toBe('DQ-VOLUME-SANITY-002');
    expect(findings[0]!.severity).toBe('WARNING');
  });

  it('flags x1000+ volume spikes as WARNING', () => {
    const points = [
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 1 }, '2025-01-06T10:00:00.000Z'),
      mk('binance-paxg', { open: 100, high: 101, low: 99, close: 100, volume: 5000 }, '2025-01-06T10:01:00.000Z'),
    ];
    const findings = volumeSanityCheck.run(mkCtx('binance-paxg', points));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.checkId).toBe('DQ-VOLUME-SANITY-003');
  });

  it('skips UNKNOWN and CONTRACT semantics', () => {
    const points = [
      mk('twelvedata-ws', { open: 100, high: 101, low: 99, close: 100, volume: -5 }, '2025-01-06T10:00:00.000Z'),
    ];
    expect(volumeSanityCheck.run(mkCtx('twelvedata-ws', points))).toHaveLength(0);
  });
});
