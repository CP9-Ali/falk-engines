import { describe, it, expect } from 'vitest';
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
