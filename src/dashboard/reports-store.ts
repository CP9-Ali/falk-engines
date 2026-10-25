import type { FusionReport } from '../data-fusion/types';
import type { BacktestResult } from '../backtest/types';
import type { QualityVerdict } from '../data-quality/types';

export interface StoredFusion {
  readonly report: FusionReport;
  readonly stored_at: string;
}

export interface StoredBacktest {
  readonly report: BacktestResult;
  readonly stored_at: string;
}

export interface StoredQuality {
  readonly verdict: QualityVerdict;
  readonly stored_at: string;
}

export interface ReportsStore {
  pushFusion(report: FusionReport): void;
  pushBacktest(report: BacktestResult): void;
  pushQuality(verdict: QualityVerdict): void;
  getFusionLatest(): StoredFusion | null;
  getFusionAll(limit?: number): StoredFusion[];
  getBacktestLatest(): StoredBacktest | null;
  getBacktestAll(limit?: number): StoredBacktest[];
  getQualityLatest(): StoredQuality | null;
  getQualityAll(limit?: number): StoredQuality[];
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
  const quality: StoredQuality[] = [];

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
    pushQuality(verdict) {
      quality.push({ verdict, stored_at: new Date().toISOString() });
      trim(quality);
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
    getQualityLatest() {
      return quality.length === 0 ? null : quality[quality.length - 1]!;
    },
    getQualityAll(limit) {
      const n = limit === undefined ? quality.length : Math.max(0, Math.min(limit, quality.length));
      return quality.slice(quality.length - n);
    },
    clear() {
      fusion.length = 0;
      backtest.length = 0;
      quality.length = 0;
    },
    size() {
      return { fusion: fusion.length, backtest: backtest.length };
    },
  };
}

/**
 * §11.0 — Process-wide singleton for the live pipeline to push to
 * and for dashboard routes to read from.
 * Tests should use createReportsStore() for isolation.
 */
export const reportsStore: ReportsStore = createReportsStore();
