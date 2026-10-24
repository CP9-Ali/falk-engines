import type { Trade, EquityPoint, BacktestMetrics } from './types';

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
