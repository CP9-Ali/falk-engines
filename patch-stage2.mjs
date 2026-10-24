import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';

const args = process.argv.slice(2);
const isDryRun   = args.includes('--dry-run');
const isRollback = args.includes('--rollback');
const noVerify   = args.includes('--no-verify');
const fromArg    = args.find(a => a.startsWith('--from='))?.slice('--from='.length);

const TIMESTAMP  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = join('_backups', `stage2-${TIMESTAMP}`);

// ============================================================
// NEW FILES
// ============================================================

const NEW_FILES = {

'src/data-quality/checks/precision.ts': `import type { QualityCheck } from './base';
import { PRECISION_BY_SOURCE } from '../../normalization/canonical';

/**
 * DQ-PRECISION: يكشف انحراف دقة OHLC عن المواصفة المسجلة في PRECISION_BY_SOURCE
 * يستخدم decimal_places (لا tick_size) لتجنب false positives
 */
export const precisionCheck: QualityCheck = {
  checkId: 'DQ-PRECISION',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out = [];
    const spec = PRECISION_BY_SOURCE[ctx.sourceId];
    if (!spec || !Number.isFinite(spec.decimal_places) || spec.decimal_places < 0) {
      return out;
    }
    const multiplier = Math.pow(10, spec.decimal_places);
    for (const p of ctx.points) {
      for (const field of ['open', 'high', 'low', 'close'] as const) {
        const v = p.value[field];
        if (!Number.isFinite(v)) continue;
        const scaled = v * multiplier;
        const drift = Math.abs(scaled - Math.round(scaled));
        if (drift > 1e-6) {
          out.push({
            checkId: 'DQ-PRECISION-001',
            category: 'ANOMALY' as const,
            severity: 'WARNING' as const,
            message: field + '=' + v + ' exceeds ' + spec.decimal_places + ' decimal places (spec drift)',
            affectedRange: { from: p.eventTime, to: p.eventTime },
            evidence: { field, value: v, drift, specDecimalPlaces: spec.decimal_places },
          });
          break;
        }
      }
    }
    return out;
  },
};
`,

'src/data-quality/checks/volume-semantics.ts': `import type { QualityCheck } from './base';
import { VOLUME_SEMANTICS_BY_SOURCE } from '../../normalization/canonical';

/**
 * DQ-VOLUME-SEMANTICS: يحذر عندما يعرض المصدر حجماً لكن دلالته غير مسجلة (UNKNOWN)
 * الوجود مع UNKNOWN = لا يمكن استخدامه في volume_profile
 */
export const volumeSemanticsCheck: QualityCheck = {
  checkId: 'DQ-VOLUME-SEMANTICS',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out = [];
    const semantics = VOLUME_SEMANTICS_BY_SOURCE[ctx.sourceId] ?? 'UNKNOWN';
    if (semantics !== 'UNKNOWN') return out;

    const withVolume = ctx.points.filter(p => Number.isFinite(p.value.volume) && p.value.volume > 0);
    if (withVolume.length === 0) return out;

    out.push({
      checkId: 'DQ-VOLUME-SEMANTICS-001',
      category: 'SUITABILITY' as const,
      severity: 'WARNING' as const,
      message: ctx.sourceId + ' reports volume but semantics is UNKNOWN (' + withVolume.length + '/' + ctx.points.length + ' points affected)',
      affectedRange: {
        from: withVolume[0].eventTime,
        to: withVolume[withVolume.length - 1].eventTime,
      },
      evidence: {
        sourceId: ctx.sourceId,
        affectedPoints: withVolume.length,
        totalPoints: ctx.points.length,
      },
    });
    return out;
  },
};
`,

'src/data-quality/checks/timezone.ts': `import type { QualityCheck } from './base';
import { SOURCE_TIMEZONE } from '../../normalization/canonical';

/**
 * DQ-TIMEZONE: يحذر عندما لا يكون للمصدر منطقة زمنية مسجلة
 * downstream: time-sensitive comparisons تُحجب (time_blocked)
 */
export const timezoneCheck: QualityCheck = {
  checkId: 'DQ-TIMEZONE',
  checkVersion: '1.0.0',
  parameters: {},
  run(ctx) {
    const out = [];
    const tz = SOURCE_TIMEZONE[ctx.sourceId];
    if (tz) return out;

    out.push({
      checkId: 'DQ-TIMEZONE-001',
      category: 'FRESHNESS' as const,
      severity: 'HIGH' as const,
      message: 'source ' + ctx.sourceId + ' has no registered timezone — time-sensitive comparisons will be blocked downstream',
      affectedRange: { from: ctx.range.from, to: ctx.range.to },
      evidence: { sourceId: ctx.sourceId },
    });
    return out;
  },
};
`,

'src/tests/stage2-quality-checks.test.ts': `import { describe, it, expect } from 'vitest';
import { precisionCheck } from '../data-quality/checks/precision';
import { volumeSemanticsCheck } from '../data-quality/checks/volume-semantics';
import { timezoneCheck } from '../data-quality/checks/timezone';
import type { CheckContext, Candle } from '../data-quality/checks/base';
import type { RawDataPoint } from '../core/types';

function makePoint(sourceId: string, candle: Candle, eventTime = '2026-10-24T12:00:00.000Z'): RawDataPoint<Candle> {
  return {
    sourceId,
    value: candle,
    eventTime,
    arrivalTime: '2026-10-24T12:00:01.000Z',
    availabilityTime: '2026-10-24T12:00:01.000Z',
    version: 1,
    fingerprint: 'fp-' + sourceId,
  };
}

function makeCtx(sourceId: string, points: RawDataPoint<Candle>[]): CheckContext<Candle> {
  return {
    sourceId,
    points,
    range: { from: '2026-10-24T00:00:00.000Z', to: '2026-10-24T23:59:59.999Z' },
    expectedCadenceMs: 60_000,
    asOfCutoff: '2026-10-24T23:59:59.999Z',
  };
}

describe('DQ-PRECISION', () => {
  it('passes values within spec decimal_places', () => {
    const ctx = makeCtx('xaus-api', [
      makePoint('xaus-api', { open: 2345.67, high: 2345.89, low: 2345.42, close: 2345.75, volume: 100 }),
    ]);
    expect(precisionCheck.run(ctx)).toHaveLength(0);
  });

  it('flags value exceeding spec decimal_places', () => {
    const ctx = makeCtx('xaus-api', [
      makePoint('xaus-api', { open: 2345.678, high: 2345.89, low: 2345.42, close: 2345.75, volume: 100 }),
    ]);
    const findings = precisionCheck.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].checkId).toBe('DQ-PRECISION-001');
    expect(findings[0].severity).toBe('WARNING');
  });

  it('returns no findings when source has no precision spec', () => {
    const ctx = makeCtx('unknown-source', [
      makePoint('unknown-source', { open: 1.123456, high: 2, low: 1, close: 1.5, volume: 10 }),
    ]);
    expect(precisionCheck.run(ctx)).toHaveLength(0);
  });
});

describe('DQ-VOLUME-SEMANTICS', () => {
  it('flags volume present with UNKNOWN semantics', () => {
    const ctx = makeCtx('twelvedata-ws', [
      makePoint('twelvedata-ws', { open: 1, high: 2, low: 1, close: 1.5, volume: 100 }),
    ]);
    const findings = volumeSemanticsCheck.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].checkId).toBe('DQ-VOLUME-SEMANTICS-001');
    expect(findings[0].category).toBe('SUITABILITY');
  });

  it('passes when semantics is known', () => {
    const ctx = makeCtx('binance-paxg', [
      makePoint('binance-paxg', { open: 1, high: 2, low: 1, close: 1.5, volume: 100 }),
    ]);
    expect(volumeSemanticsCheck.run(ctx)).toHaveLength(0);
  });

  it('passes when volume is zero even with UNKNOWN semantics', () => {
    const ctx = makeCtx('twelvedata-ws', [
      makePoint('twelvedata-ws', { open: 1, high: 2, low: 1, close: 1.5, volume: 0 }),
    ]);
    expect(volumeSemanticsCheck.run(ctx)).toHaveLength(0);
  });
});

describe('DQ-TIMEZONE', () => {
  it('flags source with no registered timezone', () => {
    const ctx = makeCtx('made-up-source', [
      makePoint('made-up-source', { open: 1, high: 2, low: 1, close: 1.5, volume: 10 }),
    ]);
    const findings = timezoneCheck.run(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].checkId).toBe('DQ-TIMEZONE-001');
    expect(findings[0].severity).toBe('HIGH');
  });

  it('passes when source has registered timezone', () => {
    const ctx = makeCtx('binance-paxg', [
      makePoint('binance-paxg', { open: 1, high: 2, low: 1, close: 1.5, volume: 10 }),
    ]);
    expect(timezoneCheck.run(ctx)).toHaveLength(0);
  });
});
`,
};

