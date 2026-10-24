import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';
import type { ErrorQueue } from './error-queue';
import { classifyGap, currentSessionUtcBounds, type GapType } from '../calendar/session-calendar';

export interface Gap {
  readonly gap_id: string;
  readonly source_id: string;
  readonly timeframe: string;
  readonly from_utc: string;
  readonly to_utc: string;
  readonly reason: string;
  readonly detected_at_utc: string;
  readonly status: 'PENDING' | 'FIXED' | 'ABANDONED';
  /** Stage 5: classification of the gap (open vs closed market) */
  readonly analysis?: {
    readonly open_candles: number;
    readonly closed_candles: number;
    readonly needs_refetch: boolean;
    readonly gap_type: GapType;
  };
}

export interface GapFixResult {
  readonly gap: Gap;
  readonly success: boolean;
  readonly fetched_count: number;
  readonly error?: string;
}

export type Fetcher = (fromUtc: string, toUtc: string) => Promise<ReadonlyArray<RawDataPoint<Candle>>>;

/**
 * §5.1: Gap detector — automatically refetches missing candles.
 * Gap sources:
 *   1. Completeness checks on stored candles
 *   2. ErrorQueue (failed requests that were not resolved)
 *
 * Stage 5: gaps that fall entirely within market-closed hours are marked
 * ABANDONED (no refetch attempted) instead of PENDING.
 */
export class GapFixer {
  constructor(
    private readonly sourceId: string,
    private readonly timeframe: string,
    private readonly expectedCadenceMs: number,
    private readonly errors: ErrorQueue,
  ) {}

  /** Detects gaps from an ordered candle array */
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
        const fromUtc = new Date(prev + this.expectedCadenceMs).toISOString();
        const toUtc = new Date(cur).toISOString();
        const analysis = classifyGap(fromUtc, toUtc, this.expectedCadenceMs);
        const needsRefetch = analysis.needs_refetch;
        const status: 'PENDING' | 'ABANDONED' = needsRefetch ? 'PENDING' : 'ABANDONED';
        const reason = needsRefetch
          ? 'missing-candles'
          : 'market-closed: ' + analysis.closed_candles + ' candles';
        out.push({
          gap_id: 'gap-' + this.timeframe + '-' + prev + '-' + cur,
          source_id: this.sourceId,
          timeframe: this.timeframe,
          from_utc: fromUtc,
          to_utc: toUtc,
          reason,
          detected_at_utc: new Date().toISOString(),
          status,
          analysis: {
            open_candles: analysis.open_candles,
            closed_candles: analysis.closed_candles,
            needs_refetch: analysis.needs_refetch,
            gap_type: analysis.gap_type,
          },
        });
      }
    }
    return out;
  }

  /** Detects gaps from ErrorQueue (failed requests that were not resolved) */
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

  /** Refetches a single gap via a fetcher callback */
  async fix(gap: Gap, fetcher: Fetcher): Promise<GapFixResult> {
    if (gap.status === 'ABANDONED') {
      return {
        gap,
        success: false,
        fetched_count: 0,
        error: 'gap abandoned: market closed during entire gap',
      };
    }
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

  /** Fixes all gaps in one batch */
  async fixAll(gaps: ReadonlyArray<Gap>, fetcher: Fetcher): Promise<GapFixResult[]> {
    const results: GapFixResult[] = [];
    for (const g of gaps) {
      const r = await this.fix(g, fetcher);
      results.push(r);
    }
    return results;
  }
  /**
   * Stage 7B: detect gaps against an expected window, catching leading/trailing
   * missing candles that detectFromPoints (between-candles only) misses.
   */
  detectFromExpectation(opts: {
    expectedFromUtc: string;
    expectedToUtc: string;
    storedCandles: ReadonlyArray<RawDataPoint<Candle>>;
  }): Gap[] {
    const fromMs = new Date(opts.expectedFromUtc).getTime();
    const toMs = new Date(opts.expectedToUtc).getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];

    const effectiveToMs = Math.min(toMs, Date.now());
    if (effectiveToMs <= fromMs) return [];

    const storedSet = new Set(
      opts.storedCandles.map(p => new Date(p.eventTime).getTime()),
    );

    const out: Gap[] = [];
    let runStart: number | null = null;
    let runLast: number | null = null;

    const flush = (): void => {
      if (runStart === null || runLast === null) return;
      out.push(this.buildGap(runStart, runLast + this.expectedCadenceMs));
      runStart = null;
      runLast = null;
    };

    for (let t = fromMs; t < effectiveToMs; t += this.expectedCadenceMs) {
      if (!storedSet.has(t)) {
        if (runStart === null) runStart = t;
        runLast = t;
      } else {
        flush();
      }
    }
    flush();

    return out;
  }

  /**
   * Stage 7B: convenience — detect gaps against the current forex session window.
   * Returns [] when market is closed.
   */
  detectFromCurrentSession(
    storedCandles: ReadonlyArray<RawDataPoint<Candle>>,
  ): Gap[] {
    const nowIso = new Date().toISOString();
    const bounds = currentSessionUtcBounds(nowIso);
    if (!bounds.is_market_open) return [];
    const endMs = Math.min(
      new Date(bounds.close_utc).getTime(),
      new Date(nowIso).getTime(),
    );
    return this.detectFromExpectation({
      expectedFromUtc: bounds.open_utc,
      expectedToUtc: new Date(endMs).toISOString(),
      storedCandles,
    });
  }

  private buildGap(fromMs: number, toExclusiveMs: number): Gap {
    const fromUtc = new Date(fromMs).toISOString();
    const toUtc = new Date(toExclusiveMs).toISOString();
    const analysis = classifyGap(fromUtc, toUtc, this.expectedCadenceMs);
    const needsRefetch = analysis.needs_refetch;
    const status: 'PENDING' | 'ABANDONED' = needsRefetch ? 'PENDING' : 'ABANDONED';
    const reason = needsRefetch
      ? 'missing-candles'
      : 'market-closed: ' + analysis.closed_candles + ' candles';
    return {
      gap_id: 'exp-' + this.timeframe + '-' + fromMs + '-' + toExclusiveMs,
      source_id: this.sourceId,
      timeframe: this.timeframe,
      from_utc: fromUtc,
      to_utc: toUtc,
      reason,
      detected_at_utc: new Date().toISOString(),
      status,
      analysis: {
        open_candles: analysis.open_candles,
        closed_candles: analysis.closed_candles,
        needs_refetch: analysis.needs_refetch,
        gap_type: analysis.gap_type,
      },
    };
  }

}
