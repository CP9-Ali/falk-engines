import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

export interface LiveSource {
  start(): Promise<void>;
  stop(): Promise<void>;
}