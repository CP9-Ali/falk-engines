import { describe, it, expect } from 'vitest';
import { loadCsv } from '../ingestion/csv-loader';

describe('CSV Loader', () => {
  it('loads BTC sample', () => {
    const points = loadCsv('data/btc-1h.csv', {
      timestampCol: 'timestamp',
      timestampUnit: 'ms',
      timeframeMs: 3_600_000,
      sourceId: 'binance',
    });
    expect(points.length).toBe(5);
    expect(points[0]!.value.close).toBe(42300);
    expect(points[0]!.closedAt).toBe(new Date(1735689600000 + 3_600_000).toISOString());
  });
});