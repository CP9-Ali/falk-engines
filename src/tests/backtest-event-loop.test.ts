import { describe, it, expect } from 'vitest';
import { runEventLoop } from '../backtest/event-loop';
import type { Strategy, SignalEvent } from '../backtest/event-loop';
import type { BacktestConfig, Signal } from '../backtest/types';
import type { CanonicalCandle } from '../normalization/canonical';

function mkCandle(
  openIso: string,
  close: number,
  tf: BacktestConfig['timeframe'] = '1h',
  closeTimeOverride?: string | null,
): CanonicalCandle {
  return {
    source_id: 'test-src',
    source_symbol: 'XAUUSD',
    canonical_symbol: 'XAUUSD',
    instrument_type: 'spot',
    price_source: 'test',
    quote_currency: 'USD',
    base_currency: 'XAU',
    timeframe: tf as any,
    event_time_utc: openIso,
    source_timestamp: openIso,
    source_timezone: 'UTC',
    source_timezone_status: 'RESOLVED',
    time_blocked: false,
    arrival_time_utc: openIso,
    availability_time_utc: openIso,
    open: close,
    high: close,
    low: close,
    close,
    volume_value: null,
    volume_semantics: 'UNKNOWN',
    raw_fingerprint: 'fp-' + openIso,
    lineage_id: 'lin-' + openIso,
    raw_payload_ref: 'raw-' + openIso,
    normalization_version: 'nv1',
    processing_version: 'pv1',
    ...(closeTimeOverride !== undefined ? { candle_close_time_utc: closeTimeOverride } : {}),
  } as any;
}

const config: BacktestConfig = {
  version: 'bt-v1',
  symbol: 'XAUUSD',
  timeframe: '1h',
  from_utc: '2026-01-01T00:00:00Z',
  to_utc:   '2026-01-02T00:00:00Z',
  initial_capital: 10_000,
  fees_bps: 0,
  slippage_bps: 0,
  allow_reentry_same_bar: false,
};

const holdStrategy: Strategy = (candle) => ({
  action: 'HOLD',
  at: candle.event_time_utc,
});