// ============================================================
// PATCHES TO EXISTING FILES
// ============================================================

const PATCHES = [
  {
    file: 'src/data-quality/engine.ts',
    changes: [
      {
        name: 'add volumeSemanticsIssue flag',
        find: /(const volumeIssue = findings\.some\([^\n]+\n)/,
        replace: (m, line) =>
          line +
          "  const volumeSemanticsIssue = findings.some(f => f.checkId.startsWith('DQ-VOLUME-SEMANTICS'));\n",
      },
      {
        name: 'gate volume_profile by volumeSemanticsIssue',
        find: /volume_profile: fullOk && !volumeIssue,/,
        replace: 'volume_profile: fullOk && !volumeIssue && !volumeSemanticsIssue,',
      },
    ],
  },
];

// ============================================================
// HELPERS
// ============================================================

function eolRead(path) {
  const content = readFileSync(path, 'utf8');
  const hasCRLF = content.includes('\r\n');
  return { hasCRLF, normalized: hasCRLF ? content.replace(/\r\n/g, '\n') : content };
}

function eolWrite(path, normalized, hasCRLF) {
  const out = hasCRLF ? normalized.replace(/\n/g, '\r\n') : normalized;
  writeFileSync(path, out, 'utf8');
}

function backupFile(path) {
  if (isDryRun) return null;
  const safe = path.replace(/[\/\\:]/g, '__');
  const dest = join(BACKUP_DIR, safe);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(path, dest);
  return dest;
}

function applyChange(content, change, file) {
  if (!change.find.test(content)) {
    console.log(`  [MISS] ${file}: ${change.name}`);
    return null;
  }
  const after = typeof change.replace === 'function'
    ? content.replace(change.find, change.replace)
    : content.replace(change.find, change.replace);
  if (after === content) {
    console.log(`  [SAME] ${file}: ${change.name}`);
    return null;
  }
  console.log(`  [ OK ] ${file}: ${change.name}`);
  return after;
}

function findInstantiationSites() {
  const sites = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const full = join(dir, name);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (name.endsWith('.ts') && !name.endsWith('.d.ts') && !name.includes('.test.')) {
        try {
          const content = readFileSync(full, 'utf8');
          if (content.includes('new DataQualityEngine(')) sites.push(full);
        } catch {}
      }
    }
  }
  walk('src');
  return sites;
}

