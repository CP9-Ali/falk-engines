import { describe, it, expect } from 'vitest';
import { runBacktest } from '../backtest/runner';
import type { Strategy } from '../backtest/event-loop';
import type { BacktestConfig } from '../backtest/types';
import type { CanonicalCandle } from '../normalization/canonical';

function mkCandle(openIso: string, close: number): CanonicalCandle {
  return {
    source_id: 'test', source_symbol: 'XAUUSD', canonical_symbol: 'XAUUSD',
    instrument_type: 'spot', price_source: 't', quote_currency: 'USD', base_currency: 'XAU',
    timeframe: '1h', event_time_utc: openIso, source_timestamp: openIso,
    source_timezone: 'UTC', source_timezone_status: 'RESOLVED', time_blocked: false,
    arrival_time_utc: openIso, availability_time_utc: openIso,
    open: close, high: close, low: close, close,
    volume_value: null, volume_semantics: 'UNKNOWN',
    raw_fingerprint: 'fp-' + openIso, lineage_id: 'lin-' + openIso,
    raw_payload_ref: 'raw-' + openIso, normalization_version: 'nv1', processing_version: 'pv1',
  } as any;
}

const config: BacktestConfig = {
  version: 'bt-v1', symbol: 'XAUUSD', timeframe: '1h',
  from_utc: '2026-01-01T00:00:00Z', to_utc: '2026-01-02T00:00:00Z',
  initial_capital: 10_000, fees_bps: 0, slippage_bps: 0,
  allow_reentry_same_bar: false,
};

// Alternating strategy: OPEN_LONG on even index, CLOSE on odd index.
function alternatingStrategy(): Strategy {
  let i = 0;
  return (c) => {
    const isEven = i % 2 === 0;
    i += 1;
    return { action: isEven ? 'OPEN_LONG' : 'CLOSE', at: c.event_time_utc };
  };
}

