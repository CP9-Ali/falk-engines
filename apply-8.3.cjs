const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// ????????? [1/4] independence.ts ?????????
fs.writeFileSync('src/data-fusion/independence.ts', `export interface SourceRef {
  sourceId: string;
}

export interface IndependenceGroup {
  key: string;
  sourceIds: readonly string[];
}

export function resolveIndependenceKey(
  sourceId: string,
  independenceKeys: Readonly<Record<string, string>>,
): string {
  return independenceKeys[sourceId] ?? sourceId;
}

export function groupSourcesByIndependence(
  sources: ReadonlyArray<SourceRef>,
  independenceKeys: Readonly<Record<string, string>> = {},
): IndependenceGroup[] {
  const map = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.sourceId)) {
      throw new Error('duplicate sourceId in independence grouping: ' + s.sourceId);
    }
    seen.add(s.sourceId);
    const key = resolveIndependenceKey(s.sourceId, independenceKeys);
    const arr = map.get(key);
    if (arr === undefined) map.set(key, [s.sourceId]);
    else arr.push(s.sourceId);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, sourceIds]) => ({ key, sourceIds: sourceIds.slice().sort() }));
}

export function independentPairCount(groups: ReadonlyArray<IndependenceGroup>): number {
  const n = groups.length;
  return (n * (n - 1)) / 2;
}
`, 'utf8');
ok('independence.ts');

// ????????? [2/4] enrich.ts (rewrite with independence) ?????????
fs.writeFileSync('src/data-fusion/enrich.ts', `import type { FusionResult, FusionStatus, FusedDelta, FusedRawValue } from './types';
import { computePairwiseDeltas } from './price-difference';
import { detectOutliersMAD } from './outlier-detector';
import { groupSourcesByIndependence, resolveIndependenceKey } from './independence';
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
  /** ?8.3 ? map sourceId -> independence group key. Defaults to sourceId (each source its own group). */
  independenceKeys?: Readonly<Record<string, string>>;
}

export interface SourceCounts {
  total: number;
  comparable: number;
  blocked: number;
  dropped_by_policy: number;
  /** ?8.3 ? number of independent evidence groups among USED|NOT_COMPARABLE sources with non-null value. */
  independent_evidence: number;
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
  const independenceKeys = opts.independenceKeys ?? {};

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

    return {
      sourceId: v.sourceId,
      field: fieldName,
      value: price,
      status,
      reason,
      source_independence_key: resolveIndependenceKey(v.sourceId, independenceKeys),
    };
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

  // ?? ?8.3 ? Independence grouping ???????????????????????????????
  const usable = rawValues.filter(
    (r) => (r.status === 'USED' || r.status === 'NOT_COMPARABLE') && r.value !== null,
  );
  const groups = groupSourcesByIndependence(
    usable.map((r) => ({ sourceId: r.sourceId })),
    independenceKeys,
  );
  const independent_evidence = groups.length;

  // ?? One representative per independence group (prefer USED) ????
  const priceBySource = new Map<string, number>();
  for (const r of usable) priceBySource.set(r.sourceId, r.value as number);

  const representatives: Array<{ sourceId: string; price: number }> = [];
  for (const g of groups) {
    const usedInGroup = g.sourceIds.find((s) => provenanceIds.has(s));
    const repId = usedInGroup ?? g.sourceIds[0]!;
    const p = priceBySource.get(repId);
    if (typeof p === 'number') representatives.push({ sourceId: repId, price: p });
  }

  const deltas: FusedDelta[] =
    representatives.length >= 2 ? computePairwiseDeltas(representatives) : [];

  const withinTolerance: boolean | null =
    deltas.length === 0
      ? null
      : deltas.every((d) => {
          const base = representatives.find((p) => p.sourceId === d.to)?.price ?? 0;
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
    comparable: independent_evidence,
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
      independent_evidence,
    },
  };
}
`, 'utf8');
ok('enrich.ts rewritten (independence-aware)');

// ????????? [3/4] test independence module ?????????
fs.writeFileSync('src/tests/fusion-independence.test.ts', `import { describe, it, expect } from 'vitest';
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
`, 'utf8');
ok('test independence module');

// ????????? [4/4] test enrichment integration ?????????
fs.writeFileSync('src/tests/fusion-enrich-independence.test.ts', `import { describe, it, expect } from 'vitest';
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
const opts = { asOfCutoff: '2026-01-01T00:00:00Z', engineVersion: 'test' };

describe('?8.3 ? independence-aware enrichment', () => {
  it('two sources same key ? INSUFFICIENT_COMPARABLE_DATA', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100.2)],
      policy,
      { ...opts, independenceKeys: { A: 'K', B: 'K' } },
    );
    expect(r.conflictStatus).toBe('INSUFFICIENT_COMPARABLE_DATA');
    expect(r.source_counts.independent_evidence).toBe(1);
    expect(r.deltas).toEqual([]);   // same group ? no cross-group pairs
  });

  it('two sources distinct keys ? CONSISTENT', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100.2)],
      policy,
      { ...opts, independenceKeys: { A: 'K1', B: 'K2' } },
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.source_counts.independent_evidence).toBe(2);
    expect(r.deltas).toHaveLength(1);
  });

  it('three sources two keys ? 2 evidence ? CONSISTENT, 1 cross-group delta', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }, { sourceId: 'B' }, { sourceId: 'C' }] }),
      [mkSrc('A', 100), mkSrc('B', 100.1), mkSrc('C', 100.2)],
      policy,
      { ...opts, independenceKeys: { A: 'K1', B: 'K1', C: 'K2' } },
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.source_counts.independent_evidence).toBe(2);
    expect(r.deltas).toHaveLength(1);   // only K1-representative vs K2
  });

  it('raw_values carry source_independence_key', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy,
      { ...opts, independenceKeys: { A: 'K1', B: 'K2' } },
    );
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.source_independence_key).toBe('K1');
    expect(r.raw_values.find((v) => v.sourceId === 'B')!.source_independence_key).toBe('K2');
  });

  it('without independenceKeys each source = own evidence group', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.source_counts.independent_evidence).toBe(2);
  });

  it('collapsed group does not raise status to CONSISTENT alone', () => {
    // A and B republish same feed; C independent; A,B near 200, C=100 ? 2 evidence, out of tolerance
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }, { sourceId: 'B' }, { sourceId: 'C' }] }),
      [mkSrc('A', 200), mkSrc('B', 200.1), mkSrc('C', 100)],
      { policyVersion: 'v1', toleranceBps: 50 },
      { ...opts, independenceKeys: { A: 'K1', B: 'K1', C: 'K2' } },
    );
    expect(r.source_counts.independent_evidence).toBe(2);
    expect(r.deltas).toHaveLength(1);
    expect(['DISCREPANCY', 'UNRESOLVED_CONFLICT']).toContain(r.conflictStatus);
  });
});
`, 'utf8');
ok('test enrichment integration');

console.log('\nDONE. ?8.3 files written.');
