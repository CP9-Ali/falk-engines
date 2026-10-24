import type { Strategy } from '../event-loop';

export interface SmaCrossOptions {
  readonly fast: number;
  readonly slow: number;
}

function avg(arr: ReadonlyArray<number>): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

export function createSmaCrossStrategy(opts: SmaCrossOptions): Strategy {
  if (!Number.isInteger(opts.fast) || opts.fast < 1) {
    throw new Error('fast must be a positive integer');
  }
  if (!Number.isInteger(opts.slow) || opts.slow < 1) {
    throw new Error('slow must be a positive integer');
  }
  if (opts.fast >= opts.slow) {
    throw new Error('fast must be < slow');
  }

  return (candle, ctx) => {
    const H = ctx.history;
    if (H.length < opts.slow + 1) {
      return { action: 'HOLD', at: candle.event_time_utc };
    }
    const closes = H.map((c) => c.close);
    const fastNow  = avg(closes.slice(-opts.fast));
    const slowNow  = avg(closes.slice(-opts.slow));
    const fastPrev = avg(closes.slice(-opts.fast - 1, -1));
    const slowPrev = avg(closes.slice(-opts.slow - 1, -1));

    if (fastPrev <= slowPrev && fastNow > slowNow) {
      return { action: 'OPEN_LONG', at: candle.event_time_utc, reason: 'sma_cross_up' };
    }
    if (fastPrev >= slowPrev && fastNow < slowNow) {
      return { action: 'CLOSE', at: candle.event_time_utc, reason: 'sma_cross_down' };
    }
    return { action: 'HOLD', at: candle.event_time_utc };
  };
}
