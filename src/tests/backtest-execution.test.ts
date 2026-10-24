import { describe, it, expect } from 'vitest';
import { runExecution } from '../backtest/execution';
import type { SignalEvent } from '../backtest/event-loop';
import type { BacktestConfig, SignalAction } from '../backtest/types';
import type { CanonicalCandle } from '../normalization/canonical';

function mkCandle(openIso: string, close: number, closeTime: string): CanonicalCandle {
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

function ev(action: SignalAction, openIso: string, close: number, closeTime: string, reason?: string): SignalEvent {
  const c = mkCandle(openIso, close, closeTime);
  return {
    signal: { action, at: openIso, ...(reason !== undefined ? { reason } : {}) },
    candle: c,
    close_time: closeTime,
  };
}

const config: BacktestConfig = {
  version: 'bt-v1', symbol: 'XAUUSD', timeframe: '1h',
  from_utc: '2026-01-01T00:00:00Z', to_utc: '2026-01-02T00:00:00Z',
  initial_capital: 10_000, fees_bps: 0, slippage_bps: 0,
  allow_reentry_same_bar: false,
};

describe('?9.2 ? runExecution basics', () => {
  it('empty events ? initial capital only', () => {
    const r = runExecution({ config, events: [] });
    expect(r.trades).toEqual([]);
    expect(r.equity_curve).toHaveLength(1);
    expect(r.final_equity).toBe(10_000);
  });

  it('HOLD only ? no trades', () => {
    const r = runExecution({ config, events: [
      ev('HOLD', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('HOLD', '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(0);
    expect(r.final_equity).toBe(10_000);
  });

  it('OPEN_LONG then CLOSE with profit', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.outcome).toBe('WIN');
    expect(r.trades[0]!.entry_price).toBe(2000);
    expect(r.trades[0]!.exit_price).toBe(2010);
    expect(r.final_equity).toBeGreaterThan(10_000);
  });

  it('OPEN_SHORT then CLOSE with profit on price drop', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_SHORT', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',      '2026-01-01T01:00:00Z', 1990, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.outcome).toBe('WIN');
    expect(r.trades[0]!.pnl_abs).toBeGreaterThan(0);
  });

  it('OPEN_SHORT loses when price rises', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_SHORT', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',      '2026-01-01T01:00:00Z', 2020, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.outcome).toBe('LOSS');
    expect(r.trades[0]!.pnl_abs).toBeLessThan(0);
  });
});

describe('?9.2 ? slippage and fees', () => {
  it('slippage increases BUY entry, decreases BUY exit', () => {
    const cfg = { ...config, slippage_bps: 10 };   // 0.1%
    const r = runExecution({ config: cfg, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.entry_price).toBeCloseTo(2002, 5);   // 2000 * 1.001
    expect(r.trades[0]!.exit_price).toBeCloseTo(2007.99, 2); // 2010 * 0.999
    expect(r.trades[0]!.slippage_abs).toBeGreaterThan(0);
  });

  it('slippage decreases SELL entry, increases SELL exit', () => {
    const cfg = { ...config, slippage_bps: 10 };
    const r = runExecution({ config: cfg, events: [
      ev('OPEN_SHORT', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',      '2026-01-01T01:00:00Z', 1990, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.entry_price).toBeCloseTo(1998, 5);   // 2000 * 0.999
    expect(r.trades[0]!.exit_price).toBeCloseTo(1991.99, 2); // 1990 * 1.001
  });

  it('fees reduce pnl and appear in fees_abs', () => {
    const cfg = { ...config, fees_bps: 2 };   // 2 bps round-trip
    const r = runExecution({ config: cfg, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2000, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.fees_abs).toBeGreaterThan(0);
    expect(r.trades[0]!.pnl_abs).toBeLessThan(0);   // no price change, fees eat
    expect(r.trades[0]!.outcome).toBe('LOSS');
  });
});

describe('?9.2 ? position sizing and ignored signals', () => {
  it('max_position_size_pct halves the size', () => {
    const cfg = { ...config, max_position_size_pct: 0.5 };
    const full = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    const half = runExecution({ config: cfg, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(half.trades[0]!.size).toBeCloseTo(full.trades[0]!.size / 2, 5);
    expect(half.final_equity).toBeLessThan(full.final_equity);
  });

  it('OPEN_LONG with position open ? ignored', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('OPEN_LONG', '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
      ev('CLOSE',     '2026-01-01T02:00:00Z', 2020, '2026-01-01T03:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.entry_price).toBe(2000);
  });

  it('CLOSE without position ? ignored', () => {
    const r = runExecution({ config, events: [
      ev('CLOSE', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(0);
  });
});

describe('?9.2 ? end-of-backtest forced close', () => {
  it('open position at end is closed with END_OF_BACKTEST', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.reason_close).toBe('END_OF_BACKTEST');
    expect(r.open_position_at_end).toBe(true);
  });

  it('closed positions before end ? open_position_at_end false', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.open_position_at_end).toBe(false);
  });
});

describe('?9.2 ? equity curve and drawdown', () => {
  it('equity_curve starts at initial capital', () => {
    const r = runExecution({ config, events: [
      ev('HOLD', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
    ]});
    expect(r.equity_curve[0]!.equity).toBe(10_000);
    expect(r.equity_curve[0]!.drawdown_pct).toBe(0);
  });

  it('winning trade ? no drawdown', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.equity_curve[r.equity_curve.length - 1]!.drawdown_pct).toBe(0);
  });

  it('losing trade ? positive drawdown', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 1990, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.equity_curve[r.equity_curve.length - 1]!.drawdown_pct).toBeGreaterThan(0);
  });

  it('multiple trades produce multiple equity points', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
      ev('OPEN_LONG', '2026-01-01T02:00:00Z', 2010, '2026-01-01T03:00:00Z'),
      ev('CLOSE',     '2026-01-01T03:00:00Z', 2005, '2026-01-01T04:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(2);
    expect(r.equity_curve).toHaveLength(3);   // initial + 2 closes
  });
});

describe('?9.2 ? misc', () => {
  it('lineage_ids captured from open candle', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.lineage_ids).toEqual(['lin-2026-01-01T00:00:00Z']);
  });

  it('breakeven when price unchanged and no fees', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2000, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.outcome).toBe('BREAKEVEN');
  });

  it('trade ids are sequential', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
      ev('OPEN_LONG', '2026-01-01T02:00:00Z', 2010, '2026-01-01T03:00:00Z'),
      ev('CLOSE',     '2026-01-01T03:00:00Z', 2020, '2026-01-01T04:00:00Z'),
    ]});
    expect(r.trades[0]!.id).toBe('trade-000001');
    expect(r.trades[1]!.id).toBe('trade-000002');
  });
});
