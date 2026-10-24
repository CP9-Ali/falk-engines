const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// ????????? [1/4] outlier-detector.ts ?????????
fs.writeFileSync('src/data-fusion/outlier-detector.ts', `export interface OutlierInput {
  sourceId: string;
  value: number;
}

export interface OutlierVerdict extends OutlierInput {
  mad: number;
  modifiedZScore: number;
  isOutlier: boolean;
}

export interface OutlierResult {
  outliers: OutlierVerdict[];
  inliers: OutlierVerdict[];
  median: number | null;
  mad: number | null;
}

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function detectOutliersMAD(
  inputs: ReadonlyArray<OutlierInput>,
  threshold: number = 3.5,
): OutlierResult {
  if (inputs.length < 3) {
    const verdicts: OutlierVerdict[] = inputs.map((v) => ({
      sourceId: v.sourceId,
      value: v.value,
      mad: 0,
      modifiedZScore: 0,
      isOutlier: false,
    }));
    return { outliers: [], inliers: verdicts, median: null, mad: null };
  }

  const sorted = inputs.map((v) => v.value).slice().sort((a, b) => a - b);
  const median = medianOf(sorted);
  const deviationsSorted = inputs
    .map((v) => Math.abs(v.value - median))
    .slice()
    .sort((a, b) => a - b);
  const mad = medianOf(deviationsSorted);

  if (mad === 0) {
    const verdicts: OutlierVerdict[] = inputs.map((v) => ({
      sourceId: v.sourceId,
      value: v.value,
      mad: 0,
      modifiedZScore: 0,
      isOutlier: false,
    }));
    return { outliers: [], inliers: verdicts, median, mad: 0 };
  }

  const K = 0.6745;
  const verdicts: OutlierVerdict[] = inputs.map((v) => {
    const mz = (K * (v.value - median)) / mad;
    return {
      sourceId: v.sourceId,
      value: v.value,
      mad,
      modifiedZScore: mz,
      isOutlier: Math.abs(mz) > threshold,
    };
  });

  return {
    outliers: verdicts.filter((v) => v.isOutlier),
    inliers: verdicts.filter((v) => !v.isOutlier),
    median,
    mad,
  };
}
`, 'utf8');
ok('outlier-detector.ts');

