const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// ????????? [1/2] backtest/types.ts ?????????
fs.mkdirSync('src/backtest', { recursive: true });
fs.writeFileSync('src/backtest/types.ts', `// ?9.0 ? Backtesting interfaces (no runtime deps)

export type Side = 'BUY' | 'SELL';

export type SignalAction = 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE' | 'HOLD';

export type TradeOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN';

export interface Signal {
  readonly action: SignalAction;
  /** event_time_utc of the candle that produced this signal. */
  readonly at: string;
  /** Optional price hint from strategy; execution may differ due to slippage. */
  readonly price_hint?: number;
  /** Human-readable audit note. */
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Position {
  readonly side: Side;
  readonly opened_at: string;
  readonly entry_price: number;
  readonly size: number;
  readonly stop_loss?: number;
  readonly take_profit?: number;
}

export interface Trade {
  readonly id: string;
  readonly side: Side;
  readonly opened_at: string;
  readonly closed_at: string;
  readonly entry_price: number;
  readonly exit_price: number;
  readonly size: number;
  readonly pnl_abs: number;
  readonly pnl_pct: number;
  readonly fees_abs: number;
  readonly slippage_abs: number;
  readonly outcome: TradeOutcome;
  readonly reason_open?: string;
  readonly reason_close?: string;
  readonly lineage_ids?: ReadonlyArray<string>;
}

export interface EquityPoint {
  readonly time: string;
  readonly equity: number;
  readonly drawdown_pct: number;
}

export interface BacktestConfig {
  readonly version: string;
  readonly symbol: 'XAUUSD';
  readonly timeframe: '1m' | '5m' | '15m' | '1h' | 'H3' | '4h' | '1d' | '1w';
  readonly from_utc: string;
  readonly to_utc: string;
  readonly initial_capital: number;
  /** Round-trip fees in basis points. 0 = disabled. */
  readonly fees_bps: number;
  /** Per-side slippage in basis points. 0 = disabled. */
  readonly slippage_bps: number;
  /** Cap on notional / capital per position. 1.0 = full capital. */
  readonly max_position_size_pct?: number;
  /** When false, a CLOSE signal does not allow re-entry on the same bar. */
  readonly allow_reentry_same_bar: boolean;
}

export interface BacktestMetrics {
  readonly total_trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly breakevens: number;
  readonly win_rate: number;
  readonly profit_factor: number | null;
  readonly max_drawdown_pct: number;
  readonly sharpe_ratio: number | null;
  readonly sortino_ratio: number | null;
  readonly total_pnl_abs: number;
  readonly total_pnl_pct: number;
  readonly total_fees_abs: number;
  readonly avg_hold_duration_ms: number | null;
}

export interface BacktestResult {
  readonly config_version: string;
  readonly ran_at: string;
  readonly from_utc: string;
  readonly to_utc: string;
  readonly candles_processed: number;
  readonly candles_skipped_gap: number;
  readonly candles_skipped_not_final: number;
  readonly trades: ReadonlyArray<Trade>;
  readonly equity_curve: ReadonlyArray<EquityPoint>;
  readonly final_equity: number;
  readonly metrics: BacktestMetrics;
}
`, 'utf8');
ok('src/backtest/types.ts');

