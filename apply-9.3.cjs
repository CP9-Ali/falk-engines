const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// ????????? [1/2] metrics.ts ?????????
fs.writeFileSync('src/backtest/metrics.ts', `import type { Trade, EquityPoint, BacktestMetrics } from './types';

export interface ComputeMetricsInput {
  readonly trades: ReadonlyArray<Trade>;
  readonly equity_curve: ReadonlyArray<EquityPoint>;
  readonly initial_capital: number;
  readonly final_equity: number;
}

function mean(arr: ReadonlyArray<number>): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function sampleStdDev(arr: ReadonlyArray<number>): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  let s = 0;
  for (const v of arr) s += (v - m) * (v - m);
  return Math.sqrt(s / (arr.length - 1));
}

function holdDurationMs(t: Trade): number {
  return new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime();
}

export function computeMetrics(input: ComputeMetricsInput): BacktestMetrics {
  const { trades, equity_curve, initial_capital, final_equity } = input;

  const total_trades = trades.length;
  const wins = trades.filter((t) => t.outcome === 'WIN').length;
  const losses = trades.filter((t) => t.outcome === 'LOSS').length;
  const breakevens = trades.filter((t) => t.outcome === 'BREAKEVEN').length;

  const win_rate = total_trades === 0 ? 0 : wins / total_trades;

  let sum_win = 0;
  let sum_loss_abs = 0;
  let total_fees_abs = 0;
  for (const t of trades) {
    if (t.pnl_abs > 0) sum_win += t.pnl_abs;
    else if (t.pnl_abs < 0) sum_loss_abs += -t.pnl_abs;
    total_fees_abs += t.fees_abs;
  }

  const profit_factor: number | null =
    sum_loss_abs === 0 ? null : sum_win / sum_loss_abs;

  let max_drawdown_pct = 0;
  for (const p of equity_curve) {
    if (p.drawdown_pct > max_drawdown_pct) max_drawdown_pct = p.drawdown_pct;
  }

  // Per-trade returns for Sharpe / Sortino.
  const returns = trades.map((t) => t.pnl_pct);
  let sharpe_ratio: number | null = null;
  let sortino_ratio: number | null = null;
  if (returns.length >= 2) {
    const m = mean(returns);
    const sd = sampleStdDev(returns);
    if (sd > 0) sharpe_ratio = m / sd;

    const downside = returns.filter((r) => r < 0);
    if (downside.length >= 1) {
      let ds = 0;
      for (const r of downside) ds += r * r;
      const downside_std = Math.sqrt(ds / downside.length);
      if (downside_std > 0) sortino_ratio = m / downside_std;
    }
  }

  let avg_hold_duration_ms: number | null = null;
  if (total_trades > 0) {
    let s = 0;
    for (const t of trades) s += holdDurationMs(t);
    avg_hold_duration_ms = s / total_trades;
  }

  const total_pnl_abs = final_equity - initial_capital;
  const total_pnl_pct = initial_capital === 0 ? 0 : total_pnl_abs / initial_capital;

  return {
    total_trades,
    wins,
    losses,
    breakevens,
    win_rate,
    profit_factor,
    max_drawdown_pct,
    sharpe_ratio,
    sortino_ratio,
    total_pnl_abs,
    total_pnl_pct,
    total_fees_abs,
    avg_hold_duration_ms,
  };
}
`, 'utf8');
ok('metrics.ts');

// ????????? [2/2] test file ?????????
fs.writeFileSync('src/tests/backtest-metrics.test.ts', `import { describe, it, expect } from 'vitest';
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
`, 'utf8');
ok('backtest-metrics.test.ts');

console.log('\nDONE. ?9.3 files written.');
