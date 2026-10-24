import { describe, it, expect } from 'vitest';
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
