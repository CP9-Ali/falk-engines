export interface TimestampedValue<T> {
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
