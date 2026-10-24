import { describe, it, expect } from 'vitest';
import { evaluateFusion, evaluateBacktest, evaluateQuality } from '../alerts/rules';
import type { EnrichedFusionResult } from '../data-fusion/enrich';
import type { BacktestResult, BacktestMetrics } from '../backtest/types';

function mkEnriched(over: Partial<EnrichedFusionResult<unknown>> = {}): any {
  return {
    conflictStatus: 'CONSISTENT',
    report_id: 'rep-1',
    policy_version: 'v1',
    engine_version: 'ev',
    deltas: [],
    raw_values: [],
    source_counts: { total: 2, comparable: 2, blocked: 0, dropped_by_policy: 0, independent_evidence: 2 },
    sensitive_use_blocked: false,
    as_of_cutoff: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function mkMetrics(over: Partial<BacktestMetrics> = {}): BacktestMetrics {
  return {
    total_trades: 5, wins: 3, losses: 2, breakevens: 0, win_rate: 0.6,
    profit_factor: 1.5, max_drawdown_pct: 5, sharpe_ratio: 1.2, sortino_ratio: 1.5,
    total_pnl_abs: 100, total_pnl_pct: 0.01, total_fees_abs: 2, avg_hold_duration_ms: 3_600_000,
    ...over,
  };
}

function mkResult(over: Partial<BacktestResult> = {}): BacktestResult {
  return {
    config_version: 'bt-v1',
    ran_at: '2026-10-24T00:00:00Z',
    from_utc: '2026-01-01T00:00:00Z',
    to_utc: '2026-06-30T00:00:00Z',
    candles_processed: 100,
    candles_skipped_gap: 0,
    candles_skipped_not_final: 0,
    trades: [],
    equity_curve: [],
    final_equity: 10_100,
    metrics: mkMetrics(),
    ...over,
  };
}

// ?? Fusion ?????????????????????????????????????????????????????
describe('?10.2 ? evaluateFusion', () => {
  it('CONSISTENT + 2 evidence ? no alerts', () => {
    expect(evaluateFusion(mkEnriched())).toHaveLength(0);
  });

  it('CONSISTENT + 1 evidence ? WARNING', () => {
    const alerts = evaluateFusion(mkEnriched({
      source_counts: { total: 1, comparable: 1, blocked: 0, dropped_by_policy: 0, independent_evidence: 1 },
    }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe('WARNING');
    expect(alerts[0]!.dedup_key).toBe('fusion:SINGLE_EVIDENCE:rep-1');
  });

  it('DISCREPANCY ? HIGH with default severity', () => {
    const alerts = evaluateFusion(mkEnriched({ conflictStatus: 'DISCREPANCY' }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe('HIGH');
    expect(alerts[0]!.dedup_key).toBe('fusion:DISCREPANCY:rep-1');
  });

  it('UNRESOLVED_CONFLICT ? CRITICAL', () => {
    const alerts = evaluateFusion(mkEnriched({ conflictStatus: 'UNRESOLVED_CONFLICT' }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe('CRITICAL');
  });

  it('INSUFFICIENT_COMPARABLE_DATA ? HIGH', () => {
    const alerts = evaluateFusion(mkEnriched({ conflictStatus: 'INSUFFICIENT_COMPARABLE_DATA' }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.dedup_key).toBe('fusion:INSUFFICIENT:rep-1');
  });

  it('FAILED ? HIGH', () => {
    const alerts = evaluateFusion(mkEnriched({ conflictStatus: 'FAILED' }));
    expect(alerts).toHaveLength(1);
  });

  it('dedup_scope per-condition omits report_id from key', () => {
    const alerts = evaluateFusion(
      mkEnriched({ conflictStatus: 'DISCREPANCY' }),
      { dedup_scope: 'per-condition' },
    );
    expect(alerts[0]!.dedup_key).toBe('fusion:DISCREPANCY');
  });

  it('custom severities override defaults', () => {
    const alerts = evaluateFusion(
      mkEnriched({ conflictStatus: 'DISCREPANCY' }),
      { discrepancy_severity: 'WARNING' },
    );
    expect(alerts[0]!.severity).toBe('WARNING');
  });

  it('DISCREPANCY + 1 evidence ? 2 alerts', () => {
    const alerts = evaluateFusion(mkEnriched({
      conflictStatus: 'DISCREPANCY',
      source_counts: { total: 1, comparable: 1, blocked: 0, dropped_by_policy: 0, independent_evidence: 1 },
    }));
    expect(alerts).toHaveLength(2);
  });

  it('alert metadata includes source_counts', () => {
    const alerts = evaluateFusion(mkEnriched({ conflictStatus: 'DISCREPANCY' }));
    expect((alerts[0]!.metadata as any).source_counts.comparable).toBe(2);
  });
});

// ?? Backtest ???????????????????????????????????????????????????
describe('?10.2 ? evaluateBacktest', () => {
  it('healthy result ? no alerts', () => {
    expect(evaluateBacktest(mkResult())).toHaveLength(0);
  });

  it('drawdown >= 20% ? CRITICAL', () => {
    const alerts = evaluateBacktest(mkResult({ metrics: mkMetrics({ max_drawdown_pct: 25 }) }));
    const crit = alerts.find((a) => a.severity === 'CRITICAL');
    expect(crit).toBeDefined();
    expect(crit!.dedup_key).toBe('backtest:bt-v1:max_drawdown_critical');
  });

  it('drawdown between 10-20% ? HIGH (not CRITICAL)', () => {
    const alerts = evaluateBacktest(mkResult({ metrics: mkMetrics({ max_drawdown_pct: 15 }) }));
    const high = alerts.find((a) => a.severity === 'HIGH');
    expect(high).toBeDefined();
    expect(high!.dedup_key).toBe('backtest:bt-v1:max_drawdown_high');
    expect(alerts.find((a) => a.severity === 'CRITICAL')).toBeUndefined();
  });

  it('sharpe below threshold ? WARNING', () => {
    const alerts = evaluateBacktest(mkResult({ metrics: mkMetrics({ sharpe_ratio: 0.2 }) }));
    expect(alerts.find((a) => a.dedup_key === 'backtest:bt-v1:sharpe_low')).toBeDefined();
  });

  it('sharpe null ? no alert', () => {
    const alerts = evaluateBacktest(mkResult({ metrics: mkMetrics({ sharpe_ratio: null }) }));
    expect(alerts.find((a) => a.dedup_key === 'backtest:bt-v1:sharpe_low')).toBeUndefined();
  });

  it('profit_factor below 1.0 ? WARNING', () => {
    const alerts = evaluateBacktest(mkResult({ metrics: mkMetrics({ profit_factor: 0.8 }) }));
    expect(alerts.find((a) => a.dedup_key === 'backtest:bt-v1:profit_factor_low')).toBeDefined();
  });

  it('profit_factor null ? no alert', () => {
    const alerts = evaluateBacktest(mkResult({ metrics: mkMetrics({ profit_factor: null }) }));
    expect(alerts.find((a) => a.dedup_key === 'backtest:bt-v1:profit_factor_low')).toBeUndefined();
  });

  it('0 trades ? WARNING', () => {
    const alerts = evaluateBacktest(mkResult({ metrics: mkMetrics({ total_trades: 0 }) }));
    expect(alerts.find((a) => a.dedup_key === 'backtest:bt-v1:too_few_trades')).toBeDefined();
  });

  it('custom thresholds override defaults', () => {
    const alerts = evaluateBacktest(
      mkResult({ metrics: mkMetrics({ max_drawdown_pct: 5 }) }),
      { max_drawdown_high_pct: 3 },
    );
    expect(alerts.find((a) => a.severity === 'HIGH')).toBeDefined();
  });

  it('multiple failures ? multiple alerts', () => {
    const alerts = evaluateBacktest(mkResult({
      metrics: mkMetrics({ max_drawdown_pct: 25, sharpe_ratio: 0.1, profit_factor: 0.5, total_trades: 0 }),
    }));
    expect(alerts.length).toBeGreaterThanOrEqual(4);
  });
});

// ?? Quality ????????????????????????????????????????????????????
describe('?10.2 ? evaluateQuality', () => {
  it('all passed ? no alerts', () => {
    expect(evaluateQuality([
      { name: 'DQ-1', severity: 'WARNING', passed: true },
      { name: 'DQ-2', severity: 'CRITICAL', passed: true },
    ])).toHaveLength(0);
  });

  it('failed check ? alert with its severity', () => {
    const alerts = evaluateQuality([
      { name: 'DQ-SESSION-GAP', severity: 'CRITICAL', passed: false, message: 'candles in closed market' },
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe('CRITICAL');
    expect(alerts[0]!.dedup_key).toBe('quality:DQ-SESSION-GAP');
  });

  it('multiple failed checks ? multiple alerts', () => {
    const alerts = evaluateQuality([
      { name: 'A', severity: 'WARNING', passed: false },
      { name: 'B', severity: 'HIGH', passed: false },
      { name: 'C', severity: 'CRITICAL', passed: true },
    ]);
    expect(alerts).toHaveLength(2);
  });

  it('default message used when omitted', () => {
    const alerts = evaluateQuality([
      { name: 'X', severity: 'WARNING', passed: false },
    ]);
    expect(alerts[0]!.message).toBe('DQ check failed: X');
  });

  it('per-check-per-run adds run_id to dedup_key', () => {
    const alerts = evaluateQuality(
      [{ name: 'X', severity: 'WARNING', passed: false }],
      { dedup_scope: 'per-check-per-run', run_id: 'run-42' },
    );
    expect(alerts[0]!.dedup_key).toBe('quality:X:run-42');
  });

  it('custom metadata merged into alert', () => {
    const alerts = evaluateQuality([
      { name: 'X', severity: 'WARNING', passed: false, metadata: { source: 'twelvedata' } },
    ]);
    expect((alerts[0]!.metadata as any).source).toBe('twelvedata');
    expect((alerts[0]!.metadata as any).check).toBe('X');
  });
});
