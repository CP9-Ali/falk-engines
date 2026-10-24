import type { CanonicalCandle } from '../normalization/canonical';
import type { Signal, BacktestConfig } from './types';

export interface StrategyContext {
  /** All candles up to and including the current one (inclusive). */
  readonly history: ReadonlyArray<CanonicalCandle>;
  /** Close time of the current candle (ISO 8601 UTC). */
  readonly current_time: string;
}

export type Strategy = (
  candle: CanonicalCandle,
  ctx: StrategyContext,
) => Signal;

export interface SignalEvent {
  readonly signal: Signal;
  readonly candle: CanonicalCandle;
  readonly close_time: string;
}

export interface EventLoopOptions {
  readonly config: BacktestConfig;
  readonly candles: ReadonlyArray<CanonicalCandle>;
  readonly strategy: Strategy;
  /** Optional: return true if the candle's interval spans a market-closed gap. */
  readonly isInGap?: (candle: CanonicalCandle) => boolean;
}

export interface EventLoopResult {
  readonly events: ReadonlyArray<SignalEvent>;
  readonly candles_processed: number;
  readonly candles_skipped_gap: number;
  readonly candles_skipped_not_final: number;
  readonly candles_outside_range: number;
}

const TF_MS: Readonly<Record<BacktestConfig['timeframe'], number>> = {
  '1m':  60_000,
  '5m':  300_000,
  '15m': 900_000,
  '1h':  3_600_000,
  'H3':  10_800_000,
  '4h':  14_400_000,
  '1d':  86_400_000,
  '1w':  604_800_000,
};

function closeTimeOf(candle: CanonicalCandle, tfMs: number): string {
  if (candle.candle_close_time_utc !== null && candle.candle_close_time_utc !== undefined) {
    return candle.candle_close_time_utc;
  }
  return new Date(new Date(candle.event_time_utc).getTime() + tfMs).toISOString();
}

export function runEventLoop(opts: EventLoopOptions): EventLoopResult {
  const tfMs = TF_MS[opts.config.timeframe];
  const configFrom = new Date(opts.config.from_utc).getTime();
  const configTo   = new Date(opts.config.to_utc).getTime();

  const sorted = opts.candles.slice().sort(
    (a, b) => new Date(a.event_time_utc).getTime() - new Date(b.event_time_utc).getTime(),
  );

  const events: SignalEvent[] = [];
  let processed = 0;
  let skipped_gap = 0;
  let skipped_not_final = 0;
  let outside_range = 0;

  for (let i = 0; i < sorted.length; i++) {
    const candle = sorted[i]!;

    if (candle.timeframe !== opts.config.timeframe) {
      throw new Error(
        `timeframe mismatch: candle has '${candle.timeframe}', config expects '${opts.config.timeframe}'`,
      );
    }

    const eventTime = new Date(candle.event_time_utc).getTime();
    const closeTimeStr = closeTimeOf(candle, tfMs);
    const closeTime = new Date(closeTimeStr).getTime();

    if (closeTime <= configFrom || eventTime >= configTo) {
      outside_range++;
      continue;
    }

    if (closeTime > configTo) {
      skipped_not_final++;
      continue;
    }

    if (opts.isInGap?.(candle) === true) {
      skipped_gap++;
      continue;
    }

    processed++;
    const ctx: StrategyContext = {
      history: sorted.slice(0, i + 1),
      current_time: closeTimeStr,
    };
    const signal = opts.strategy(candle, ctx);
    events.push({ signal, candle, close_time: closeTimeStr });
  }

  return {
    events,
    candles_processed: processed,
    candles_skipped_gap: skipped_gap,
    candles_skipped_not_final: skipped_not_final,
    candles_outside_range: outside_range,
  };
}