describe('?9.1 ? runEventLoop', () => {
  it('empty candles ? empty events', () => {
    const r = runEventLoop({ config, candles: [], strategy: holdStrategy });
    expect(r.events).toEqual([]);
    expect(r.candles_processed).toBe(0);
  });

  it('one valid candle ? 1 event', () => {
    const r = runEventLoop({
      config,
      candles: [mkCandle('2026-01-01T00:00:00Z', 100)],
      strategy: holdStrategy,
    });
    expect(r.events).toHaveLength(1);
    expect(r.candles_processed).toBe(1);
  });

  it('multiple valid candles ? all processed, order preserved', () => {
    const candles = [
      mkCandle('2026-01-01T00:00:00Z', 100),
      mkCandle('2026-01-01T01:00:00Z', 101),
      mkCandle('2026-01-01T02:00:00Z', 102),
    ];
    const r = runEventLoop({ config, candles, strategy: holdStrategy });
    expect(r.events.map((e) => e.candle.close)).toEqual([100, 101, 102]);
  });

  it('candle whose closeTime > configTo ? skipped_not_final', () => {
    // config.to = 2026-01-02T00:00:00Z; candle opens at 23:30 (1h tf ? closes 00:30 next day)
    const r = runEventLoop({
      config,
      candles: [
        mkCandle('2026-01-01T23:30:00Z', 100),
      ],
      strategy: holdStrategy,
    });
    expect(r.candles_skipped_not_final).toBe(1);
    expect(r.candles_processed).toBe(0);
  });

  it('candle ending before configFrom ? outside_range', () => {
    const r = runEventLoop({
      config,
      candles: [
        mkCandle('2025-12-30T00:00:00Z', 100),  // closes 2025-12-30T01:00
      ],
      strategy: holdStrategy,
    });
    expect(r.candles_outside_range).toBe(1);
    expect(r.candles_processed).toBe(0);
  });

  it('candle opening after configTo ? outside_range', () => {
    const r = runEventLoop({
      config,
      candles: [
        mkCandle('2026-01-03T00:00:00Z', 100),
      ],
      strategy: holdStrategy,
    });
    expect(r.candles_outside_range).toBe(1);
    expect(r.candles_processed).toBe(0);
  });

  it('isInGap ? true skips candle as gap', () => {
    const r = runEventLoop({
      config,
      candles: [
        mkCandle('2026-01-01T00:00:00Z', 100),
        mkCandle('2026-01-01T01:00:00Z', 101),
      ],
      strategy: holdStrategy,
      isInGap: (c) => c.event_time_utc === '2026-01-01T01:00:00Z',
    });
    expect(r.candles_processed).toBe(1);
    expect(r.candles_skipped_gap).toBe(1);
  });

  it('no isInGap ? no gap skips', () => {
    const r = runEventLoop({
      config,
      candles: [
        mkCandle('2026-01-01T00:00:00Z', 100),
        mkCandle('2026-01-01T01:00:00Z', 101),
      ],
      strategy: holdStrategy,
    });
    expect(r.candles_skipped_gap).toBe(0);
    expect(r.candles_processed).toBe(2);
  });

  it('strategy context.history length = index + 1', () => {
    const seenLengths: number[] = [];
    const strategy: Strategy = (c, ctx) => {
      seenLengths.push(ctx.history.length);
      return { action: 'HOLD', at: c.event_time_utc };
    };
    runEventLoop({
      config,
      candles: [
        mkCandle('2026-01-01T00:00:00Z', 100),
        mkCandle('2026-01-01T01:00:00Z', 101),
        mkCandle('2026-01-01T02:00:00Z', 102),
      ],
      strategy,
    });
    expect(seenLengths).toEqual([1, 2, 3]);
  });

  it('strategy context.current_time = candle close time', () => {
    const seen: string[] = [];
    const strategy: Strategy = (c, ctx) => {
      seen.push(ctx.current_time);
      return { action: 'HOLD', at: c.event_time_utc };
    };
    runEventLoop({
      config,
      candles: [mkCandle('2026-01-01T00:00:00Z', 100)],
      strategy,
    });
    expect(seen).toEqual(['2026-01-01T01:00:00.000Z']);
  });

  it('events preserve candle reference and close_time', () => {
    const c = mkCandle('2026-01-01T00:00:00Z', 100);
    const r = runEventLoop({ config, candles: [c], strategy: holdStrategy });
    expect(r.events[0]!.candle).toBe(c);
    expect(r.events[0]!.close_time).toBe('2026-01-01T01:00:00.000Z');
  });

  it('timeframe mismatch ? throws', () => {
    const wrong = mkCandle('2026-01-01T00:00:00Z', 100, '5m' as any);
    expect(() =>
      runEventLoop({ config, candles: [wrong], strategy: holdStrategy }),
    ).toThrow(/timeframe mismatch/);
  });

  it('explicit candle_close_time_utc wins over event_time + tf', () => {
    // event opens 00:00 (1h tf ? default close 01:00), but override says 05:00
    const c = mkCandle('2026-01-01T00:00:00Z', 100, '1h', '2026-01-01T05:00:00Z');
    const r = runEventLoop({ config, candles: [c], strategy: holdStrategy });
    expect(r.events[0]!.close_time).toBe('2026-01-01T05:00:00Z');
  });

  it('signal action types flow through', () => {
    let idx = 0;
    const actions: Signal['action'][] = ['OPEN_LONG', 'CLOSE', 'HOLD'];
    const strat: Strategy = (c) => ({
      action: actions[idx++] ?? 'HOLD',
      at: c.event_time_utc,
    });
    const r = runEventLoop({
      config,
      candles: [
        mkCandle('2026-01-01T00:00:00Z', 100),
        mkCandle('2026-01-01T01:00:00Z', 101),
        mkCandle('2026-01-01T02:00:00Z', 102),
      ],
      strategy: strat,
    });
    expect(r.events.map((e) => e.signal.action)).toEqual(['OPEN_LONG', 'CLOSE', 'HOLD']);
  });
});
