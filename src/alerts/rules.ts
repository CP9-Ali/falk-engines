import type { Alert, AlertSeverity } from './types';
import type { EnrichedFusionResult } from '../data-fusion/enrich';
import type { BacktestResult } from '../backtest/types';

export interface FusionRulesConfig {
  readonly discrepancy_severity?: AlertSeverity;
  readonly unresolved_severity?: AlertSeverity;
  readonly insufficient_severity?: AlertSeverity;
  readonly failed_severity?: AlertSeverity;
  readonly single_evidence_severity?: AlertSeverity;
  /**
   * 'per-report' ? dedup_key includes report_id (each fusion report fires once).
   * 'per-condition' ? dedup_key is stable per status (rolls up across runs).
   */
  readonly dedup_scope?: 'per-report' | 'per-condition';
}

export interface BacktestRulesConfig {
  readonly max_drawdown_critical_pct?: number;
  readonly max_drawdown_high_pct?: number;
  readonly min_sharpe?: number;
  readonly min_profit_factor?: number;
  readonly min_total_trades?: number;
}

export interface QualityCheckInput {
  readonly name: string;
  readonly severity: 'WARNING' | 'HIGH' | 'CRITICAL';
  readonly passed: boolean;
  readonly message?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface QualityRulesConfig {
  readonly dedup_scope?: 'per-check' | 'per-check-per-run';
  readonly run_id?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string, seq: number): string {
  return prefix + '-' + Date.now().toString(36) + '-' + seq.toString(36);
}

// ?? Fusion ?????????????????????????????????????????????????????
export function evaluateFusion(
  enriched: EnrichedFusionResult<unknown>,
  cfg: FusionRulesConfig = {},
): Alert[] {
  const scope = cfg.dedup_scope ?? 'per-report';
  const dedupSuffix = scope === 'per-report' ? ':' + enriched.report_id : '';
  const out: Alert[] = [];
  let seq = 0;

  const status = enriched.conflictStatus;
  const baseMeta: Readonly<Record<string, unknown>> = {
    report_id: enriched.report_id,
    conflict_status: status,
    policy_version: enriched.policy_version,
    source_counts: enriched.source_counts,
  };

  if (status === 'UNRESOLVED_CONFLICT') {
    out.push({
      id: makeId('a-fusion', seq++),
      severity: cfg.unresolved_severity ?? 'CRITICAL',
      category: 'fusion',
      message: 'Fusion conflict unresolved (report ' + enriched.report_id + ')',
      dedup_key: 'fusion:UNRESOLVED_CONFLICT' + dedupSuffix,
      raised_at: nowIso(),
      metadata: baseMeta,
    });
  } else if (status === 'DISCREPANCY') {
    out.push({
      id: makeId('a-fusion', seq++),
      severity: cfg.discrepancy_severity ?? 'HIGH',
      category: 'fusion',
      message: 'Fusion discrepancy exceeded tolerance (report ' + enriched.report_id + ')',
      dedup_key: 'fusion:DISCREPANCY' + dedupSuffix,
      raised_at: nowIso(),
      metadata: baseMeta,
    });
  } else if (status === 'INSUFFICIENT_COMPARABLE_DATA') {
    out.push({
      id: makeId('a-fusion', seq++),
      severity: cfg.insufficient_severity ?? 'HIGH',
      category: 'fusion',
      message: 'Insufficient comparable sources (report ' + enriched.report_id + ')',
      dedup_key: 'fusion:INSUFFICIENT' + dedupSuffix,
      raised_at: nowIso(),
      metadata: baseMeta,
    });
  } else if (status === 'FAILED') {
    out.push({
      id: makeId('a-fusion', seq++),
      severity: cfg.failed_severity ?? 'HIGH',
      category: 'fusion',
      message: 'Fusion engine failed (report ' + enriched.report_id + ')',
      dedup_key: 'fusion:FAILED' + dedupSuffix,
      raised_at: nowIso(),
      metadata: baseMeta,
    });
  }

  // Independent-evidence downgrade is separate ? even when status is CONSISTENT
  if (enriched.source_counts.independent_evidence < 2) {
    out.push({
      id: makeId('a-fusion', seq++),
      severity: cfg.single_evidence_severity ?? 'WARNING',
      category: 'fusion',
      message: 'Only ' + enriched.source_counts.independent_evidence + ' independent source(s) (report ' + enriched.report_id + ')',
      dedup_key: 'fusion:SINGLE_EVIDENCE' + dedupSuffix,
      raised_at: nowIso(),
      metadata: baseMeta,
    });
  }

  return out;
}

// ?? Backtest ???????????????????????????????????????????????????
export function evaluateBacktest(
  result: BacktestResult,
  cfg: BacktestRulesConfig = {},
): Alert[] {
  const ddCrit = cfg.max_drawdown_critical_pct ?? 20;
  const ddHigh = cfg.max_drawdown_high_pct ?? 10;
  const minSharpe = cfg.min_sharpe ?? 0.5;
  const minPF = cfg.min_profit_factor ?? 1.0;
  const minTrades = cfg.min_total_trades ?? 1;

  const out: Alert[] = [];
  let seq = 0;
  const baseMeta: Readonly<Record<string, unknown>> = {
    config_version: result.config_version,
    from_utc: result.from_utc,
    to_utc: result.to_utc,
    total_trades: result.metrics.total_trades,
    final_equity: result.final_equity,
  };

  const dd = result.metrics.max_drawdown_pct;
  if (dd >= ddCrit) {
    out.push({
      id: makeId('a-bt', seq++),
      severity: 'CRITICAL',
      category: 'backtest',
      message: 'Max drawdown ' + dd.toFixed(2) + '% >= ' + ddCrit + '%',
      dedup_key: 'backtest:' + result.config_version + ':max_drawdown_critical',
      raised_at: nowIso(),
      metadata: { ...baseMeta, max_drawdown_pct: dd, threshold_pct: ddCrit },
    });
  } else if (dd >= ddHigh) {
    out.push({
      id: makeId('a-bt', seq++),
      severity: 'HIGH',
      category: 'backtest',
      message: 'Max drawdown ' + dd.toFixed(2) + '% >= ' + ddHigh + '%',
      dedup_key: 'backtest:' + result.config_version + ':max_drawdown_high',
      raised_at: nowIso(),
      metadata: { ...baseMeta, max_drawdown_pct: dd, threshold_pct: ddHigh },
    });
  }

  if (result.metrics.sharpe_ratio !== null && result.metrics.sharpe_ratio < minSharpe) {
    out.push({
      id: makeId('a-bt', seq++),
      severity: 'WARNING',
      category: 'backtest',
      message: 'Sharpe ' + result.metrics.sharpe_ratio.toFixed(2) + ' < ' + minSharpe,
      dedup_key: 'backtest:' + result.config_version + ':sharpe_low',
      raised_at: nowIso(),
      metadata: { ...baseMeta, sharpe_ratio: result.metrics.sharpe_ratio, threshold: minSharpe },
    });
  }

  if (result.metrics.profit_factor !== null && result.metrics.profit_factor < minPF) {
    out.push({
      id: makeId('a-bt', seq++),
      severity: 'WARNING',
      category: 'backtest',
      message: 'Profit factor ' + result.metrics.profit_factor.toFixed(2) + ' < ' + minPF,
      dedup_key: 'backtest:' + result.config_version + ':profit_factor_low',
      raised_at: nowIso(),
      metadata: { ...baseMeta, profit_factor: result.metrics.profit_factor, threshold: minPF },
    });
  }

  if (result.metrics.total_trades < minTrades) {
    out.push({
      id: makeId('a-bt', seq++),
      severity: 'WARNING',
      category: 'backtest',
      message: 'Only ' + result.metrics.total_trades + ' trades in backtest window',
      dedup_key: 'backtest:' + result.config_version + ':too_few_trades',
      raised_at: nowIso(),
      metadata: { ...baseMeta, threshold: minTrades },
    });
  }

  return out;
}

// ?? Quality ????????????????????????????????????????????????????
export function evaluateQuality(
  checks: ReadonlyArray<QualityCheckInput>,
  cfg: QualityRulesConfig = {},
): Alert[] {
  const scope = cfg.dedup_scope ?? 'per-check';
  const suffix = scope === 'per-check-per-run' && cfg.run_id ? ':' + cfg.run_id : '';
  const out: Alert[] = [];
  let seq = 0;

  for (const check of checks) {
    if (check.passed) continue;
    out.push({
      id: makeId('a-dq', seq++),
      severity: check.severity,
      category: 'quality',
      message: check.message ?? ('DQ check failed: ' + check.name),
      dedup_key: 'quality:' + check.name + suffix,
      raised_at: nowIso(),
      metadata: { check: check.name, ...(check.metadata ?? {}) },
    });
  }

  return out;
}
