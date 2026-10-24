const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// ????????? [1/4] enrich.ts (rewrite, ?8.4) ?????????
fs.writeFileSync('src/data-fusion/enrich.ts', `import type { FusionResult, FusionStatus, FusedDelta, FusedRawValue } from './types';
import { computePairwiseDeltas } from './price-difference';
import { detectOutliersMAD } from './outlier-detector';
import { groupSourcesByIndependence, resolveIndependenceKey } from './independence';
import { resolveStatus } from './engine';

export interface SourceValueLike<T> {
  sourceId: string;
  value: T;
  timeBlocked?: boolean;
  /** ?8.4B ? instrument identity (e.g. 'XAUUSD.spot'). Optional. */
  instrument?: string;
  /** ?8.4E ? lineage id from CanonicalCandle. Optional. */
  lineageId?: string;
}

export interface EnrichOptions<T> {
  asOfCutoff: string;
  engineVersion: string;
  reportId?: string;
  fieldName?: string;
  fieldAccessor?: (v: T) => number | null;
  outlierPolicy?: { method: 'MAD' | 'ZSCORE'; threshold: number };
  independenceKeys?: Readonly<Record<string, string>>;
  /** ?8.4A ? list of eligible source IDs per field. Field missing ? all eligible. */
  eligibilityByField?: Readonly<Record<string, ReadonlyArray<string>>>;
  /** ?8.4B ? expected instrument for this enrichment. Missing ? skip instrument filter. */
  referenceInstrument?: string;
  /** ?8.4C ? priority order per field. Missing ? prefer USED, else first-in-group. */
  priorityByField?: Readonly<Record<string, ReadonlyArray<string>>>;
}

export interface SourceCounts {
  total: number;
  comparable: number;
  blocked: number;
  dropped_by_policy: number;
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
  /** ?8.4D ? true when caller must avoid sensitive uses (conflict exceeded / insufficient / failed). */
  sensitive_use_blocked: boolean;
}

export type EnrichedFusionResult<T> = FusionResult<T> & FusionReportAddon;

function defaultAccessor<T>(v: T): number | null {
  const anyV = v as { close?: unknown };
  return typeof anyV?.close === 'number' ? anyV.close : null;
}

function makeReportId(): string {
  return 'rep-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function isEligible(
  sourceId: string,
  fieldName: string,
  eligibilityByField: Readonly<Record<string, ReadonlyArray<string>>>,
): boolean {
  const list = eligibilityByField[fieldName];
  if (list === undefined) return true;
  return list.includes(sourceId);
}

function isInstrumentMatch(
  sourceInstrument: string | undefined,
  referenceInstrument: string | undefined,
): boolean {
  if (referenceInstrument === undefined) return true;
  if (sourceInstrument === undefined) return true;   // no info ? pass (backward compat)
  return sourceInstrument === referenceInstrument;
}

function isSensitiveBlocked(status: FusionStatus): boolean {
  return status !== 'CONSISTENT' && status !== 'SKIPPED';
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
  const eligibilityByField = opts.eligibilityByField ?? {};
  const priorityByField = opts.priorityByField ?? {};

  const anyResult = result as unknown as {
    droppedSources: ReadonlyArray<{ sourceId: string; reason: string }>;
    provenance: ReadonlyArray<{ sourceId: string }>;
    fusedValue: unknown;
  };

  const droppedIds = new Set(anyResult.droppedSources.map((d) => d.sourceId));
  const provenanceIds = new Set(anyResult.provenance.map((p) => p.sourceId));

  // ?? [1] Base raw values ????????????????????????????????????????
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
      ...(v.lineageId !== undefined ? { lineage_id: v.lineageId } : {}),
      source_independence_key: resolveIndependenceKey(v.sourceId, independenceKeys),
    };
  });

  // ?? [2] ?8.4A eligibility filter ???????????????????????????????
  rawValues = rawValues.map((r) => {
    if (r.status === 'BLOCKED') return r;
    if (r.status === 'DROPPED') return r;   // keep fuse's reason
    if (!isEligible(r.sourceId, fieldName, eligibilityByField)) {
      return { ...r, status: 'DROPPED' as const, reason: 'NOT_ELIGIBLE_FOR_FIELD' };
    }
    return r;
  });

  // ?? [3] ?8.4B instrument filter ????????????????????????????????
  if (opts.referenceInstrument !== undefined) {
    const instrumentBySource = new Map<string, string | undefined>();
    for (const v of values) instrumentBySource.set(v.sourceId, v.instrument);
    rawValues = rawValues.map((r) => {
      if (r.status === 'BLOCKED') return r;
      if (r.status === 'DROPPED') return r;
      const ins = instrumentBySource.get(r.sourceId);
      if (!isInstrumentMatch(ins, opts.referenceInstrument)) {
        return { ...r, status: 'DROPPED' as const, reason: 'INSTRUMENT_MISMATCH' };
      }
      return r;
    });
  }

  // ?? [4] outlier detection ??????????????????????????????????????
  const outlierIds = new Set<string>();
  if (opts.outlierPolicy?.method === 'MAD') {
    const candidates = rawValues
      .filter((r) => r.value !== null && r.status !== 'BLOCKED' && r.status !== 'DROPPED')
      .map((r) => ({ sourceId: r.sourceId, value: r.value as number }));
    const det = detectOutliersMAD(candidates, opts.outlierPolicy.threshold);
    for (const o of det.outliers) outlierIds.add(o.sourceId);
  }
  rawValues = rawValues.map((r) =>
    outlierIds.has(r.sourceId) && r.status !== 'BLOCKED' && r.status !== 'DROPPED'
      ? { ...r, status: 'DROPPED' as const, reason: 'OUTLIER_MAD_GT_THRESHOLD' }
      : r,
  );

  // ?? [5] independence grouping ??????????????????????????????????
  const usable = rawValues.filter(
    (r) => (r.status === 'USED' || r.status === 'NOT_COMPARABLE') && r.value !== null,
  );
  const groups = groupSourcesByIndependence(
    usable.map((r) => ({ sourceId: r.sourceId })),
    independenceKeys,
  );
  const independent_evidence = groups.length;

  // ?? [6] ?8.4C priority-aware representatives ???????????????????
  const priority = priorityByField[fieldName] ?? [];
  const priorityIndex = new Map<string, number>();
  priority.forEach((sid, i) => priorityIndex.set(sid, i));

  const priceBySource = new Map<string, number>();
  for (const r of usable) priceBySource.set(r.sourceId, r.value as number);

  const representatives: Array<{ sourceId: string; price: number }> = [];
  for (const g of groups) {
    const usedInGroup = g.sourceIds.find((s) => provenanceIds.has(s));
    const prioritized = g.sourceIds
      .filter((s) => priorityIndex.has(s))
      .sort((a, b) => priorityIndex.get(a)! - priorityIndex.get(b)!);
    const repId = usedInGroup ?? prioritized[0] ?? g.sourceIds[0]!;
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
    sensitive_use_blocked: isSensitiveBlocked(status),
  };
}
`, 'utf8');
ok('enrich.ts (?8.4)');

