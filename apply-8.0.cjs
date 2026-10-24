const fs   = require('fs');
const path = require('path');
const ok   = (m) => console.log('  [OK]   ' + m);
const warn = (m) => console.log('  [WARN] ' + m);
const err  = (m) => { console.log('  [ERR]  ' + m); process.exit(1); };

const FUSION_DIR = 'src/data-fusion';
const ENGINE     = path.join(FUSION_DIR, 'engine.ts');
const TEST_DIR   = 'src/tests';
const NEW_TEST   = path.join(TEST_DIR, 'fusion-status-migration.test.ts');

if (!fs.existsSync(FUSION_DIR)) err('run from repo root (src/data-fusion missing)');
if (!fs.existsSync(ENGINE))     err('engine.ts missing');

// ?? locate ConflictStatus definition ???????????????????????????
const allFusion = fs.readdirSync(FUSION_DIR).filter(f => f.endsWith('.ts')).map(f => path.join(FUSION_DIR, f));
const statusFiles = allFusion.filter(f => /export\s+(type|enum|const)\s+ConflictStatus\b/.test(fs.readFileSync(f, 'utf8')));
if (statusFiles.length === 0) err('ConflictStatus not found under src/data-fusion/*.ts');
if (statusFiles.length > 1)   warn('multiple ConflictStatus defs -> ' + statusFiles.join(', '));

const statusFile = statusFiles[0];
const statusBase = path.basename(statusFile, '.ts');
const statusSelf = path.resolve(statusFile) === path.resolve(ENGINE);
console.log('  -> ConflictStatus defined in: ' + statusFile);

// ??????????? [1/5] types ???????????
console.log('\n[1/5] types');
let src = fs.readFileSync(statusFile, 'utf8');

if (!/export\s+type\s+FusionStatus\b/.test(src)) {
  const re = /export\s+(?:type|enum|const)\s+ConflictStatus\b[\s\S]*?;(?=\s*(?:\/\/|\n\n|export|import|$))/m;
  if (!re.test(src)) err('ConflictStatus block not matched ? inspect ' + statusFile);
  src = src.replace(re,
`export type FusionStatus =
  | 'CONSISTENT'
  | 'DISCREPANCY'
  | 'UNRESOLVED_CONFLICT'
  | 'INSUFFICIENT_COMPARABLE_DATA'
  | 'FAILED'
  | 'SKIPPED';

export const FUSION_STATUS_VALUES: ReadonlyArray<FusionStatus> = [
  'CONSISTENT', 'DISCREPANCY', 'UNRESOLVED_CONFLICT',
  'INSUFFICIENT_COMPARABLE_DATA', 'FAILED', 'SKIPPED',
] as const;

/** @deprecated use FusionStatus */
export type ConflictStatus = FusionStatus;

export type LegacyConflictStatus =
  | 'NONE' | 'RESOLVED_BY_TOLERANCE' | 'RESOLVED_BY_POLICY'
  | 'UNRESOLVED' | 'TIME_BLOCKED';`
  );
  ok('ConflictStatus -> FusionStatus');
} else {
  ok('FusionStatus already present');
}

if (!/\binterface\s+FusionReport\b/.test(src)) {
  src += `

// -- ?8.0 ? FusionReport (expanded) ------------------------------
export interface FusedRawValue {
  sourceId: string;
  field: string;
  value: number | null;
  status: 'USED' | 'DROPPED' | 'BLOCKED' | 'NOT_COMPARABLE';
  reason: string;
  lineage_id?: string;
  source_independence_key?: string;
}
export interface FusedDelta {
  from: string;
  to: string;
  delta_p: number;
  delta_p_pct: number | null;
}
export interface FusionDroppedSource {
  sourceId: string;
  reason: string;
}
export interface FusionReport {
  report_id: string;
  as_of_cutoff: string;
  policy_version: string;
  engine_version: string;
  conflict_status: FusionStatus;
  fused_value: number | null;
  raw_values: ReadonlyArray<FusedRawValue>;
  deltas: ReadonlyArray<FusedDelta>;
  sources_used: number;
  sources_dropped: ReadonlyArray<FusionDroppedSource>;
  source_counts: {
    total: number;
    comparable: number;
    blocked: number;
    dropped_by_policy: number;
  };
}
`;
  ok('appended FusionReport types');
} else {
  ok('FusionReport already present');
}
fs.writeFileSync(statusFile, src, 'utf8');