// ????????? [2/4] enrich.ts ?????????
fs.writeFileSync('src/data-fusion/enrich.ts', `import type { FusionResult, FusionStatus, FusedDelta, FusedRawValue } from './types';
import { computePairwiseDeltas } from './price-difference';
import { detectOutliersMAD } from './outlier-detector';
import { resolveStatus } from './engine';

export interface SourceValueLike<T> {
  sourceId: string;
  value: T;
  timeBlocked?: boolean;
}

export interface EnrichOptions<T> {
  asOfCutoff: string;
  engineVersion: string;
  reportId?: string;
  fieldName?: string;
  fieldAccessor?: (v: T) => number | null;
  outlierPolicy?: { method: 'MAD' | 'ZSCORE'; threshold: number };
}

export interface SourceCounts {
  total: number;
  comparable: number;
  blocked: number;
  dropped_by_policy: number;
}

export interface FusionReportAddon {
  report_id: string;
  as_of_cutoff: string;
  policy_version: string;
  engine_version: string;
  deltas: ReadonlyArray<FusedDelta>;
  raw_values: ReadonlyArray<FusedRawValue>;
  source_counts: SourceCounts;
}

export type EnrichedFusionResult<T> = FusionResult<T> & FusionReportAddon;

function defaultAccessor<T>(v: T): number | null {
  const anyV = v as { close?: unknown };
  return typeof anyV?.close === 'number' ? anyV.close : null;
}

function makeReportId(): string {
  return 'rep-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function enrichFusionResult<T>(
  result: FusionResult<T>,
  values: ReadonlyArray<SourceValueLike<T>>,
  policy: { policyVersion: string; toleranceBps: number },
  opts: EnrichOptions<T>,
): EnrichedFusionResult<T> {
  const fieldName = opts.fieldName ?? 'close';
  const accessor = opts.fieldAccessor ?? defaultAccessor;
  const reportId = opts.reportId ?? makeReportId();

  const anyResult = result as unknown as {
    droppedSources: ReadonlyArray<{ sourceId: string; reason: string }>;
    provenance: ReadonlyArray<{ sourceId: string }>;
    fusedValue: unknown;
  };

  const droppedIds = new Set(anyResult.droppedSources.map((d) => d.sourceId));
  const provenanceIds = new Set(anyResult.provenance.map((p) => p.sourceId));

  let rawValues: FusedRawValue[] = values.map((v) => {
    const price = accessor(v.value);
    const blocked = v.timeBlocked === true;
    const dropped = droppedIds.has(v.sourceId);
    const used = provenanceIds.has(v.sourceId);

    const status: FusedRawValue['status'] = blocked
      ? 'BLOCKED'
      : dropped
      ? 'DROPPED'
      : used
      ? 'USED'
      : 'NOT_COMPARABLE';

    let reason = 'UNKNOWN';
    if (blocked) reason = 'BLOCKED_TIME';
    else if (dropped) {
      const d = anyResult.droppedSources.find((x) => x.sourceId === v.sourceId);
      reason = d?.reason ?? 'DROPPED';
    } else if (used) reason = 'USED';

    return { sourceId: v.sourceId, field: fieldName, value: price, status, reason };
  });

  // ?? Outlier detection (opt-in) ?????????????????????????????????
  const outlierIds = new Set<string>();
  if (opts.outlierPolicy?.method === 'MAD') {
    const candidates = rawValues
      .filter((r) => r.value !== null && r.status !== 'BLOCKED')
      .map((r) => ({ sourceId: r.sourceId, value: r.value as number }));
    const det = detectOutliersMAD(candidates, opts.outlierPolicy.threshold);
    for (const o of det.outliers) outlierIds.add(o.sourceId);
  }

  rawValues = rawValues.map((r) =>
    outlierIds.has(r.sourceId) && r.status !== 'BLOCKED'
      ? { ...r, status: 'DROPPED', reason: 'OUTLIER_MAD_GT_THRESHOLD' }
      : r,
  );

  // ?? Pairwise deltas on surviving comparable prices ?????????????
  const pricePoints = rawValues
    .filter((r) => r.value !== null && r.status !== 'BLOCKED' && r.status !== 'DROPPED')
    .map((r) => ({ sourceId: r.sourceId, price: r.value as number }));

  const deltas: FusedDelta[] =
    pricePoints.length >= 2 ? computePairwiseDeltas(pricePoints) : [];

  const withinTolerance: boolean | null =
    deltas.length === 0
      ? null
      : deltas.every((d) => {
          const base = pricePoints.find((p) => p.sourceId === d.to)?.price ?? 0;
          if (base === 0) return true;
          return (Math.abs(d.delta_p) / Math.abs(base)) * 10_000 <= policy.toleranceBps;
        });

  const comparable = rawValues.filter(
    (r) => r.status === 'USED' || r.status === 'NOT_COMPARABLE',
  ).length;
  const blocked = rawValues.filter((r) => r.status === 'BLOCKED').length;
  const dropped_by_policy = rawValues.filter((r) => r.status === 'DROPPED').length;

  const status: FusionStatus = resolveStatus({
    total: rawValues.length,
    comparable,
    blocked,
    droppedByPolicy: dropped_by_policy,
    withinTolerance,
    policyResolved: anyResult.fusedValue !== null && anyResult.fusedValue !== undefined,
    policyFailed: false,
    comparisonSkipped: false,
  });

  return {
    ...result,
    conflictStatus: status,
    report_id: reportId,
    as_of_cutoff: opts.asOfCutoff,
    policy_version: policy.policyVersion,
    engine_version: opts.engineVersion,
    deltas,
    raw_values: rawValues,
    source_counts: {
      total: rawValues.length,
      comparable,
      blocked,
      dropped_by_policy,
    },
  };
}
`, 'utf8');
ok('enrich.ts');

// ????????? [3/4] test outlier-detector ?????????
fs.writeFileSync('src/tests/fusion-outlier-detector.test.ts', `import { describe, it, expect } from 'vitest';
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
`, 'utf8');
ok('test outlier-detector');

