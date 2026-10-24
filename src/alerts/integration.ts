import type { RouterDispatchResult, AlertRouter } from './router';
import type { BacktestResult } from '../backtest/types';
import type { EnrichedFusionResult } from '../data-fusion/enrich';
import type { RunBacktestOptions } from '../backtest/runner';
import { runBacktest } from '../backtest/runner';
import { evaluateBacktest, evaluateFusion, evaluateQuality } from './rules';
import type { BacktestRulesConfig, FusionRulesConfig, QualityCheckInput, QualityRulesConfig } from './rules';

// ?? Backtest + alerts ??????????????????????????????????????????
export interface BacktestWithAlerts {
  readonly backtest: BacktestResult;
  readonly alerts: ReadonlyArray<RouterDispatchResult>;
}

export async function runBacktestAndAlert(
  opts: RunBacktestOptions,
  router: AlertRouter,
  rules?: BacktestRulesConfig,
): Promise<BacktestWithAlerts> {
  const backtest = runBacktest(opts);
  const alerts = evaluateBacktest(backtest, rules);
  const results = await router.dispatchMany(alerts);
  return { backtest, alerts: results };
}

// ?? Fusion + alerts ????????????????????????????????????????????
export interface FusionWithAlerts<T> {
  readonly enriched: EnrichedFusionResult<T>;
  readonly alerts: ReadonlyArray<RouterDispatchResult>;
}

export async function enrichFusionAndAlert<T>(
  enriched: EnrichedFusionResult<T>,
  router: AlertRouter,
  rules?: FusionRulesConfig,
): Promise<FusionWithAlerts<T>> {
  const alerts = evaluateFusion(enriched as unknown as EnrichedFusionResult<unknown>, rules);
  const results = await router.dispatchMany(alerts);
  return { enriched, alerts: results };
}

// ?? Quality + alerts ??????????????????????????????????????????
export interface QualityWithAlerts {
  readonly alerts: ReadonlyArray<RouterDispatchResult>;
}

export async function evaluateQualityAndAlert(
  checks: ReadonlyArray<QualityCheckInput>,
  router: AlertRouter,
  cfg?: QualityRulesConfig,
): Promise<QualityWithAlerts> {
  const alerts = evaluateQuality(checks, cfg);
  const results = await router.dispatchMany(alerts);
  return { alerts: results };
}
