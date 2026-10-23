import type { RawDataPoint, Timestamp } from '../../core/types';
import type { QualityFinding } from '../types';

export interface Candle { open: number; high: number; low: number; close: number; volume: number; }

export interface CheckContext<T = Candle> {
  readonly sourceId: string;
  /** §6.5: instrument — optional for backward compat; default 'XAUUSD' applied in engine */
  readonly instrument?: string;
  /** §6.5: timeframe — optional for backward compat */
  readonly timeframe?: string;
  readonly points: ReadonlyArray<RawDataPoint<T>>;
  readonly range: { readonly from: Timestamp; readonly to: Timestamp };
  readonly expectedCadenceMs: number;
  readonly asOfCutoff: Timestamp;
}

/** §6.6: each check has definition + version + parameters */
export interface QualityCheck<T = Candle> {
  readonly checkId: string;
  readonly checkVersion: string;
  readonly parameters: Record<string, number | string>;
  run(ctx: CheckContext<T>): ReadonlyArray<QualityFinding>;
}