// ??????????? [2/5] migrate.ts ???????????
console.log('\n[2/5] migrate.ts');
const importPath = './' + statusBase;
fs.writeFileSync(path.join(FUSION_DIR, 'migrate.ts'),
`import { FusionReport, FusionStatus, LegacyConflictStatus } from '${importPath}';

const LEGACY_MAP: Record<LegacyConflictStatus, FusionStatus> = {
  NONE: 'CONSISTENT',
  RESOLVED_BY_TOLERANCE: 'CONSISTENT',
  RESOLVED_BY_POLICY: 'CONSISTENT',
  UNRESOLVED: 'UNRESOLVED_CONFLICT',
  TIME_BLOCKED: 'INSUFFICIENT_COMPARABLE_DATA',
};

export function migrateLegacyStatus(
  legacy: LegacyConflictStatus,
  ctx: { totalSources: number; blockedSources: number } = { totalSources: 2, blockedSources: 0 },
): FusionStatus {
  if (legacy === 'NONE' && ctx.totalSources < 2) return 'INSUFFICIENT_COMPARABLE_DATA';
  return LEGACY_MAP[legacy];
}

export function migrateLegacyReport(legacy: Record<string, unknown>): FusionReport {
  const status = migrateLegacyStatus(
    (legacy.conflict_status ?? legacy.status ?? 'NONE') as LegacyConflictStatus,
    {
      totalSources: Number(legacy.sources_total ?? legacy.sources_used ?? 1),
      blockedSources: Number(legacy.sources_blocked ?? 0),
    },
  );
  return {
    report_id: String(legacy.report_id ?? 'migrated'),
    as_of_cutoff: String(legacy.as_of_cutoff ?? new Date(0).toISOString()),
    policy_version: String(legacy.policy_version ?? 'legacy'),
    engine_version: String(legacy.engine_version ?? 'legacy'),
    conflict_status: status,
    fused_value: typeof legacy.fused_value === 'number' ? legacy.fused_value : null,
    raw_values: [],
    deltas: [],
    sources_used: Number(legacy.sources_used ?? 0),
    sources_dropped: [],
    source_counts: {
      total: Number(legacy.sources_total ?? legacy.sources_used ?? 0),
      comparable: Number(legacy.sources_used ?? 0),
      blocked: Number(legacy.sources_blocked ?? 0),
      dropped_by_policy: 0,
    },
  };
}
`, 'utf8');
ok('migrate.ts written');

// ??????????? [3/5] engine.ts ???????????
console.log('\n[3/5] engine.ts');
let eng = fs.readFileSync(ENGINE, 'utf8');

const legacyRefs = {
  'ConflictStatus.NONE':                  "'CONSISTENT'",
  'ConflictStatus.RESOLVED_BY_TOLERANCE': "'CONSISTENT'",
  'ConflictStatus.RESOLVED_BY_POLICY':    "'CONSISTENT'",
  'ConflictStatus.UNRESOLVED':            "'UNRESOLVED_CONFLICT'",
  'ConflictStatus.TIME_BLOCKED':          "'INSUFFICIENT_COMPARABLE_DATA'",
};
let hits = 0;
for (const [k, v] of Object.entries(legacyRefs)) {
  if (eng.includes(k)) { eng = eng.split(k).join(v); hits++; }
}
hits ? ok('settled ' + hits + ' legacy ConflictStatus.* ref(s)') : ok('no legacy refs in engine.ts');

