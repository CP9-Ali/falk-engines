import { describe, it, expect } from 'vitest';
import { computeMetrics } from '../backtest/metrics';
import type { Trade, EquityPoint } from '../backtest/types';

function mkTrade(over: Partial<Trade> = {}): Trade {
  return {
    id: 't-1',
    side: 'BUY',
    opened_at: '2026-01-01T00:00:00Z',
    closed_at: '2026-01-01T01:00:00Z',
    entry_price: 2000,
    exit_price: 2010,
    size: 1,
    pnl_abs: 10,
    pnl_pct: 0.005,
    fees_abs: 0,
    slippage_abs: 0,
    outcome: 'WIN',
    ...over,
  };
}

const baseEquity: EquityPoint[] = [
  { time: '2026-01-01T00:00:00Z', equity: 10_000, drawdown_pct: 0 },
];

describe('?9.3 ? computeMetrics ? counts', () => {
  it('empty trades', () => {
    const m = computeMetrics({
      trades: [], equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_000,
    });
    expect(m.total_trades).toBe(0);
    expect(m.wins).toBe(0);
    expect(m.losses).toBe(0);
    expect(m.breakevens).toBe(0);
    expect(m.win_rate).toBe(0);
  });

  it('mixed outcomes counted correctly', () => {
    const m = computeMetrics({
      trades: [
        mkTrade({ outcome: 'WIN', pnl_abs: 10 }),
        mkTrade({ outcome: 'WIN', pnl_abs: 5 }),
        mkTrade({ outcome: 'LOSS', pnl_abs: -3 }),
        mkTrade({ outcome: 'BREAKEVEN', pnl_abs: 0 }),
      ],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_012,
    });
    expect(m.total_trades).toBe(4);
    expect(m.wins).toBe(2);
    expect(m.losses).toBe(1);
    expect(m.breakevens).toBe(1);
    expect(m.win_rate).toBe(0.5);
  });
});

describe('?9.3 ? profit_factor', () => {
  it('null when no losses', () => {
    const m = computeMetrics({
      trades: [mkTrade({ pnl_abs: 10 }), mkTrade({ pnl_abs: 5 })],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_015,
    });
    expect(m.profit_factor).toBeNull();
  });

  it('sum(win) / |sum(loss)|', () => {
    const m = computeMetrics({
      trades: [
        mkTrade({ pnl_abs: 30, outcome: 'WIN' }),
        mkTrade({ pnl_abs: 10, outcome: 'WIN' }),
        mkTrade({ pnl_abs: -20, outcome: 'LOSS' }),
      ],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_020,
    });
    expect(m.profit_factor).toBe(2);   // 40 / 20
  });

  it('breakeven does not count in profit_factor', () => {
    const m = computeMetrics({
      trades: [
        mkTrade({ pnl_abs: 10, outcome: 'WIN' }),
        mkTrade({ pnl_abs: 0, outcome: 'BREAKEVEN' }),
        mkTrade({ pnl_abs: -10, outcome: 'LOSS' }),
      ],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_000,
    });
    expect(m.profit_factor).toBe(1);
  });
});

describe('?9.3 ? max_drawdown_pct', () => {
  it('0 for empty equity curve', () => {
    const m = computeMetrics({
      trades: [], equity_curve: [],
      initial_capital: 10_000, final_equity: 10_000,
    });
    expect(m.max_drawdown_pct).toBe(0);
  });

  it('picks max from equity curve', () => {
    const ec: EquityPoint[] = [
      { time: 'a', equity: 10_000, drawdown_pct: 0 },
      { time: 'b', equity: 9_500, drawdown_pct: 5 },
      { time: 'c', equity: 9_200, drawdown_pct: 8 },
      { time: 'd', equity: 10_100, drawdown_pct: 0 },
    ];
    const m = computeMetrics({
      trades: [], equity_curve: ec,
      initial_capital: 10_000, final_equity: 10_100,
    });
    expect(m.max_drawdown_pct).toBe(8);
  });
});

describe('?9.3 ? sharpe and sortino', () => {
  it('both null with fewer than 2 trades', () => {
    const m = computeMetrics({
      trades: [mkTrade()], equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_010,
    });
    expect(m.sharpe_ratio).toBeNull();
    expect(m.sortino_ratio).toBeNull();
  });

  it('sharpe null when std = 0 (identical returns)', () => {
    const m = computeMetrics({
      trades: [
        mkTrade({ pnl_pct: 0.01 }),
        mkTrade({ pnl_pct: 0.01 }),
        mkTrade({ pnl_pct: 0.01 }),
      ],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_300,
    });
    expect(m.sharpe_ratio).toBeNull();
  });

  it('sortino null when no negative returns', () => {
    const m = computeMetrics({
      trades: [
        mkTrade({ pnl_pct: 0.01 }),
        mkTrade({ pnl_pct: 0.02 }),
      ],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_300,
    });
    expect(m.sortino_ratio).toBeNull();
  });

  it('sharpe computed from per-trade returns', () => {
    const m = computeMetrics({
      trades: [
        mkTrade({ pnl_pct: 0.02 }),
        mkTrade({ pnl_pct: -0.01 }),
        mkTrade({ pnl_pct: 0.01 }),
      ],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_200,
    });
    expect(m.sharpe_ratio).not.toBeNull();
    expect(typeof m.sharpe_ratio).toBe('number');
  });

  it('sortino computed when downside exists', () => {
    const m = computeMetrics({
      trades: [
        mkTrade({ pnl_pct: 0.02 }),
        mkTrade({ pnl_pct: -0.01 }),
        mkTrade({ pnl_pct: 0.01 }),
      ],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_200,
    });
    expect(m.sortino_ratio).not.toBeNull();
  });
});

describe('?9.3 ? hold duration', () => {
  it('null with no trades', () => {
    const m = computeMetrics({
      trades: [], equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_000,
    });
    expect(m.avg_hold_duration_ms).toBeNull();
  });

  it('averages hold durations', () => {
    const m = computeMetrics({
      trades: [
        mkTrade({
          opened_at: '2026-01-01T00:00:00Z',
          closed_at: '2026-01-01T01:00:00Z',   // 1h
        }),
        mkTrade({
          opened_at: '2026-01-02T00:00:00Z',
          closed_at: '2026-01-02T03:00:00Z',   // 3h
        }),
      ],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_020,
    });
    expect(m.avg_hold_duration_ms).toBe(2 * 3_600_000);   // avg of 1h, 3h = 2h
  });
});

describe('?9.3 ? pnl and fees totals', () => {
  it('total_pnl_abs = final ? initial', () => {
    const m = computeMetrics({
      trades: [],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_250,
    });
    expect(m.total_pnl_abs).toBe(250);
    expect(m.total_pnl_pct).toBe(0.025);
  });

  it('negative pnl', () => {
    const m = computeMetrics({
      trades: [],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 9_500,
    });
    expect(m.total_pnl_abs).toBe(-500);
    expect(m.total_pnl_pct).toBe(-0.05);
  });

  it('total_fees_abs sums all trades', () => {
    const m = computeMetrics({
      trades: [
        mkTrade({ fees_abs: 1.5 }),
        mkTrade({ fees_abs: 2.5 }),
      ],
      equity_curve: baseEquity,
      initial_capital: 10_000, final_equity: 10_000,
    });
    expect(m.total_fees_abs).toBe(4);
  });

  it('initial_capital zero ? total_pnl_pct 0 (no div by zero)', () => {
    const m = computeMetrics({
      trades: [], equity_curve: baseEquity,
      initial_capital: 0, final_equity: 100,
    });
    expect(m.total_pnl_pct).toBe(0);
  });
});