function findLatestBackup() {
  if (!existsSync('_backups')) return null;
  const dirs = readdirSync('_backups')
    .filter(d => d.startsWith('stage2-'))
    .map(d => join('_backups', d))
    .filter(p => statSync(p).isDirectory())
    .sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}

function rollback(dir) {
  console.log(`\n=== ROLLBACK from ${dir} ===`);
  for (const safe of readdirSync(dir)) {
    const originalPath = safe.split('__').join('/');
    copyFileSync(join(dir, safe), originalPath);
    console.log(`  [RESTORE] ${originalPath}`);
  }
  console.log(`\n✅ Rollback complete. Run "npx tsc --noEmit" to confirm.`);
}

// ============================================================
// MAIN
// ============================================================

if (isRollback) {
  const dir = fromArg || findLatestBackup();
  if (!dir || !existsSync(dir)) {
    console.error('❌ No backup dir. Use --from=_backups/stage2-YYYY...');
    process.exit(1);
  }
  rollback(dir);
  process.exit(0);
}

console.log(`\n=== Stage 2 patches ${isDryRun ? '(DRY RUN)' : ''} ===`);
if (!isDryRun) console.log(`Backup: ${BACKUP_DIR}\n`);

let missed = false;

// Apply patches
for (const patch of PATCHES) {
  console.log(`\n--- ${patch.file} ---`);
  if (!existsSync(patch.file)) { console.log(`  [SKIP] not found`); continue; }
  const { hasCRLF, normalized } = eolRead(patch.file);
  let content = normalized;
  let touched = false;
  for (const change of patch.changes) {
    const next = applyChange(content, change, patch.file);
    if (next === null) { missed = true; continue; }
    content = next; touched = true;
  }
  if (!touched) continue;
  if (isDryRun) {
    console.log(`  [DRY] would write ${patch.file}`);
  } else {
    backupFile(patch.file);
    eolWrite(patch.file, content, hasCRLF);
    console.log(`  [WRITE] ${patch.file}`);
  }
}

