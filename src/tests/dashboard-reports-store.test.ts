import { describe, it, expect } from 'vitest';
import { createReportsStore, reportsStore } from '../dashboard/reports-store';
import type { FusionReport } from '../data-fusion/types';
import type { BacktestResult } from '../backtest/types';

function mkFusion(id: string, status: FusionReport['conflict_status'] = 'CONSISTENT'): FusionReport {
  return {
    report_id: id,
    as_of_cutoff: '2026-01-01T00:00:00Z',
    policy_version: 'v1',
    engine_version: 'ev',
    conflict_status: status,
    fused_value: 100,
    raw_values: [],
    deltas: [],
    sources_used: 0,
    sources_dropped: [],
    source_counts: { total: 2, comparable: 2, blocked: 0, dropped_by_policy: 0 },
  };
}

function mkBacktest(version: string): BacktestResult {
  return {
    config_version: version,
    ran_at: '2026-01-01T00:00:00Z',
    from_utc: '2026-01-01T00:00:00Z',
    to_utc: '2026-06-30T00:00:00Z',
    candles_processed: 100,
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
}

describe('?11.0 ? createReportsStore', () => {
  it('empty store returns null / []', () => {
    const s = createReportsStore();
    expect(s.getFusionLatest()).toBeNull();
    expect(s.getFusionAll()).toEqual([]);
    expect(s.getBacktestLatest()).toBeNull();
    expect(s.getBacktestAll()).toEqual([]);
    expect(s.size()).toEqual({ fusion: 0, backtest: 0 });
  });

  it('pushFusion then getFusionLatest', () => {
    const s = createReportsStore();
    const r = mkFusion('rep-1');
    s.pushFusion(r);
    expect(s.getFusionLatest()!.report.report_id).toBe('rep-1');
    expect(typeof s.getFusionLatest()!.stored_at).toBe('string');
  });

  it('pushBacktest then getBacktestLatest', () => {
    const s = createReportsStore();
    s.pushBacktest(mkBacktest('bt-v1'));
    expect(s.getBacktestLatest()!.report.config_version).toBe('bt-v1');
  });

  it('fusion and backtest stores are independent', () => {
    const s = createReportsStore();
    s.pushFusion(mkFusion('rep-1'));
    s.pushBacktest(mkBacktest('bt-1'));
    expect(s.size()).toEqual({ fusion: 1, backtest: 1 });
    s.clear();
    expect(s.size()).toEqual({ fusion: 0, backtest: 0 });
  });

  it('history preserves insertion order (oldest ? newest)', () => {
    const s = createReportsStore();
    s.pushFusion(mkFusion('rep-1'));
    s.pushFusion(mkFusion('rep-2'));
    s.pushFusion(mkFusion('rep-3'));
    expect(s.getFusionAll().map((x) => x.report.report_id)).toEqual(['rep-1', 'rep-2', 'rep-3']);
    expect(s.getFusionLatest()!.report.report_id).toBe('rep-3');
  });

  it('getAll(limit) returns last N entries', () => {
    const s = createReportsStore();
    s.pushFusion(mkFusion('rep-1'));
    s.pushFusion(mkFusion('rep-2'));
    s.pushFusion(mkFusion('rep-3'));
    expect(s.getFusionAll(2).map((x) => x.report.report_id)).toEqual(['rep-2', 'rep-3']);
  });

  it('getAll(limit > size) ? entire history', () => {
    const s = createReportsStore();
    s.pushFusion(mkFusion('rep-1'));
    expect(s.getFusionAll(100)).toHaveLength(1);
  });

  it('getAll(0) ? empty array', () => {
    const s = createReportsStore();
    s.pushFusion(mkFusion('rep-1'));
    expect(s.getFusionAll(0)).toEqual([]);
  });

  it('getAll(negative limit) ? empty array (clamped to 0)', () => {
    const s = createReportsStore();
    s.pushFusion(mkFusion('rep-1'));
    expect(s.getFusionAll(-5)).toEqual([]);
  });

  it('maxHistory caps fusion history', () => {
    const s = createReportsStore({ maxHistory: 3 });
    for (let i = 0; i < 5; i++) s.pushFusion(mkFusion('rep-' + i));
    expect(s.size().fusion).toBe(3);
    expect(s.getFusionAll().map((x) => x.report.report_id)).toEqual(['rep-2', 'rep-3', 'rep-4']);
  });

  it('maxHistory caps backtest history', () => {
    const s = createReportsStore({ maxHistory: 2 });
    for (let i = 0; i < 5; i++) s.pushBacktest(mkBacktest('bt-' + i));
    expect(s.size().backtest).toBe(2);
    expect(s.getBacktestAll().map((x) => x.report.config_version)).toEqual(['bt-3', 'bt-4']);
  });

  it('maxHistory <= 0 ? throws', () => {
    expect(() => createReportsStore({ maxHistory: 0 })).toThrow(/positive integer/);
    expect(() => createReportsStore({ maxHistory: -1 })).toThrow(/positive integer/);
    expect(() => createReportsStore({ maxHistory: 1.5 })).toThrow(/positive integer/);
  });

  it('two independent stores do not share state', () => {
    const a = createReportsStore();
    const b = createReportsStore();
    a.pushFusion(mkFusion('rep-a'));
    expect(a.size().fusion).toBe(1);
    expect(b.size().fusion).toBe(0);
  });

  it('singleton reportsStore is importable and usable', () => {
    reportsStore.clear();
    reportsStore.pushFusion(mkFusion('singleton-1'));
    expect(reportsStore.getFusionLatest()!.report.report_id).toBe('singleton-1');
    reportsStore.clear();
  });
});

// ============================================================
// آ§11.4 â€” Quality support (Phase 1)
// ============================================================
import type { QualityVerdict } from '../data-quality/types';

const qvFixture: QualityVerdict = {
  overallStatus: 'PASS',
  findings: [],
  suitableForTask: true,
  suitable_for: { rsi_atr: true, volume_profile: true, source_comparison: true } as any,
  dataReference: {
    snapshotId: 'snap-1',
    contentFingerprint: 'fp-1',
    sourceId: 'src-1',
    range: { from: '2026-01-01T00:00:00Z', to: '2026-01-01T01:00:00Z' },
  } as any,
  instrument: 'XAUUSD',
  timeframe: '1h',
  evaluatedAt: '2026-01-01T01:00:00Z' as any,
  asOfCutoff: '2026-01-01T01:00:00Z' as any,
  policyVersion: 'p1',
  qualityRulesVersion: 'q1',
  report: {} as any,
};

describe('ReportsStore â€” quality (آ§11.4)', () => {
  it('pushQuality stores and getQualityLatest retrieves it', () => {
    const s = createReportsStore();
    s.pushQuality(qvFixture);
    const stored = s.getQualityLatest();
    expect(stored).not.toBeNull();
    expect(stored!.verdict).toEqual(qvFixture);
    expect(typeof stored!.stored_at).toBe('string');
  });

  it('getQualityLatest is null when empty', () => {
    const s = createReportsStore();
    expect(s.getQualityLatest()).toBeNull();
  });

  it('getQualityAll returns oldest-first and respects limit', () => {
    const s = createReportsStore();
    s.pushQuality({ ...qvFixture, timeframe: '1h' });
    s.pushQuality({ ...qvFixture, timeframe: '4h' });
    s.pushQuality({ ...qvFixture, timeframe: '1d' });
    expect(s.getQualityAll().length).toBe(3);
    const limited = s.getQualityAll(2);
    expect(limited.length).toBe(2);
    expect(limited[1]!.verdict.timeframe).toBe('1d');
  });

  it('pushQuality trims to maxHistory', () => {
    const s = createReportsStore({ maxHistory: 2 });
    s.pushQuality({ ...qvFixture, timeframe: '1h' });
    s.pushQuality({ ...qvFixture, timeframe: '4h' });
    s.pushQuality({ ...qvFixture, timeframe: '1d' });
    expect(s.getQualityAll().length).toBe(2);
    expect(s.getQualityLatest()!.verdict.timeframe).toBe('1d');
  });

  it('clear() removes quality entries too', () => {
    const s = createReportsStore();
    s.pushQuality(qvFixture);
    s.clear();
    expect(s.getQualityLatest()).toBeNull();
  });

  it('size() stays backward-compatible (no quality key)', () => {
    const s = createReportsStore();
    s.pushQuality(qvFixture);
    expect(s.size()).toEqual({ fusion: 0, backtest: 0 });
  });
});

describe('ReportsStore — features + availability (B3a)', () => {
  const fFixture = {
    featureId: 'sma_20_1m',
    definitionVersion: '1.0.0',
    status: 'VALID',
    value: 4002.5,
    metadata: { feature_id: 'sma_20_1m', status: 'final' },
  } as any;

  const aFixture = {
    timeframe: '1m',
    open_utc: '2026-01-01T10:00:00Z',
    close_utc: '2026-01-01T10:01:00Z',
    available_at_utc: '2026-01-01T10:01:00Z',
    is_final: true,
    source: 'source',
    missing_children: 0,
    conflicts: [],
  } as any;

  it('pushFeature stores and getFeatureLatest retrieves it', () => {
    const s = createReportsStore();
    s.pushFeature(fFixture);
    const stored = s.getFeatureLatest();
    expect(stored).not.toBeNull();
    expect(stored!.result).toBe(fFixture);
    expect(typeof stored!.stored_at).toBe('string');
  });

  it('getFeatureLatest is null when empty', () => {
    const s = createReportsStore();
    expect(s.getFeatureLatest()).toBeNull();
  });

  it('getFeatureAll respects limit (last N)', () => {
    const s = createReportsStore();
    s.pushFeature({ ...fFixture, featureId: 'sma_20_1m' });
    s.pushFeature({ ...fFixture, featureId: 'rsi_14_1m' });
    s.pushFeature({ ...fFixture, featureId: 'atr_14_1m' });
    expect(s.getFeatureAll().length).toBe(3);
    const limited = s.getFeatureAll(2);
    expect(limited.length).toBe(2);
    expect(limited[1]!.result.featureId).toBe('atr_14_1m');
  });

  it('pushFeature trims to maxHistory', () => {
    const s = createReportsStore({ maxHistory: 2 });
    s.pushFeature({ ...fFixture, featureId: 'a' });
    s.pushFeature({ ...fFixture, featureId: 'b' });
    s.pushFeature({ ...fFixture, featureId: 'c' });
    expect(s.getFeatureAll().length).toBe(2);
    expect(s.getFeatureLatest()!.result.featureId).toBe('c');
  });

  it('pushAvailability stores and getAvailabilityLatest retrieves it', () => {
    const s = createReportsStore();
    s.pushAvailability(aFixture);
    const stored = s.getAvailabilityLatest();
    expect(stored).not.toBeNull();
    expect(stored!.report).toBe(aFixture);
  });

  it('clear() removes features and availability too', () => {
    const s = createReportsStore();
    s.pushFeature(fFixture);
    s.pushAvailability(aFixture);
    s.clear();
    expect(s.getFeatureLatest()).toBeNull();
    expect(s.getAvailabilityLatest()).toBeNull();
  });
});
