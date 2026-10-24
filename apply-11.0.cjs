const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

fs.mkdirSync('src/dashboard', { recursive: true });

// ????????? [1/2] reports-store.ts ?????????
fs.writeFileSync('src/dashboard/reports-store.ts', `import type { FusionReport } from '../data-fusion/types';
import type { BacktestResult } from '../backtest/types';

export interface StoredFusion {
  readonly report: FusionReport;
  readonly stored_at: string;
}

export interface StoredBacktest {
  readonly report: BacktestResult;
  readonly stored_at: string;
}

export interface ReportsStore {
  pushFusion(report: FusionReport): void;
  pushBacktest(report: BacktestResult): void;
  getFusionLatest(): StoredFusion | null;
  getFusionAll(limit?: number): StoredFusion[];
  getBacktestLatest(): StoredBacktest | null;
  getBacktestAll(limit?: number): StoredBacktest[];
  clear(): void;
  size(): { fusion: number; backtest: number };
}

export interface ReportsStoreOptions {
  /** Maximum entries retained per report type. Default 50. */
  readonly maxHistory?: number;
}

export function createReportsStore(opts: ReportsStoreOptions = {}): ReportsStore {
  const max = opts.maxHistory ?? 50;
  if (!Number.isInteger(max) || max < 1) {
    throw new Error('maxHistory must be a positive integer');
  }

  const fusion: StoredFusion[] = [];
  const backtest: StoredBacktest[] = [];

  function trim<T>(arr: T[]): void {
    while (arr.length > max) arr.shift();
  }

  return {
    pushFusion(report) {
      fusion.push({ report, stored_at: new Date().toISOString() });
      trim(fusion);
    },
    pushBacktest(report) {
      backtest.push({ report, stored_at: new Date().toISOString() });
      trim(backtest);
    },
    getFusionLatest() {
      return fusion.length === 0 ? null : fusion[fusion.length - 1]!;
    },
    getFusionAll(limit) {
      const n = limit === undefined ? fusion.length : Math.max(0, Math.min(limit, fusion.length));
      return fusion.slice(fusion.length - n);
    },
    getBacktestLatest() {
      return backtest.length === 0 ? null : backtest[backtest.length - 1]!;
    },
    getBacktestAll(limit) {
      const n = limit === undefined ? backtest.length : Math.max(0, Math.min(limit, backtest.length));
      return backtest.slice(backtest.length - n);
    },
    clear() {
      fusion.length = 0;
      backtest.length = 0;
    },
    size() {
      return { fusion: fusion.length, backtest: backtest.length };
    },
  };
}

/**
 * ?11.0 ? Process-wide singleton for the live pipeline to push to
 * and for dashboard routes to read from.
 * Tests should use createReportsStore() for isolation.
 */
export const reportsStore: ReportsStore = createReportsStore();
`, 'utf8');
ok('reports-store.ts');

// ????????? [2/2] tests ?????????
fs.writeFileSync('src/tests/dashboard-reports-store.test.ts', `import { describe, it, expect } from 'vitest';
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
`, 'utf8');
ok('dashboard-reports-store.test.ts');

console.log('\nDONE. ?11.0 files written.');