// ????????? [2/4] report.ts ?????????
fs.writeFileSync('src/data-fusion/report.ts', `import type { FusionReport, FusionDroppedSource } from './types';
import type { EnrichedFusionResult } from './enrich';

function defaultAccessor<T>(v: T): number | null {
  const anyV = v as { close?: unknown };
  return typeof anyV?.close === 'number' ? anyV.close : null;
}

export function toFusionReport<T>(
  enriched: EnrichedFusionResult<T>,
  accessor: (v: T) => number | null = defaultAccessor,
): FusionReport {
  const rawFused = enriched.fusedValue as unknown as T | null | undefined;
  const fusedNumber: number | null =
    rawFused === null || rawFused === undefined ? null : accessor(rawFused);

  const sources_dropped: FusionDroppedSource[] = enriched.raw_values
    .filter((r) => r.status === 'DROPPED')
    .map((r) => ({ sourceId: r.sourceId, reason: r.reason }));

  const sources_used = enriched.raw_values.filter((r) => r.status === 'USED').length;

  return {
    report_id: enriched.report_id,
    as_of_cutoff: enriched.as_of_cutoff,
    policy_version: enriched.policy_version,
    engine_version: enriched.engine_version,
    conflict_status: enriched.conflictStatus,
    fused_value: fusedNumber,
    raw_values: enriched.raw_values,
    deltas: enriched.deltas,
    sources_used,
    sources_dropped,
    source_counts: {
      total: enriched.source_counts.total,
      comparable: enriched.source_counts.comparable,
      blocked: enriched.source_counts.blocked,
      dropped_by_policy: enriched.source_counts.dropped_by_policy,
    },
  };
}
`, 'utf8');
ok('report.ts');

