import { describe, it, expect } from 'vitest';
import { detectOutliersMAD } from '../data-fusion/outlier-detector';

describe('?8.2 ? detectOutliersMAD', () => {
  it('< 3 inputs ? no outliers, median/mad null', () => {
    const r = detectOutliersMAD([
      { sourceId: 'A', value: 100 },
      { sourceId: 'B', value: 200 },
    ]);
    expect(r.outliers).toEqual([]);
    expect(r.inliers).toHaveLength(2);
    expect(r.median).toBeNull();
    expect(r.mad).toBeNull();
  });

  it('all equal ? mad=0 ? no outliers', () => {
    const r = detectOutliersMAD([
      { sourceId: 'A', value: 100 },
      { sourceId: 'B', value: 100 },
      { sourceId: 'C', value: 100 },
    ]);
    expect(r.outliers).toEqual([]);
    expect(r.mad).toBe(0);
  });

  it('clear outlier detected with default threshold 3.5', () => {
    const r = detectOutliersMAD([
      { sourceId: 'A', value: 100 },
      { sourceId: 'B', value: 101 },
      { sourceId: 'C', value: 99 },
      { sourceId: 'D', value: 200 },   // obvious outlier
    ]);
    expect(r.outliers).toHaveLength(1);
    expect(r.outliers[0]!.sourceId).toBe('D');
    expect(r.inliers).toHaveLength(3);
  });

  it('lower threshold yields more outliers', () => {
    const inputs = [
      { sourceId: 'A', value: 100 },
      { sourceId: 'B', value: 102 },
      { sourceId: 'C', value: 98 },
      { sourceId: 'D', value: 110 },
    ];
    const strict = detectOutliersMAD(inputs, 1.0);
    const lenient = detectOutliersMAD(inputs, 5.0);
    expect(strict.outliers.length).toBeGreaterThanOrEqual(lenient.outliers.length);
  });

  it('modifiedZScore sign reflects direction', () => {
    const r = detectOutliersMAD([
      { sourceId: 'A', value: 100 },
      { sourceId: 'B', value: 101 },
      { sourceId: 'C', value: 200 },
    ], 3.5);
    const c = [...r.outliers, ...r.inliers].find((v) => v.sourceId === 'C');
    expect(c!.modifiedZScore).toBeGreaterThan(0);
  });

  it('median computed correctly for odd count', () => {
    const r = detectOutliersMAD([
      { sourceId: 'A', value: 10 },
      { sourceId: 'B', value: 20 },
      { sourceId: 'C', value: 30 },
    ]);
    expect(r.median).toBe(20);
  });
});
