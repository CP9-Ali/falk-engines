import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';
import type { AuditLog } from '../audit/audit-log';
import { now } from '../core/time';
import { aggregateCandles, compareTimeframes, type SourceOrigin, type TF } from './aggregator';

export interface AggregatedCandle {
  readonly point: RawDataPoint<Candle>;
  readonly source_origin: SourceOrigin;
  readonly source_candle_count: number;
  readonly expected_candle_count: number;
  readonly complete: boolean;
  readonly comparison?: {
    readonly matches: boolean;
    readonly divergence_bps: number;
    readonly reason: string;
  };
}

const V = { schemaVersion: '1.0', policyVersion: 'multi-tf-v1', configVersion: '1.0', engineVersion: '1.0' };

/**
 * §10: يبني إطاراً أعلى من M1 كـ مصدر أساسي،
 * ويقارن مع المصدر المباشر (TwelveData) لكشف التعارض.
 */
export class AggregationSource {
  constructor(private readonly audit: AuditLog) {}

  buildAndCompare(
    source1m: ReadonlyArray<RawDataPoint<Candle>>,
    targetTf: TF,
    independentDirect: RawDataPoint<Candle> | null,
    actor: string,
  ): AggregatedCandle[] {
    const aggregated = aggregateCandles(source1m, '1m', targetTf);
    const out: AggregatedCandle[] = [];

    for (const agg of aggregated) {
      let comparison;
      if (independentDirect) {
        const sameTime = new Date(agg.point.eventTime).getTime() === new Date(independentDirect.eventTime).getTime();
        if (sameTime) {
          const cmp = compareTimeframes(agg.point, independentDirect, 100);
          comparison = {
            matches: cmp.matches,
            divergence_bps: cmp.divergence_bps,
            reason: cmp.reason,
          };

          if (!cmp.matches) {
            this.audit.append({
              eventType: 'TF_DIVERGENCE',
              engine: 'MultiTimeframe',
              eventTime: agg.point.eventTime,
              recordTime: now(),
              actor,
              refs: {
                tf: targetTf,
                aggregated_fp: agg.point.fingerprint,
                direct_fp: independentDirect.fingerprint,
              },
              versions: V,
              payload: {
                divergence_bps: cmp.divergence_bps,
                aggregated_close: agg.point.value.close,
                direct_close: independentDirect.value.close,
              },
            });
          }
        }
      }

      out.push({
        point: agg.point,
        source_origin: 'aggregated',
        source_candle_count: agg.source_candle_count,
        expected_candle_count: agg.expected_candle_count,
        complete: agg.complete,
        ...(comparison ? { comparison } : {}),
      });
    }

    return out;
  }

  /** يدمج الاثنين: aggregated يبقى الأساسي، direct يُضاف كمصدر مقارنة */
  mergeWithDirect(
    aggregated: ReadonlyArray<AggregatedCandle>,
    directCandles: ReadonlyArray<RawDataPoint<Candle>>,
  ): Array<{ aggregated: AggregatedCandle; direct: RawDataPoint<Candle> | null; match: boolean | null }> {
    const byTime = new Map<number, RawDataPoint<Candle>>();
    for (const d of directCandles) {
      byTime.set(new Date(d.eventTime).getTime(), d);
    }

    const out: Array<{ aggregated: AggregatedCandle; direct: RawDataPoint<Candle> | null; match: boolean | null }> = [];
    for (const agg of aggregated) {
      const t = new Date(agg.point.eventTime).getTime();
      const direct = byTime.get(t) ?? null;
      out.push({
        aggregated: agg,
        direct,
        match: agg.comparison ? agg.comparison.matches : null,
      });
    }
    return out;
  }
}