// ????????? [3/4] test enrich-8.4 ?????????
fs.writeFileSync('src/tests/fusion-enrich-v84.test.ts', `import { describe, it, expect } from 'vitest';
import { enrichFusionResult } from '../data-fusion/enrich';

type Src = { sourceId: string; value: { close: number }; timeBlocked?: boolean; instrument?: string; lineageId?: string };
const mkSrc = (id: string, close: number, extra: Partial<Src> = {}): Src => ({
  sourceId: id,
  value: { close },
  ...extra,
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

describe('?8.4A ? eligibility per field', () => {
  it('no policy ? all eligible', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100)], policy, opts);
    expect(r.raw_values.every((v) => v.reason !== 'NOT_ELIGIBLE_FOR_FIELD')).toBe(true);
  });
  it('eligibility restricts sources for that field', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }, { sourceId: 'C' }] }),
      [mkSrc('A', 100), mkSrc('B', 100), mkSrc('C', 100)],
      policy,
      { ...opts, eligibilityByField: { close: ['A', 'C'] } },
    );
    const b = r.raw_values.find((v) => v.sourceId === 'B')!;
    expect(b.status).toBe('DROPPED');
    expect(b.reason).toBe('NOT_ELIGIBLE_FOR_FIELD');
  });
  it('other-field rules do not affect this field', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100), mkSrc('B', 100), mkSrc('C', 100)],
      policy,
      { ...opts, eligibilityByField: { volume: ['A'] } },
    );
    expect(r.raw_values.every((v) => v.reason !== 'NOT_ELIGIBLE_FOR_FIELD')).toBe(true);
  });
  it('ineligible sources reduce independent_evidence', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }] }),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy,
      { ...opts, eligibilityByField: { close: ['A'] } },
    );
    expect(r.source_counts.independent_evidence).toBe(1);
    expect(r.conflictStatus).toBe('INSUFFICIENT_COMPARABLE_DATA');
  });
});

describe('?8.4B ? instrument matching', () => {
  it('no referenceInstrument ? no filter', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { instrument: 'XAUUSD.spot' }), mkSrc('B', 100, { instrument: 'XAUUSD.fut' })],
      policy, opts,
    );
    expect(r.raw_values.every((v) => v.reason !== 'INSTRUMENT_MISMATCH')).toBe(true);
  });
  it('mismatch ? DROPPED with INSTRUMENT_MISMATCH', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { instrument: 'XAUUSD.spot' }), mkSrc('B', 100, { instrument: 'XAUUSD.fut' })],
      policy,
      { ...opts, referenceInstrument: 'XAUUSD.spot' },
    );
    const b = r.raw_values.find((v) => v.sourceId === 'B')!;
    expect(b.status).toBe('DROPPED');
    expect(b.reason).toBe('INSTRUMENT_MISMATCH');
  });
  it('all matching ? deltas computed', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { instrument: 'XAUUSD.spot' }), mkSrc('B', 100, { instrument: 'XAUUSD.spot' })],
      policy,
      { ...opts, referenceInstrument: 'XAUUSD.spot' },
    );
    expect(r.conflictStatus).toBe('CONSISTENT');
    expect(r.deltas).toHaveLength(1);
  });
  it('missing instrument ? passes', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { instrument: 'XAUUSD.spot' }), mkSrc('B', 100)],
      policy,
      { ...opts, referenceInstrument: 'XAUUSD.spot' },
    );
    expect(r.raw_values.find((v) => v.sourceId === 'B')!.reason).not.toBe('INSTRUMENT_MISMATCH');
  });
});

describe('?8.4C ? priority per field', () => {
  it('priority breaks tie when USED absent', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [] }),
      [mkSrc('A', 100), mkSrc('B', 100.5), mkSrc('C', 100.1)],
      policy,
      {
        ...opts,
        independenceKeys: { A: 'K1', B: 'K1', C: 'K2' },
        priorityByField: { close: ['B', 'A'] },
      },
    );
    expect(r.deltas).toHaveLength(1);
    expect(r.deltas[0]!.delta_p).toBeCloseTo(0.4, 5);
  });
  it('USED beats priority', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'A' }] }),
      [mkSrc('A', 100), mkSrc('B', 101), mkSrc('C', 105)],
      policy,
      {
        ...opts,
        independenceKeys: { A: 'K1', B: 'K1', C: 'K2' },
        priorityByField: { close: ['B', 'A'] },
      },
    );
    expect(r.deltas[0]!.delta_p).toBeCloseTo(-5, 5);
  });
});

describe('?8.4D ? sensitive_use_blocked', () => {
  it('CONSISTENT ? not blocked', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100)], policy, opts);
    expect(r.sensitive_use_blocked).toBe(false);
  });
  it('DISCREPANCY ? blocked', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 105)], policy, opts);
    expect(r.conflictStatus).toBe('DISCREPANCY');
    expect(r.sensitive_use_blocked).toBe(true);
  });
  it('INSUFFICIENT_COMPARABLE_DATA ? blocked', () => {
    const r = enrichFusionResult(
      mkResult({ provenance: [{ sourceId: 'B' }], droppedSources: [{ sourceId: 'A', reason: 'TIME_BLOCKED' }] }),
      [mkSrc('A', 100, { timeBlocked: true }), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.conflictStatus).toBe('INSUFFICIENT_COMPARABLE_DATA');
    expect(r.sensitive_use_blocked).toBe(true);
  });
});

describe('?8.4E ? lineage_id propagation', () => {
  it('lineageId ? lineage_id on FusedRawValue', () => {
    const r = enrichFusionResult(
      mkResult(),
      [mkSrc('A', 100, { lineageId: 'lin-A-001' }), mkSrc('B', 100)],
      policy, opts,
    );
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.lineage_id).toBe('lin-A-001');
  });
  it('missing lineageId ? undefined', () => {
    const r = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100)], policy, opts);
    expect(r.raw_values.find((v) => v.sourceId === 'A')!.lineage_id).toBeUndefined();
  });
});
`, 'utf8');
ok('test enrich-8.4');

