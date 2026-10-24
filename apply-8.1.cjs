const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// ?? [1/6] price-difference.ts ???????????????????????????????????
fs.writeFileSync('src/data-fusion/price-difference.ts', `export interface PriceDelta {
  from: string;
  to: string;
  delta_p: number;
  delta_p_pct: number | null;
}

export interface PricePoint {
  sourceId: string;
  price: number;
}

export function computePairwiseDeltas(
  values: ReadonlyArray<PricePoint>,
  baseSourceId?: string,
): PriceDelta[] {
  if (values.length < 2) return [];

  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v.sourceId)) {
      throw new Error('duplicate sourceId in pairwise delta: ' + v.sourceId);
    }
    seen.add(v.sourceId);
  }

  const deltas: PriceDelta[] = [];
  const emit = (a: PricePoint, b: PricePoint): void => {
    const delta_p = a.price - b.price;
    const delta_p_pct = b.price === 0 ? null : (delta_p / b.price) * 100;
    deltas.push({ from: a.sourceId, to: b.sourceId, delta_p, delta_p_pct });
  };

  if (baseSourceId !== undefined) {
    const base = values.find((v) => v.sourceId === baseSourceId);
    if (base === undefined) {
      throw new Error('baseSourceId not found: ' + baseSourceId);
    }
    for (const v of values) {
      if (v.sourceId === baseSourceId) continue;
      emit(v, base);
    }
    return deltas;
  }

  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      emit(values[i]!, values[j]!);
    }
  }
  return deltas;
}
`, 'utf8');
ok('price-difference.ts');

// ?? [2/6] timestamp-aligner.ts ??????????????????????????????????
fs.writeFileSync('src/data-fusion/timestamp-aligner.ts', `export interface TimestampedValue<T> {
  sourceId: string;
  timestamp: string;
  value: T;
}

export interface AlignedBucket<T> {
  bucket_start: string;
  entries: TimestampedValue<T>[];
}

export function alignByTimeBucket<T>(
  values: ReadonlyArray<TimestampedValue<T>>,
  bucketMs: number,
): AlignedBucket<T>[] {
  if (!Number.isFinite(bucketMs) || bucketMs <= 0) {
    throw new Error('bucketMs must be a positive finite number');
  }

  const buckets = new Map<number, TimestampedValue<T>[]>();
  for (const v of values) {
    const t = Date.parse(v.timestamp);
    if (Number.isNaN(t)) {
      throw new Error('invalid timestamp for source ' + v.sourceId + ': ' + v.timestamp);
    }
    const key = Math.floor(t / bucketMs) * bucketMs;
    const arr = buckets.get(key);
    if (arr === undefined) buckets.set(key, [v]);
    else arr.push(v);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([key, entries]) => ({
      bucket_start: new Date(key).toISOString(),
      entries: entries
        .slice()
        .sort((x, y) => x.sourceId.localeCompare(y.sourceId)),
    }));
}
`, 'utf8');
ok('timestamp-aligner.ts');

// ?? [3/6] quote-comparator.ts ???????????????????????????????????
fs.writeFileSync('src/data-fusion/quote-comparator.ts', `export interface Quote {
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
`, 'utf8');
ok('quote-comparator.ts');

// ?? [4/6] test price-difference ?????????????????????????????????
fs.writeFileSync('src/tests/fusion-price-difference.test.ts', `import { describe, it, expect } from 'vitest';
import { computePairwiseDeltas } from '../data-fusion/price-difference';

describe('?8.1 ? computePairwiseDeltas', () => {
  it('returns [] for 0 or 1 value', () => {
    expect(computePairwiseDeltas([])).toEqual([]);
    expect(computePairwiseDeltas([{ sourceId: 'A', price: 100 }])).toEqual([]);
  });

  it('rejects duplicate sourceId', () => {
    expect(() =>
      computePairwiseDeltas([
        { sourceId: 'A', price: 1 },
        { sourceId: 'A', price: 2 },
      ]),
    ).toThrow(/duplicate sourceId/);
  });

  it('emits one delta per non-base source when base given', () => {
    const d = computePairwiseDeltas(
      [
        { sourceId: 'A', price: 101 },
        { sourceId: 'B', price: 100 },
        { sourceId: 'C', price: 99 },
      ],
      'B',
    );
    expect(d).toHaveLength(2);
    expect(d.map((x) => x.from).sort()).toEqual(['A', 'C']);
    expect(d.every((x) => x.to === 'B')).toBe(true);
  });

  it('throws when base sourceId not found', () => {
    expect(() =>
      computePairwiseDeltas([{ sourceId: 'A', price: 1 }, { sourceId: 'B', price: 2 }], 'Z'),
    ).toThrow(/baseSourceId not found/);
  });

  it('emits every unordered pair once when no base', () => {
    const d = computePairwiseDeltas([
      { sourceId: 'A', price: 1 },
      { sourceId: 'B', price: 2 },
      { sourceId: 'C', price: 3 },
    ]);
    expect(d).toHaveLength(3);
  });

  it('computes delta_p and delta_pct correctly', () => {
    const [d] = computePairwiseDeltas([
      { sourceId: 'A', price: 102 },
      { sourceId: 'B', price: 100 },
    ]);
    expect(d!.delta_p).toBeCloseTo(2);
    expect(d!.delta_p_pct).toBeCloseTo(2);
  });

  it('returns null pct when denominator is zero', () => {
    const [d] = computePairwiseDeltas([
      { sourceId: 'A', price: 5 },
      { sourceId: 'B', price: 0 },
    ]);
    expect(d!.delta_p_pct).toBeNull();
    expect(d!.delta_p).toBe(5);
  });
});
`, 'utf8');
ok('test price-difference');