// ????????? [4/4] test enrich ?????????
fs.writeFileSync('src/tests/fusion-enrich.test.ts', `import { describe, it, expect } from 'vitest';
import { enrichFusionResult } from '../data-fusion/enrich';

type Src = { sourceId: string; value: { close: number }; timeBlocked?: boolean };

const mkSrc = (id: string, close: number, timeBlocked = false): Src => ({
  sourceId: id,
  value: { close },
  ...(timeBlocked ? { timeBlocked: true } : {}),
});

const mkResult = (overrides: Record<string, unknown> = {}): any => ({
  conflictStatus: 'CONSISTENT',
  fusedValue: { close: 100 },
  droppedSources: [],
  provenance: [{ sourceId: 'A' }, { sourceId: 'B' }],
  ...overrides,
});

const policy = { policyVersion: 'v1', toleranceBps: 50 };
const opts   = { asOfCutoff: '2026-01-01T00:00:00Z', engineVersion: 'test' };

describe('?8.2 ? enrichFusionResult', () => {
  it('two clean sources within tolerance ? CONSISTENT', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100.2)],
      policy, opts,
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.deltas).toHaveLength(1);
    expect(r.raw_values.every((v) => v.status === 'USED')).toBe(true);
    expect(r.source_counts.total).toBe(2);
    expect(r.source_counts.comparable).toBe(2);
  });

  it('two sources beyond tolerance ? DISCREPANCY', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 105)],   // 5% > 0.5% tolerance
      policy, opts,
    );
    expect(r.conflictStatus).toBe('DISCREPANCY');
    expect(r.deltas[0]!.delta_p).toBeCloseTo(-5);
  });

  it('only one comparable source ? INSUFFICIENT_COMPARABLE_DATA', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'B' }], droppedSources: [{ sourceId: 'A', reason: 'TIME_BLOCKED' }] }),
      [mkSrc('A', 100, true), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.conflictStatus).toBe('INSUFFICIENT_COMPARABLE_DATA');
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.status).toBe('BLOCKED');
    expect(r.raw_values.find((v) => v.sourceId === 'B')!.status).toBe('USED');
    expect(r.deltas).toEqual([]);
    expect(r.source_counts.blocked).toBe(1);
  });

  it('outlier policy marks far source as DROPPED', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 101), mkSrc('C', 99), mkSrc('D', 200)],
      policy,
      { ...opts, outlierPolicy: { method: 'MAD', threshold: 3.5 } },
    );
    const d = r.raw_values.find((v) => v.sourceId === 'D')!;
    expect(d.status).toBe('DROPPED');
    expect(d.reason).toBe('OUTLIER_MAD_GT_THRESHOLD');
    expect(r.source_counts.dropped_by_policy).toBe(1);
  });

  it('without outlier policy, far source stays USED/NOT_COMPARABLE', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 101), mkSrc('C', 200)],
      policy, opts,
    );
    const c = r.raw_values.find((v) => v.sourceId === 'C')!;
    expect(c.status).not.toBe('DROPPED');
  });

  it('single price ? deltas: []', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }] }),
      [mkSrc('A', 100)],
      policy, opts,
    );
    expect(r.deltas).toEqual([]);
  });

  it('report metadata populated', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.report_id).toMatch(/^rep-/);
    expect(r.as_of_cutoff).toBe('2026-01-01T00:00:00Z');
    expect(r.policy_version).toBe('v1');
    expect(r.engine_version).toBe('test');
  });

  it('custom fieldAccessor reads a different field', () => {
    const srcs = [
      { sourceId: 'A', value: { open: 1, close: 100 } as any },
      { sourceId: 'B', value: { open: 2, close: 101 } as any },
    ];
    const r = enrichFusionResult(
      mkResult(),
      srcs as any,
      policy,
      { ...opts, fieldName: 'open', fieldAccessor: (v: any) => v.open ?? null },
    );
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.value).toBe(1);
    expect(r.raw_values.find((v) => v.sourceId === 'B')!.value).toBe(2);
  });
});
`, 'utf8');
ok('test enrich');

console.log('\nDONE. ?8.2 files written.');