// ????????? [4/4] test report-adapter ?????????
fs.writeFileSync('src/tests/fusion-report-adapter.test.ts', `import { describe, it, expect } from 'vitest';
import { enrichFusionResult } from '../data-fusion/enrich';
import { toFusionReport } from '../data-fusion/report';

type Src = { sourceId: string; value: { close: number } };
const mkSrc = (id: string, close: number): Src => ({ sourceId: id, value: { close } });
const mkResult = (overrides: Record<string, unknown> = {}): any => ({
  conflictStatus: 'CONSISTENT',
  fusedValue: { close: 100 },
  droppedSources: [],
  provenance: [{ sourceId: 'A' }, { sourceId: 'B' }],
  ...overrides,
});
const policy = { policyVersion: 'v1', toleranceBps: 50 };
const opts = { asOfCutoff: '2026-01-01T00:00:00Z', engineVersion: 'test' };

describe('?8.4F ? toFusionReport adapter', () => {
  it('produces FusionReport with all fields populated', () => {
    const enriched = enrichFusionResult(mkResult(), [mkSrc('A', 100), mkSrc('B', 100.2)], policy, opts);
    const report = toFusionReport(enriched);
    expect(report.report_id).toBe(enriched.report_id);
    expect(report.as_of_cutoff).toBe(opts.asOfCutoff);
    expect(report.policy_version).toBe('v1');
    expect(report.engine_version).toBe('test');
    expect(report.conflict_status).toBe('CONSISTENT');
    expect(report.fused_value).toBe(100);
    expect(report.raw_values).toEqual(enriched.raw_values);
    expect(report.deltas).toEqual(enriched.deltas);
    expect(report.sources_used).toBe(2);
    expect(report.sources_dropped).toEqual([]);
    expect(report.source_counts.total).toBe(2);
    expect(report.source_counts.comparable).toBe(2);
    expect(report.source_counts.blocked).toBe(0);
    expect(report.source_counts.dropped_by_policy).toBe(0);
  });
  it('sources_dropped reflects DROPPED raw values', () => {
    const enriched = enrichFusionResult(
      mkResult({ droppedSources: [{ sourceId: 'B', reason: 'POLICY' }] }),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy, opts,
    );
    expect(toFusionReport(enriched).sources_dropped).toEqual([{ sourceId: 'B', reason: 'POLICY' }]);
  });
  it('null fusedValue ? fused_value: null', () => {
    const enriched = enrichFusionResult(
      mkResult({ fusedValue: null, provenance: [] }),
      [mkSrc('A', 100)],
      policy, opts,
    );
    expect(toFusionReport(enriched).fused_value).toBeNull();
  });
  it('custom accessor extracts fused_value', () => {
    const enriched = enrichFusionResult(
      mkResult({ fusedValue: { open: 55, close: 100 } as any }),
      [mkSrc('A', 100), mkSrc('B', 100)],
      policy, opts,
    );
    expect(toFusionReport(enriched, (v: any) => v.open ?? null).fused_value).toBe(55);
  });
});
`, 'utf8');
ok('test report-adapter');

console.log('\nDONE. ?8.4 files written.');
