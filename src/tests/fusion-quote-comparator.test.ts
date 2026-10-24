import { describe, it, expect } from 'vitest';
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