// Create new files
for (const [file, content] of Object.entries(NEW_FILES)) {
  console.log(`\n--- ${file} (NEW) ---`);
  if (existsSync(file)) { console.log(`  [SKIP] exists`); continue; }
  if (isDryRun) { console.log(`  [DRY] would create (${content.length} chars)`); continue; }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
  console.log(`  [CREATE]`);
}

// Report instantiation sites (no auto-inject)
const sites = findInstantiationSites();
console.log('\n=== MANUAL INJECTION NEEDED ===');
if (sites.length === 0) {
  console.log('  No DataQualityEngine instantiation found under src/ (non-test).');
  console.log('  Add checks where you construct the engine.');
} else {
  console.log('  Detected instantiation sites (review manually):');
  for (const s of sites) {
    const rel = relative(process.cwd(), s).replace(/\\/g, '/');
    const dir = dirname(rel);
    const checksPath = relative(dir, 'src/data-quality/checks').replace(/\\/g, '/');
    console.log(`\n  📄 ${rel}`);
    console.log(`     Add at top:`);
    console.log(`       import { precisionCheck } from '${checksPath}/precision';`);
    console.log(`       import { volumeSemanticsCheck } from '${checksPath}/volume-semantics';`);
    console.log(`       import { timezoneCheck } from '${checksPath}/timezone';`);
    console.log(`     Then in the array of checks:`);
    console.log(`       [...existingChecks, precisionCheck, volumeSemanticsCheck, timezoneCheck]`);
  }
}

if (missed) {
  console.error('\n⚠️  Some patches missed — check [MISS] above.');
  if (!isDryRun) {
    console.error('   To rollback: node patch-stage2.mjs --rollback');
    process.exit(2);
  }
}

if (isDryRun) {
  console.log('\n=== DRY RUN complete ===');
  process.exit(0);
}

if (noVerify) {
  console.log('\n✅ Patches applied. Skipping verify.');
  process.exit(0);
}

// Verify
console.log('\n=== VERIFICATION ===');

try {
  console.log('\n[1/2] npx tsc --noEmit');
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
  console.log('✅ tsc passed');
} catch {
  console.error('\n❌ tsc failed. Rollback: node patch-stage2.mjs --rollback');
  process.exit(3);
}

try {
  console.log('\n[2/2] npm test');
  execSync('npm test', { stdio: 'inherit' });
  console.log('✅ tests passed');
} catch {
  console.error('\n❌ tests failed. Rollback: node patch-stage2.mjs --rollback');
  process.exit(4);
}

console.log('\n🎉 Stage 2 complete.');
console.log('   Backup: ' + BACKUP_DIR);
console.log('   Rollback: node patch-stage2.mjs --rollback');
console.log('\n   ⚠️  New checks are NOT yet registered in the pipeline.');
console.log('   Follow the MANUAL INJECTION section above to activate them.');
