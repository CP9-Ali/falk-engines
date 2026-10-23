import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

export type TF = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export const TF_MS: Record<TF, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

export type SourceOrigin = 'direct' | 'aggregated';

export interface AggregationResult {
  readonly point: RawDataPoint<Candle>;
  readonly source_candle_count: number;
  readonly expected_candle_count: number;
  readonly complete: boolean;
}

export interface ComparisonResult {
  readonly matches: boolean;
  readonly toleranceBps: number;
  readonly divergence_bps: number;
  readonly reason: string;
}

/**
 * Ì»‰Ì ≈ÿ«— √⁄·Ï „‰ ‘„Ê⁄ M1 (√Ê √Ì ≈ÿ«— √œ‰Ï).
 * ß10:  ÊÀÌﬁ ÿ—Ìﬁ… «· Ã„Ì⁄ + ﬂ‘› «·‰ﬁ’.
 */
export function aggregateCandles(
  sourceCandles: ReadonlyArray<RawDataPoint<Candle>>,
  sourceTf: TF,
  targetTf: TF,
): AggregationResult[] {
  const srcMs = TF_MS[sourceTf];
  const tgtMs = TF_MS[targetTf];

  if (srcMs >= tgtMs) {
    throw new Error('source timeframe must be smaller than target');
  }

  if (tgtMs % srcMs !== 0) {
    throw new Error('timeframe ' + targetTf + ' not evenly divisible from ' + sourceTf);
  }

  // ß10: ÕœÊœ ⁄„·Ì… ó „‰⁄  Ã„Ì⁄«  ÷Œ„… ﬁœ  Œ›Ì ›ÃÊ«  ﬂÀÌ—…
  const expected = tgtMs / srcMs;
  if (expected > 500) {
    throw new Error('aggregation ratio too large (' + expected + ' > 500); aggregate in steps');
  }

  const buckets = new Map<number, RawDataPoint<Candle>[]>();

  for (const c of sourceCandles) {
    const t = new Date(c.eventTime).getTime();
    const bucketStart = Math.floor(t / tgtMs) * tgtMs;
    const arr = buckets.get(bucketStart) || [];
    arr.push(c);
    buckets.set(bucketStart, arr);
  }

  const results: AggregationResult[] = [];
  const sortedBuckets = [...buckets.entries()].sort((a, b) => a[0] - b[0]);

  for (const [bucketStart, candles] of sortedBuckets) {
    const sorted = [...candles].sort((a, b) =>
      new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());

    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const open = first.value.open;
    const close = last.value.close;
    const high = Math.max(...sorted.map(c => c.value.high));
    const low = Math.min(...sorted.map(c => c.value.low));
    const volume = sorted.reduce((s, c) => s + c.value.volume, 0);

    const point: RawDataPoint<Candle> = {
      sourceId: 'aggregator-' + sourceTf + '-' + targetTf,
      value: { open, high, low, close, volume },
      eventTime: new Date(bucketStart).toISOString(),
      closedAt: new Date(bucketStart + tgtMs).toISOString(),
      arrivalTime: new Date().toISOString(),
      availabilityTime: new Date(bucketStart + tgtMs).toISOString(),
      version: 1,
      fingerprint: 'agg-' + targetTf + '-' + bucketStart,
    };

    results.push({
      point,
      source_candle_count: sorted.length,
      expected_candle_count: expected,
      complete: sorted.length === expected,
    });
  }

  return results;
}

/**
 * ß10: „ﬁ«—‰… ≈ÿ«— „Ã„¯⁄ „⁄ ≈ÿ«— „’œ— „” ﬁ·.
 * ﬂ‘› «· ⁄«—÷ »œ· ≈Œ›«∆Â.
 */
export function compareTimeframes(
  aggregated: RawDataPoint<Candle>,
  independent: RawDataPoint<Candle>,
  toleranceBps = 100,
): ComparisonResult {
  const aClose = aggregated.value.close;
  const iClose = independent.value.close;

  // ﬁÌ„… 0 √Ê NaN √Ê ·« ‰Â«∆Ì… = €Ì— ’«·Õ… ··„ﬁ«—‰…
  if (!Number.isFinite(aClose) || !Number.isFinite(iClose) || aClose <= 0 || iClose <= 0) {
    return {
      matches: false,
      toleranceBps,
      divergence_bps: Infinity,
      reason: 'invalid values',
    };
  }

  const divergence_bps = Math.abs(aClose - iClose) / iClose * 10_000;
  const matches = divergence_bps <= toleranceBps;

  return {
    matches,
    toleranceBps,
    divergence_bps: Math.round(divergence_bps * 100) / 100,
    reason: matches
      ? 'close within ' + toleranceBps + ' bps (' + divergence_bps.toFixed(1) + ' bps)'
      : 'divergence ' + divergence_bps.toFixed(1) + ' bps > ' + toleranceBps + ' bps',
  };
}

export function isComplete(result: AggregationResult): boolean {
  return result.complete;
}