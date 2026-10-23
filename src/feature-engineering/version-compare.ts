import { LookaheadGuard, now } from '../core/time';
import type { RawDataPoint, Timestamp } from '../core/types';
import type { Candle } from '../data-quality/checks/base';
import type { FeatureDefinition, FeatureComputeResult } from './types';

export interface ComparisonRow {
  readonly event_time_utc: Timestamp;
  readonly old_value: number | null;
  readonly new_value: number | null;
  readonly old_status: string;
  readonly new_status: string;
  readonly delta: number | null;
  readonly match: boolean;
}

export interface VersionComparisonReport {
  readonly feature_id: string;
  readonly old_version: string;
  readonly new_version: string;
  readonly timeframe: string;
  readonly compared_at: Timestamp;
  readonly total_candles: number;
  readonly matches: number;
  readonly divergences: number;
  readonly match_rate: number;
  readonly max_delta: number | null;
  readonly rows: ReadonlyArray<ComparisonRow>;
}

function runOn(
  def: FeatureDefinition<ReadonlyArray<RawDataPoint<Candle>>, number>,
  inputs: RawDataPoint<Candle>[],
  cutoff: Timestamp,
  snapshotRef: { snapshotId: string; contentFingerprint: string },
  policyVersion: string,
): FeatureComputeResult<number> {
  const guard = new LookaheadGuard(cutoff);
  try {
    return def.compute({
      asOfCutoff: cutoff,
      definitionVersion: def.definitionVersion,
      policyVersion,
      guard,
      inputs,
      parameters: def.parameters,
      dependencyResults: new Map(),
      snapshotRef,
    });
  } catch (e) {
    return {
      featureId: def.featureId,
      definitionVersion: def.definitionVersion,
      status: 'COMPUTATION_FAILED',
      value: null,
      asOfCutoff: cutoff,
      computedAt: cutoff,
      availabilityTime: null,
      error: (e as Error).message,
      parameters: def.parameters,
      snapshotRef,
      fusionPolicyVersion: policyVersion,
    };
  }
}

/**
 * §8.1: مقارنة نسخة جديدة بالنسخة الحالية على بيانات معروفة.
 * لا تُستبدل النتائج القديمة — فقط تُقارن.
 */
export function compareVersions(
  oldDef: FeatureDefinition<ReadonlyArray<RawDataPoint<Candle>>, number>,
  newDef: FeatureDefinition<ReadonlyArray<RawDataPoint<Candle>>, number>,
  timeframe: string,
  historicalCandles: ReadonlyArray<RawDataPoint<Candle>>,
  tolerance = 1e-6,
): VersionComparisonReport {
  const rows: ComparisonRow[] = [];
  let matches = 0;
  let divergences = 0;
  let max_delta: number | null = null;

  for (let i = 20; i < historicalCandles.length; i++) {
    const window = historicalCandles.slice(0, i + 1);
    const cutoff = window[window.length - 1]!.availabilityTime;
    const ref = { snapshotId: 'compare', contentFingerprint: 'cf' };

    const oldR = runOn(oldDef, window, cutoff, ref, 'p-old');
    const newR = runOn(newDef, window, cutoff, ref, 'p-new');

    const ov = typeof oldR.value === 'number' ? oldR.value : null;
    const nv = typeof newR.value === 'number' ? newR.value : null;
    const delta = ov !== null && nv !== null ? nv - ov : null;
    const match = ov !== null && nv !== null && Math.abs(nv - ov) <= tolerance;

    if (match) matches++;
    else divergences++;

    if (delta !== null) {
      max_delta = max_delta === null ? Math.abs(delta) : Math.max(max_delta, Math.abs(delta));
    }

    rows.push({
      event_time_utc: historicalCandles[i]!.eventTime,
      old_value: ov,
      new_value: nv,
      old_status: oldR.status,
      new_status: newR.status,
      delta,
      match,
    });
  }

  return {
    feature_id: oldDef.featureId,
    old_version: oldDef.definitionVersion,
    new_version: newDef.definitionVersion,
    timeframe,
    compared_at: now(),
    total_candles: rows.length,
    matches,
    divergences,
    match_rate: rows.length > 0 ? matches / rows.length : 0,
    max_delta,
    rows,
  };
}