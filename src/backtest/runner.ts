import type { CanonicalCandle } from '../normalization/canonical';
import type { BacktestConfig, BacktestResult } from './types';
import { runEventLoop, type Strategy } from './event-loop';
import { runExecution } from './execution';
import { computeMetrics } from './metrics';

export interface RunBacktestOptions {
  readonly config: BacktestConfig;
  readonly candles: ReadonlyArray<CanonicalCandle>;
  readonly strategy: Strategy;
  /** Optional gap classifier ? must be injected from outside (e.g. classifyGap wrapper). */
  readonly isInGap?: (candle: CanonicalCandle) => boolean;
  /** Override for deterministic tests. Defaults to new Date().toISOString(). */
  readonly ranAt?: string;
}

export function runBacktest(opts: RunBacktestOptions): BacktestResult {
  const loop = runEventLoop({
    config: opts.config,
    candles: opts.candles,
    strategy: opts.strategy,
    ...(opts.isInGap !== undefined ? { isInGap: opts.isInGap } : {}),
  });

  const exec = runExecution({
    config: opts.config,
    events: loop.events,
  });

  const metrics = computeMetrics({
    trades: exec.trades,
    equity_curve: exec.equity_curve,
    initial_capital: opts.config.initial_capital,
    final_equity: exec.final_equity,
  });

  return {
    config_version: opts.config.version,
    ran_at: opts.ranAt ?? new Date().toISOString(),
    from_utc: opts.config.from_utc,
    to_utc: opts.config.to_utc,
    candles_processed: loop.candles_processed,
    candles_skipped_gap: loop.candles_skipped_gap,
    candles_skipped_not_final: loop.candles_skipped_not_final,
    trades: exec.trades,
    equity_curve: exec.equity_curve,
    final_equity: exec.final_equity,
    metrics,
  };
}