// ?? [5/6] test timestamp-aligner ????????????????????????????????
fs.writeFileSync('src/tests/fusion-timestamp-aligner.test.ts', `import { describe, it, expect } from 'vitest';
import { alignByTimeBucket } from '../data-fusion/timestamp-aligner';

const MIN = 60_000;

describe('?8.1 ? alignByTimeBucket', () => {
  it('throws on non-positive bucketMs', () => {
    expect(() => alignByTimeBucket([], 0)).toThrow(/positive finite/);
    expect(() => alignByTimeBucket([], -1)).toThrow(/positive finite/);
    expect(() => alignByTimeBucket([], NaN)).toThrow(/positive finite/);
  });

  it('groups two sources in same minute together', () => {
    const b = alignByTimeBucket(
      [
        { sourceId: 'A', timestamp: '2026-01-01T00:00:05Z', value: 1 },
        { sourceId: 'B', timestamp: '2026-01-01T00:00:42Z', value: 2 },
      ],
      MIN,
    );
    expect(b).toHaveLength(1);
    expect(b[0]!.entries).toHaveLength(2);
  });

  it('separates sources in different buckets', () => {
    const b = alignByTimeBucket(
      [
        { sourceId: 'A', timestamp: '2026-01-01T00:00:05Z', value: 1 },
        { sourceId: 'B', timestamp: '2026-01-01T00:01:05Z', value: 2 },
      ],
      MIN,
    );
    expect(b).toHaveLength(2);
  });

  it('sorts buckets ascending and entries by sourceId', () => {
    const b = alignByTimeBucket(
      [
        { sourceId: 'B', timestamp: '2026-01-01T00:01:00Z', value: 2 },
        { sourceId: 'C', timestamp: '2026-01-01T00:00:30Z', value: 3 },
        { sourceId: 'A', timestamp: '2026-01-01T00:00:10Z', value: 1 },
      ],
      MIN,
    );
    expect(b.map((x) => x.bucket_start)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:01:00.000Z',
    ]);
    expect(b[0]!.entries.map((e) => e.sourceId)).toEqual(['A', 'C']);
  });

  it('throws on invalid timestamp', () => {
    expect(() =>
      alignByTimeBucket([{ sourceId: 'A', timestamp: 'not-a-date', value: 1 }], MIN),
    ).toThrow(/invalid timestamp/);
  });
});
`, 'utf8');
ok('test timestamp-aligner');

// ?? [6/6] test quote-comparator ?????????????????????????????????
fs.writeFileSync('src/tests/fusion-quote-comparator.test.ts', `import { describe, it, expect } from 'vitest';
import { compareQuotes } from '../data-fusion/quote-comparator';

describe('?8.1 ? compareQuotes', () => {
  it('returns empty result for no quotes', () => {
    const r = compareQuotes([]);
    expect(r.comparisons).toEqual([]);
    expect(r.cross_spread_abs).toBeNull();
    expect(r.skipped).toEqual([]);
  });

  it('single quote ? per-source spread but null cross_spread', () => {
    const r = compareQuotes([{ sourceId: 'A', bid: 99, ask: 101 }]);
    expect(r.comparisons).toHaveLength(1);
    expect(r.comparisons[0]!.spread_abs).toBe(2);
    expect(r.comparisons[0]!.mid).toBe(100);
    expect(r.cross_spread_abs).toBeNull();
  });

  it('two valid quotes ? cross_spread computed', () => {
    const r = compareQuotes([
      { sourceId: 'A', bid: 99, ask: 101 },
      { sourceId: 'B', bid: 100, ask: 102 },
    ]);
    expect(r.comparisons).toHaveLength(2);
    expect(r.cross_spread_abs).toBeCloseTo(1);          // mids 100 vs 101
    expect(r.cross_spread_pct).toBeCloseTo(1);          // 1/100 * 100
  });

  it('ask < bid ? skipped with reason', () => {
    const r = compareQuotes([{ sourceId: 'A', bid: 101, ask: 99 }]);
    expect(r.comparisons).toHaveLength(0);
    expect(r.skipped).toEqual([{ sourceId: 'A', reason: 'ASK_BELOW_BID' }]);
  });

  it('non-finite values ? skipped with reason', () => {
    const r = compareQuotes([
      { sourceId: 'A', bid: NaN, ask: 1 },
      { sourceId: 'B', bid: 1, ask: Infinity },
    ]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['NON_FINITE', 'NON_FINITE']);
  });

  it('mid zero ? spread_pct null but abs still computed', () => {
    const r = compareQuotes([{ sourceId: 'A', bid: -1, ask: 1 }]);
    expect(r.comparisons[0]!.mid).toBe(0);
    expect(r.comparisons[0]!.spread_pct).toBeNull();
    expect(r.comparisons[0]!.spread_abs).toBe(2);
  });
});
`, 'utf8');
ok('test quote-comparator');

console.log('\nDONE. ?8.1 files written.');