// ????????? [2/2] test file ?????????
fs.writeFileSync('src/tests/backtest-types.test.ts', `import { describe, it, expect } from 'vitest';
import type {
  Side,
  SignalAction,
  TradeOutcome,
  Signal,
  Position,
  Trade,
  EquityPoint,
  BacktestConfig,
  BacktestMetrics,
  BacktestResult,
} from '../backtest/types';

describe('?9.0 ? backtest type contracts', () => {
  it('Side union covers BUY and SELL', () => {
    const sides: Side[] = ['BUY', 'SELL'];
    expect(sides).toHaveLength(2);
  });

  it('SignalAction union is exhaustive', () => {
    const actions: SignalAction[] = ['OPEN_LONG', 'OPEN_SHORT', 'CLOSE', 'HOLD'];
    expect(new Set(actions).size).toBe(4);
  });

  it('TradeOutcome union has 3 outcomes', () => {
    const outcomes: TradeOutcome[] = ['WIN', 'LOSS', 'BREAKEVEN'];
    expect(outcomes).toHaveLength(3);
  });

  it('Signal minimal shape compiles and round-trips', () => {
    const s: Signal = { action: 'HOLD', at: '2026-01-01T00:00:00Z' };
    expect(s.action).toBe('HOLD');
    expect(s.at).toBe('2026-01-01T00:00:00Z');
    expect(s.price_hint).toBeUndefined();
  });

  it('Signal with all fields', () => {
    const s: Signal = {
      action: 'OPEN_LONG',
      at: '2026-01-01T00:00:00Z',
      price_hint: 2000,
      reason: 'sma_cross_up',
      metadata: { sma20: 1999.5, sma50: 1998.2 },
    };
    expect(s.metadata).toEqual({ sma20: 1999.5, sma50: 1998.2 });
  });

  it('Position shape', () => {
    const p: Position = {
      side: 'BUY',
      opened_at: '2026-01-01T00:00:00Z',
      entry_price: 2000,
      size: 1,
    };
    expect(p.stop_loss).toBeUndefined();
  });

  it('Trade shape with required fields', () => {
    const t: Trade = {
      id: 'trade-1',
      side: 'BUY',
      opened_at: '2026-01-01T00:00:00Z',
      closed_at: '2026-01-01T00:05:00Z',
      entry_price: 2000,
      exit_price: 2010,
      size: 1,
      pnl_abs: 10,
      pnl_pct: 0.005,
      fees_abs: 0.2,
      slippage_abs: 0,
      outcome: 'WIN',
    };
    expect(t.pnl_abs).toBe(10);
    expect(t.lineage_ids).toBeUndefined();
  });

  it('BacktestConfig enforces timeframe union', () => {
    const c: BacktestConfig = {
      version: 'bt-v1',
      symbol: 'XAUUSD',
      timeframe: '1h',
      from_utc: '2026-01-01T00:00:00Z',
      to_utc: '2026-06-30T00:00:00Z',
      initial_capital: 10_000,
      fees_bps: 2,
      slippage_bps: 1,
      allow_reentry_same_bar: false,
    };
    expect(c.timeframe).toBe('1h');
  });

  it('BacktestMetrics nullable fields honored', () => {
    const m: BacktestMetrics = {
      total_trades: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      win_rate: 0,
      profit_factor: null,
      max_drawdown_pct: 0,
      sharpe_ratio: null,
      sortino_ratio: null,
      total_pnl_abs: 0,
      total_pnl_pct: 0,
      total_fees_abs: 0,
      avg_hold_duration_ms: null,
    };
    expect(m.profit_factor).toBeNull();
    expect(m.sharpe_ratio).toBeNull();
  });

  it('BacktestResult shape with empty run', () => {
    const r: BacktestResult = {
      config_version: 'bt-v1',
      ran_at: '2026-10-24T00:00:00Z',
      from_utc: '2026-01-01T00:00:00Z',
      to_utc: '2026-01-02T00:00:00Z',
      candles_processed: 0,
      candles_skipped_gap: 0,
      candles_skipped_not_final: 0,
      trades: [],
      equity_curve: [],
      final_equity: 10_000,
      metrics: {
        total_trades: 0, wins: 0, losses: 0, breakevens: 0, win_rate: 0,
        profit_factor: null, max_drawdown_pct: 0, sharpe_ratio: null, sortino_ratio: null,
        total_pnl_abs: 0, total_pnl_pct: 0, total_fees_abs: 0, avg_hold_duration_ms: null,
      },
    };
    expect(r.trades).toEqual([]);
    expect(r.equity_curve).toEqual([]);
  });

  it('EquityPoint has drawdown_pct', () => {
    const e: EquityPoint = { time: '2026-01-01T00:00:00Z', equity: 10_000, drawdown_pct: 0 };
    expect(e.drawdown_pct).toBe(0);
  });
});
`, 'utf8');
ok('src/tests/backtest-types.test.ts');

console.log('\nDONE. ?9.0 files written.');
