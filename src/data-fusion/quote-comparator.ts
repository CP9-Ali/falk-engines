export interface Quote {
  sourceId: string;
  bid: number;
  ask: number;
}

export interface QuoteComparison {
  sourceId: string;
  spread_abs: number;
  spread_pct: number | null;
  mid: number;
}

export interface QuoteSkipped {
  sourceId: string;
  reason: 'ASK_BELOW_BID' | 'NON_FINITE';
}

export interface QuoteComparatorResult {
  comparisons: QuoteComparison[];
  cross_spread_abs: number | null;
  cross_spread_pct: number | null;
  skipped: QuoteSkipped[];
}

export function compareQuotes(quotes: ReadonlyArray<Quote>): QuoteComparatorResult {
  const comparisons: QuoteComparison[] = [];
  const skipped: QuoteSkipped[] = [];

  for (const q of quotes) {
    if (!Number.isFinite(q.bid) || !Number.isFinite(q.ask)) {
      skipped.push({ sourceId: q.sourceId, reason: 'NON_FINITE' });
      continue;
    }
    if (q.ask < q.bid) {
      skipped.push({ sourceId: q.sourceId, reason: 'ASK_BELOW_BID' });
      continue;
    }
    const spread_abs = q.ask - q.bid;
    const mid = (q.ask + q.bid) / 2;
    const spread_pct = mid === 0 ? null : (spread_abs / mid) * 100;
    comparisons.push({ sourceId: q.sourceId, spread_abs, spread_pct, mid });
  }

  if (comparisons.length < 2) {
    return { comparisons, cross_spread_abs: null, cross_spread_pct: null, skipped };
  }

  const mids = comparisons.map((c) => c.mid);
  const maxMid = Math.max(...mids);
  const minMid = Math.min(...mids);
  const cross_spread_abs = maxMid - minMid;
  const cross_spread_pct = minMid === 0 ? null : (cross_spread_abs / minMid) * 100;

  return { comparisons, cross_spread_abs, cross_spread_pct, skipped };
}
