import { describe, it, expect } from 'vitest';
import {
  groupSourcesByIndependence,
  independentPairCount,
  resolveIndependenceKey,
} from '../data-fusion/independence';

describe('?8.3 ? independence grouping', () => {
  it('resolveIndependenceKey defaults to sourceId', () => {
    expect(resolveIndependenceKey('twelvedata-ws', {})).toBe('twelvedata-ws');
  });

  it('resolveIndependenceKey honors mapping', () => {
    expect(resolveIndependenceKey('twelvedata-ws', { 'twelvedata-ws': 'netdania' })).toBe('netdania');
  });

  it('each source its own group by default', () => {
    const g = groupSourcesByIndependence([{ sourceId: 'A' }, { sourceId: 'B' }]);
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.key).sort()).toEqual(['A', 'B']);
  });

  it('collapses sources sharing a key', () => {
    const g = groupSourcesByIndependence(
      [{ sourceId: 'A' }, { sourceId: 'B' }, { sourceId: 'C' }],
      { A: 'K1', B: 'K1', C: 'K2' },
    );
    expect(g).toHaveLength(2);
    const k1 = g.find((x) => x.key === 'K1');
    expect(k1!.sourceIds).toEqual(['A', 'B']);
    const k2 = g.find((x) => x.key === 'K2');
    expect(k2!.sourceIds).toEqual(['C']);
  });

  it('rejects duplicate sourceIds', () => {
    expect(() =>
      groupSourcesByIndependence([{ sourceId: 'A' }, { sourceId: 'A' }]),
    ).toThrow(/duplicate sourceId/);
  });

  it('empty input ? empty output', () => {
    expect(groupSourcesByIndependence([])).toEqual([]);
  });

  it('independentPairCount = N*(N-1)/2', () => {
    expect(independentPairCount([])).toBe(0);
    expect(independentPairCount([{ key: 'A', sourceIds: ['A'] }])).toBe(0);
    expect(independentPairCount([
      { key: 'A', sourceIds: ['A'] },
      { key: 'B', sourceIds: ['B'] },
    ])).toBe(1);
    expect(independentPairCount([
      { key: 'A', sourceIds: ['A'] },
      { key: 'B', sourceIds: ['B'] },
      { key: 'C', sourceIds: ['C'] },
    ])).toBe(3);
  });
});