describe('?9.4 ? runBacktest integration', () => {
  it('empty candles ? empty result with initial capital', () => {
    const r = runBacktest({
      config,
      candles: [],
      strategy: () => ({ action: 'HOLD', at: 'x' }),
      ranAt: '2026-01-01T00:00:00Z',
    });
    expect(r.candles_processed).toBe(0);
    expect(r.trades).toEqual([]);
    expect(r.final_equity).toBe(10_000);
    expect(r.metrics.total_trades).toBe(0);
    expect(r.config_version).toBe('bt-v1');
    expect(r.ran_at).toBe('2026-01-01T00:00:00Z');
  });

  it('HOLD strategy ? no trades, capital preserved', () => {
    const candles = [
      mkCandle('2026-01-01T00:00:00Z', 2000),
      mkCandle('2026-01-01T01:00:00Z', 2010),
    ];
    const r = runBacktest({
      config, candles,
      strategy: (c) => ({ action: 'HOLD', at: c.event_time_utc }),
    });
    expect(r.candles_processed).toBe(2);
    expect(r.trades).toHaveLength(0);
    expect(r.final_equity).toBe(10_000);
    expect(r.equity_curve).toHaveLength(1);
  });

  it('open + close with profit ? end-to-end metrics', () => {
    const candles = [
      mkCandle('2026-01-01T00:00:00Z', 2000),
      mkCandle('2026-01-01T01:00:00Z', 2010),
    ];
    const r = runBacktest({ config, candles, strategy: alternatingStrategy() });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.outcome).toBe('WIN');
    expect(r.final_equity).toBeGreaterThan(10_000);
    expect(r.metrics.total_trades).toBe(1);
    expect(r.metrics.wins).toBe(1);
    expect(r.metrics.win_rate).toBe(1);
  });

  it('two winning trades ? total_pnl_abs = final ? initial', () => {
    const candles = [
      mkCandle('2026-01-01T00:00:00Z', 2000),
      mkCandle('2026-01-01T01:00:00Z', 2010),
      mkCandle('2026-01-01T02:00:00Z', 2010),
      mkCandle('2026-01-01T03:00:00Z', 2020),
    ];
    const r = runBacktest({ config, candles, strategy: alternatingStrategy() });
    expect(r.trades).toHaveLength(2);
    expect(r.metrics.total_trades).toBe(2);
    expect(r.metrics.total_pnl_abs).toBeCloseTo(r.final_equity - 10_000, 6);
  });

  it('isInGap skips matching candles', () => {
    const candles = [
      mkCandle('2026-01-01T00:00:00Z', 2000),
      mkCandle('2026-01-01T01:00:00Z', 2010),
      mkCandle('2026-01-01T02:00:00Z', 2020),
    ];
    const r = runBacktest({
      config, candles,
      strategy: (c) => ({ action: 'HOLD', at: c.event_time_utc }),
      isInGap: (c) => c.event_time_utc === '2026-01-01T01:00:00Z',
    });
    expect(r.candles_processed).toBe(2);
    expect(r.candles_skipped_gap).toBe(1);
  });

  it('losing trade ? negative pnl, drawdown > 0', () => {
    const candles = [
      mkCandle('2026-01-01T00:00:00Z', 2000),
      mkCandle('2026-01-01T01:00:00Z', 1990),
    ];
    const r = runBacktest({ config, candles, strategy: alternatingStrategy() });
    expect(r.trades[0]!.outcome).toBe('LOSS');
    expect(r.metrics.total_pnl_abs).toBeLessThan(0);
    expect(r.metrics.max_drawdown_pct).toBeGreaterThan(0);
  });

  it('open position at end ? forced close recorded', () => {
    const candles = [
      mkCandle('2026-01-01T00:00:00Z', 2000),
      mkCandle('2026-01-01T01:00:00Z', 2010),
      mkCandle('2026-01-01T02:00:00Z', 2020),
    ];
    const r = runBacktest({
      config, candles,
      strategy: (c) => ({ action: 'OPEN_LONG', at: c.event_time_utc }),
    });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.reason_close).toBe('END_OF_BACKTEST');
  });

  it('config_version and dates are carried through', () => {
    const r = runBacktest({
      config, candles: [],
      strategy: () => ({ action: 'HOLD', at: 'x' }),
      ranAt: '2026-10-24T12:00:00Z',
    });
    expect(r.config_version).toBe('bt-v1');
    expect(r.from_utc).toBe('2026-01-01T00:00:00Z');
    expect(r.to_utc).toBe('2026-01-02T00:00:00Z');
    expect(r.ran_at).toBe('2026-10-24T12:00:00Z');
  });

  it('timeframe mismatch propagates error', () => {
    const wrong = { ...mkCandle('2026-01-01T00:00:00Z', 2000), timeframe: '5m' } as any;
    expect(() => runBacktest({
      config, candles: [wrong],
      strategy: () => ({ action: 'HOLD', at: 'x' }),
    })).toThrow(/timeframe mismatch/);
  });

  it('fees applied at round-trip level', () => {
    const cfg = { ...config, fees_bps: 5 };
    const candles = [
      mkCandle('2026-01-01T00:00:00Z', 2000),
      mkCandle('2026-01-01T01:00:00Z', 2000),   // no price change
    ];
    const r = runBacktest({ config: cfg, candles, strategy: alternatingStrategy() });
    expect(r.trades[0]!.fees_abs).toBeGreaterThan(0);
    expect(r.trades[0]!.pnl_abs).toBeLessThan(0);   // fees eat
    expect(r.metrics.total_fees_abs).toBeGreaterThan(0);
  });

  it('equity_curve matches trades count + 1', () => {
    const candles = [
      mkCandle('2026-01-01T00:00:00Z', 2000),
      mkCandle('2026-01-01T01:00:00Z', 2010),
      mkCandle('2026-01-01T02:00:00Z', 2010),
      mkCandle('2026-01-01T03:00:00Z', 2005),
    ];
    const r = runBacktest({ config, candles, strategy: alternatingStrategy() });
    expect(r.trades).toHaveLength(2);
    expect(r.equity_curve).toHaveLength(3);   // initial + 2 closes
  });
});
