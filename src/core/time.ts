import type { RawDataPoint, Timestamp } from './types';
import { LookaheadLeakageError } from './errors';

export const now = (): Timestamp => new Date().toISOString();

export const isAtOrBefore = (a: Timestamp, b: Timestamp): boolean =>
  new Date(a).getTime() <= new Date(b).getTime();

export class LookaheadGuard {
  constructor(readonly asOfCutoff: Timestamp) {}

  filter<T>(points: ReadonlyArray<RawDataPoint<T>>): RawDataPoint<T>[] {
    return points.filter(p => isAtOrBefore(p.availabilityTime, this.asOfCutoff));
  }

  assertNoLeak<T>(points: ReadonlyArray<RawDataPoint<T>>): void {
    const leaks = points
      .filter(p => !isAtOrBefore(p.availabilityTime, this.asOfCutoff))
      .map(p => ({ sourceId: p.sourceId, availableAt: p.availabilityTime, cutoff: this.asOfCutoff }));
    if (leaks.length > 0) throw new LookaheadLeakageError(leaks);
  }
}

export function isCandleClosed(
  p: RawDataPoint,
  timeframeMs: number,
  asOfCutoff: Timestamp,
): boolean {
  const closedAtMs = p.closedAt
    ? new Date(p.closedAt).getTime()
    : new Date(p.eventTime).getTime() + timeframeMs;
  return closedAtMs <= new Date(asOfCutoff).getTime();
}