if (!/function\s+resolveStatus\b/.test(eng)) {
  const statusType = statusSelf ? 'FusionStatus' : `import('${importPath}').FusionStatus`;
  eng += `

// -- ?8.0 ? status resolver -------------------------------------
export interface StatusInputs {
  total: number;
  comparable: number;
  blocked: number;
  droppedByPolicy: number;
  withinTolerance: boolean | null;
  policyResolved: boolean;
  policyFailed: boolean;
  comparisonSkipped: boolean;
}

export function resolveStatus(i: StatusInputs): ${statusType} {
  if (i.comparisonSkipped) return 'SKIPPED';
  if (i.total === 0) return 'SKIPPED';
  if (i.blocked === i.total) return 'INSUFFICIENT_COMPARABLE_DATA';
  if (i.comparable < 2) return 'INSUFFICIENT_COMPARABLE_DATA';
  if (i.policyFailed) return 'UNRESOLVED_CONFLICT';
  if (i.withinTolerance === true) return 'CONSISTENT';
  if (i.withinTolerance === false && i.policyResolved) return 'DISCREPANCY';
  if (i.withinTolerance === false) return 'UNRESOLVED_CONFLICT';
  return 'FAILED';
}
`;
  ok('resolveStatus appended');
} else {
  ok('resolveStatus already present');
}
fs.writeFileSync(ENGINE, eng, 'utf8');

// ??????????? [4/5] patch existing tests (skip our new file) ???????????
console.log('\n[4/5] patch existing tests');
if (!fs.existsSync(TEST_DIR)) err('src/tests missing');
let patched = 0;
for (const f of fs.readdirSync(TEST_DIR)) {
  if (!f.endsWith('.ts')) continue;
  const full = path.join(TEST_DIR, f);
  if (path.resolve(full) === path.resolve(NEW_TEST)) continue;
  let t = fs.readFileSync(full, 'utf8');
  const before = t;
  t = t.replace(/ConflictStatus\.TIME_BLOCKED/g, "'INSUFFICIENT_COMPARABLE_DATA'")
       .replace(/'TIME_BLOCKED'/g,                "'INSUFFICIENT_COMPARABLE_DATA'");
  if (t !== before) { fs.writeFileSync(full, t, 'utf8'); patched++; ok('patched ' + f); }
}
patched || warn('no existing tests referenced TIME_BLOCKED');

// ??????????? [5/5] write new test (last, to avoid self-patch) ???????????
console.log('\n[5/5] new test file');
fs.writeFileSync(NEW_TEST,
`import { describe, it, expect } from 'vitest';
import { migrateLegacyStatus, migrateLegacyReport } from '../data-fusion/migrate';
import { FUSION_STATUS_VALUES, FusionStatus } from '../data-fusion/${statusBase}';

describe('?8.0 ? FusionStatus union', () => {
  it('exposes exactly 6 canonical statuses', () => {
    expect(FUSION_STATUS_VALUES).toHaveLength(6);
    expect(new Set(FUSION_STATUS_VALUES).size).toBe(6);
  });
});

describe('?8.0 ? legacy status migration', () => {
  it('RESOLVED_BY_TOLERANCE -> CONSISTENT', () =>
    expect(migrateLegacyStatus('RESOLVED_BY_TOLERANCE')).toBe('CONSISTENT'));
  it('RESOLVED_BY_POLICY -> CONSISTENT', () =>
    expect(migrateLegacyStatus('RESOLVED_BY_POLICY')).toBe('CONSISTENT'));
  it('UNRESOLVED -> UNRESOLVED_CONFLICT', () =>
    expect(migrateLegacyStatus('UNRESOLVED')).toBe('UNRESOLVED_CONFLICT'));
  it('TIME_BLOCKED -> INSUFFICIENT_COMPARABLE_DATA', () =>
    expect(migrateLegacyStatus('TIME_BLOCKED')).toBe('INSUFFICIENT_COMPARABLE_DATA'));
  it('NONE + 1 source -> INSUFFICIENT_COMPARABLE_DATA', () =>
    expect(migrateLegacyStatus('NONE', { totalSources: 1, blockedSources: 0 }))
      .toBe('INSUFFICIENT_COMPARABLE_DATA'));
  it('NONE + 2 sources -> CONSISTENT', () =>
    expect(migrateLegacyStatus('NONE', { totalSources: 2, blockedSources: 0 }))
      .toBe('CONSISTENT'));
});

describe('?8.0 ? legacy report migration', () => {
  it('produces FusionReport with deltas: []', () => {
    const r = migrateLegacyReport({ conflict_status: 'UNRESOLVED', sources_used: 2 });
    const s: FusionStatus = r.conflict_status;
    expect(s).toBe('UNRESOLVED_CONFLICT');
    expect(r.deltas).toEqual([]);
  });
});
`, 'utf8');
ok('fusion-status-migration.test.ts written');

console.log('\nDONE. ?8.0 applied.');
