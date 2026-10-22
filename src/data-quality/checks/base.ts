import type { RawDataPoint, Timestamp } from '../../core/types';
import type { QualityFinding } from '../types';

export interface Candle { open: number; high: number; low: number; close: number; volume: number; }

export interface CheckContext<T = Candle> {
  readonly sourceId: string;
  readonly points: ReadonlyArray<RawDataPoint<T>>;
  readonly range: { readonly from: Timestamp; readonly to: Timestamp };
  readonly expectedCadenceMs: number;
  readonly asOfCutoff: Timestamp;
}

export interface QualityCheck<T = Candle> {
  readonly checkId: string;
  run(ctx: CheckContext<T>): ReadonlyArray<QualityFinding>;
}