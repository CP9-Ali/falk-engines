import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';
import type { ErrorQueue } from './error-queue';

export interface Gap {
  readonly gap_id: string;
  readonly source_id: string;
  readonly timeframe: string;
  readonly from_utc: string;
  readonly to_utc: string;
  readonly reason: string;
  readonly detected_at_utc: string;
  readonly status: 'PENDING' | 'FIXED' | 'ABANDONED';
}

export interface GapFixResult {
  readonly gap: Gap;
  readonly success: boolean;
  readonly fetched_count: number;
  readonly error?: string;
}

export type Fetcher = (fromUtc: string, toUtc: string) => Promise<ReadonlyArray<RawDataPoint<Candle>>>;

/**
 * §5.1: كاشف الفجوات — يعيد الجلب التلقائي عند اكتشاف نقص.
 * مصادر الفجوات:
 *   1. فحص completeness للشموع المحفوظة
 *   2. ErrorQueue (طلبات فاشلة لم تُحل)
 */
export class GapFixer {
  constructor(
    private readonly sourceId: string,
    private readonly timeframe: string,
    private readonly expectedCadenceMs: number,
    private readonly errors: ErrorQueue,
  ) {}

  /** يكشف الفجوات في مصفوفة شموع مرتبة */
  detectFromPoints(points: ReadonlyArray<RawDataPoint<Candle>>): Gap[] {
    if (points.length < 2) return [];
    const sorted = [...points].sort((a, b) =>
      new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());

    const out: Gap[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]!.eventTime).getTime();
      const cur = new Date(sorted[i]!.eventTime).getTime();
      const gap = cur - prev;
      if (gap > this.expectedCadenceMs * 2) {
        out.push({
          gap_id: 'gap-' + this.timeframe + '-' + prev + '-' + cur,
          source_id: this.sourceId,
          timeframe: this.timeframe,
          from_utc: new Date(prev + this.expectedCadenceMs).toISOString(),
          to_utc: new Date(cur).toISOString(),
          reason: 'missing-candles',
          detected_at_utc: new Date().toISOString(),
          status: 'PENDING',
        });
      }
    }
    return out;
  }

  /** يكشف الفجوات من ErrorQueue (طلبات فاشلة لم تُحل) */
  detectFromErrors(): Gap[] {
    const out: Gap[] = [];
    for (const op of this.errors.list()) {
      if (op.source_id !== this.sourceId) continue;
      if (!op.operation.includes(this.timeframe)) continue;
      out.push({
        gap_id: 'err-' + op.id,
        source_id: op.source_id,
        timeframe: this.timeframe,
        from_utc: op.occurred_at_utc,
        to_utc: op.occurred_at_utc,
        reason: 'failed-fetch: ' + op.reason,
        detected_at_utc: op.occurred_at_utc,
        status: 'PENDING',
      });
    }
    return out;
  }

  /** إعادة الجلب التلقائي عبر fetcher callback */
  async fix(gap: Gap, fetcher: Fetcher): Promise<GapFixResult> {
    try {
      const points = await fetcher(gap.from_utc, gap.to_utc);
      const success = points.length > 0;
      return {
        gap,
        success,
        fetched_count: points.length,
        ...(success ? {} : { error: 'empty result' }),
      };
    } catch (e) {
      return {
        gap,
        success: false,
        fetched_count: 0,
        error: (e as Error).message,
      };
    }
  }

  /** إصلاح كل الفجوات دفعة واحدة */
  async fixAll(gaps: ReadonlyArray<Gap>, fetcher: Fetcher): Promise<GapFixResult[]> {
    const results: GapFixResult[] = [];
    for (const g of gaps) {
      const r = await this.fix(g, fetcher);
      results.push(r);
    }
    return results;
  }
}