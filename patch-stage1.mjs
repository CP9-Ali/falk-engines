#!/usr/bin/env node
/**
 * Stage 1 normalization patches for falk-engines
 *
 * Usage:
 *   node patch-stage1.mjs --dry-run        # preview, no writes
 *   node patch-stage1.mjs                  # apply + verify
 *   node patch-stage1.mjs --no-verify      # apply without tsc/test
 *   node patch-stage1.mjs --rollback       # restore from latest backup
 *   node patch-stage1.mjs --rollback --from=_backups/stage1-2026-...
 */

import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
  copyFileSync, readdirSync, statSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const args = process.argv.slice(2);
const isDryRun  = args.includes('--dry-run');
const isRollback = args.includes('--rollback');
const noVerify  = args.includes('--no-verify');
const fromArg   = args.find(a => a.startsWith('--from='))?.slice('--from='.length);

const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = join('_backups', `stage1-${TIMESTAMP}`);

// ============================================================
// PATCH DEFINITIONS
// ============================================================

const PATCHES = [
  {
    file: 'src/normalization/canonical.ts',
    changes: [
      {
        name: 'volume_value type → number | null',
        find: /readonly volume_value: number;/,
        replace: 'readonly volume_value: number | null;',
      },
      {
        name: 'add source_timezone_status + time_blocked to type',
        find: /(\n[ \t]+)readonly source_timezone: string;(\n[ \t]+)readonly arrival_time_utc: string;/,
        replace: (m, i1, i2) =>
          i1 + 'readonly source_timezone: string;' +
          i1 + '/** Stage 1: RESOLVED if timezone known, UNKNOWN otherwise */' +
          i1 + "readonly source_timezone_status: 'RESOLVED' | 'UNKNOWN';" +
          i1 + '/** Stage 1: true when source_timezone is UNKNOWN (blocks time-sensitive comparisons) */' +
          i1 + 'readonly time_blocked: boolean;' +
          i2 + 'readonly arrival_time_utc: string;',
      },
      {
        name: 'derive tzLookup + source_timezone_status + time_blocked',
        find: /const source_timezone = SOURCE_TIMEZONE\[raw\.sourceId\] \?\? 'UNKNOWN';/,
        replace:
          'const tzLookup = SOURCE_TIMEZONE[raw.sourceId];\n' +
          "  const source_timezone = tzLookup ?? 'UNKNOWN';\n" +
          "  const source_timezone_status: 'RESOLVED' | 'UNKNOWN' = tzLookup ? 'RESOLVED' : 'UNKNOWN';\n" +
          "  const time_blocked = source_timezone_status === 'UNKNOWN';",
      },
      {
        name: 'volume_value → null when UNKNOWN',
        find: /const volume_value = volume_semantics === 'UNKNOWN' \? 0 : rawVolume;/,
        replace: "const volume_value = volume_semantics === 'UNKNOWN' ? null : rawVolume;",
      },
      {
        name: 'add new fields to returned object',
        find: /(\n[ \t]+)source_timezone,(\n[ \t]+)arrival_time_utc:/,
        replace: (m, i1, i2) =>
          i1 + 'source_timezone,' +
          i1 + 'source_timezone_status,' +
          i1 + 'time_blocked,' +
          i2 + 'arrival_time_utc:',
      },
      {
        name: 'assessUsability: null-safe volume check',
        find: /const volOk = c\.volume_semantics !== 'UNKNOWN' && c\.volume_value > 0;/,
        replace:
          "const volOk = c.volume_semantics !== 'UNKNOWN' && c.volume_value !== null && c.volume_value > 0;",
      },
      {
        name: 'assessUsability: introduce timeOk',
        find: /(\n[ \t]+)return \{(\n[ \t]+)suitable_for: \{/,
        replace: (m, i1, i2) =>
          i1 + 'const timeOk = c.time_blocked !== true;' +
          i1 + "if (!timeOk) reasons.push('timezone UNKNOWN - time-sensitive comparisons blocked');" +
          i1 +
          i1 + 'return {' +
          i2 + 'suitable_for: {',
      },
      {
        name: 'assessUsability: gate source_comparison by timeOk',
        find: /source_comparison: ohlcValid,/,
        replace: 'source_comparison: ohlcValid && timeOk,',
      },
      {
        name: 'assessUsability: gate news_analysis by timeOk',
        find: /news_analysis: opts\?\.newsAvailable === true/,
        replace: 'news_analysis: timeOk && opts?.newsAvailable === true',
      },
    ],
  },
  {
    file: 'src/tests/replay-evidence.test.ts',
    changes: [
      {
        name: 'add stage1 fields to CanonicalCandle test literal',
        find: /(\n[ \t]+)source_timezone: '([^']*)',/,
        replace: (m, indent, tz) => {
          const isUnknown = tz === 'UNKNOWN';
          const status  = isUnknown ? "'UNKNOWN'"  : "'RESOLVED'";
          const blocked = isUnknown ? 'true'       : 'false';
          return (
            indent + "source_timezone: '" + tz + "'," +
            indent + 'source_timezone_status: ' + status + ' as const,' +
            indent + 'time_blocked: ' + blocked + ','
          );
        },
        optional: true, // warn but don't fail if pattern absent
      },
    ],
  },
];

const NEW_FILES = {
  'src/tests/stage1-normalization.test.ts': `import { describe, it, expect } from 'vitest';
import { toCanonical } from '../normalization/canonical';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

function makeRaw(sourceId: string, closedAt?: string): RawDataPoint<Candle> {
  return {
    sourceId,
    value: { open: 100, high: 101, low: 99, close: 100.5, volume: 50 },
    eventTime: '2026-10-24T12:00:00.000Z',
    closedAt,
    arrivalTime: '2026-10-24T12:00:01.000Z',
    availabilityTime: '2026-10-24T12:00:01.000Z',
    version: 1,
    fingerprint: 'fp-stage1',
  };
}

const lineage = { lineage_id: 'L-stage1', raw_path: '/raw/stage1.json' };

describe('Stage 1 normalization', () => {
  it('known source -> source_timezone_status RESOLVED, time_blocked false', () => {
    const c = toCanonical(makeRaw('binance-paxg'), '1m', lineage);
    expect(c.source_timezone_status).toBe('RESOLVED');
    expect(c.time_blocked).toBe(false);
  });

  it('unknown source -> source_timezone_status UNKNOWN, time_blocked true', () => {
    const c = toCanonical(makeRaw('totally-unknown-source'), '1m', lineage);
    expect(c.source_timezone).toBe('UNKNOWN');
    expect(c.source_timezone_status).toBe('UNKNOWN');
    expect(c.time_blocked).toBe(true);
  });

  it('volume_value is null when volume_semantics UNKNOWN', () => {
    const c = toCanonical(makeRaw('twelvedata-ws'), '1m', lineage);
    expect(c.volume_semantics).toBe('UNKNOWN');
    expect(c.volume_value).toBeNull();
  });

  it('volume_value preserves number when semantics known', () => {
    const c = toCanonical(makeRaw('binance-paxg'), '1m', lineage);
    expect(c.volume_semantics).toBe('TICK');
    expect(c.volume_value).toBe(50);
  });

  it('is_final true when closedAt set', () => {
    const c = toCanonical(
      makeRaw('binance-paxg', '2026-10-24T12:01:00.000Z'),
      '1m', lineage,
    );
    expect(c.is_final).toBe(true);
  });

  it('is_final false when closedAt undefined', () => {
    const c = toCanonical(makeRaw('binance-paxg'), '1m', lineage);
    expect(c.is_final).toBe(false);
  });
});
`,
};

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
  const before = content;
  if (!change.find.test(content)) {
    if (change.optional) {
      console.log(`  [SKIP] ${file}: ${change.name} (pattern not found — OK)`);
      return content;
    }
    console.log(`  [MISS] ${file}: ${change.name} (pattern not found)`);
    return null;
  }
  const after = typeof change.replace === 'function'
    ? content.replace(change.find, change.replace)
    : content.replace(change.find, change.replace);
  if (after === before) {
    console.log(`  [SAME] ${file}: ${change.name} (no diff produced)`);
    return null;
  }
  console.log(`  [ OK ] ${file}: ${change.name}`);
  return after;
}

function findLatestBackup() {
  if (!existsSync('_backups')) return null;
  const dirs = readdirSync('_backups')
    .filter(d => d.startsWith('stage1-'))
    .map(d => join('_backups', d))
    .filter(p => statSync(p).isDirectory())
    .sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}

function rollback(dir) {
  console.log(`\n=== ROLLBACK from ${dir} ===`);
  const items = readdirSync(dir);
  for (const safe of items) {
    const original = safe.replace(/__/g, (m) => m); // placeholder; reverse below
    const parts = safe.split('__');
    // reconstruct: "src__normalization__canonical.ts" -> "src/normalization/canonical.ts"
    // But also Windows drive separators might be "__"
    const originalPath = parts.join('/');
    const src = join(dir, safe);
    if (!existsSync(dirname(originalPath))) {
      mkdirSync(dirname(originalPath), { recursive: true });
    }
    copyFileSync(src, originalPath);
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
    console.error('❌ No backup directory found. Use --from=_backups/stage1-YYYY...');
    process.exit(1);
  }
  rollback(dir);
  process.exit(0);
}

console.log(`\n=== Stage 1 patches ${isDryRun ? '(DRY RUN)' : ''} ===`);
if (!isDryRun) console.log(`Backup dir: ${BACKUP_DIR}\n`);

let anyError = false;

// Apply patches to existing files
for (const patch of PATCHES) {
  console.log(`\n--- ${patch.file} ---`);
  if (!existsSync(patch.file)) {
    console.log(`  [SKIP] file not found`);
    continue;
  }
  const { hasCRLF, normalized } = eolRead(patch.file);
  let content = normalized;
  let touched = false;
  for (const change of patch.changes) {
    const next = applyChange(content, change, patch.file);
    if (next === null) {
      if (!change.optional) anyError = true;
      continue;
    }
    content = next;
    touched = true;
  }
  if (!touched) {
    console.log(`  (no changes applied to ${patch.file})`);
    continue;
  }
  if (isDryRun) {
    console.log(`  [DRY] would write ${patch.file} (${normalized.length} -> ${content.length} chars)`);
  } else {
    backupFile(patch.file);
    eolWrite(patch.file, content, hasCRLF);
    console.log(`  [WRITE] ${patch.file}`);
  }
}

// Create new files
for (const [file, content] of Object.entries(NEW_FILES)) {
  console.log(`\n--- ${file} (NEW) ---`);
  if (existsSync(file)) {
    console.log(`  [SKIP] already exists`);
    continue;
  }
  if (isDryRun) {
    console.log(`  [DRY] would create ${file} (${content.length} chars)`);
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
    console.log(`  [CREATE] ${file}`);
  }
}

if (anyError) {
  console.error('\n⚠️  Some required patches did not match. Aborting verification.');
  console.error('   Inspect the [MISS] lines above. Files were still written.');
  console.error('   To rollback: node patch-stage1.mjs --rollback');
  process.exit(2);
}

if (isDryRun) {
  console.log('\n=== DRY RUN complete — no files written ===');
  process.exit(0);
}

if (noVerify) {
  console.log('\n✅ Patches applied. Skipping verification (--no-verify).');
  process.exit(0);
}

// Verify
console.log('\n=== VERIFICATION ===');

try {
  console.log('\n[1/2] npx tsc --noEmit');
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
  console.log('✅ tsc passed');
} catch (e) {
  console.error('\n❌ tsc failed.');
  console.error('   Run: node patch-stage1.mjs --rollback');
  process.exit(3);
}

try {
  console.log('\n[2/2] npm test');
  execSync('npm test', { stdio: 'inherit' });
  console.log('✅ tests passed');
} catch (e) {
  console.error('\n❌ tests failed.');
  console.error('   Run: node patch-stage1.mjs --rollback');
  process.exit(4);
}

console.log('\n🎉 Stage 1 complete. Backup preserved at:');
console.log(`   ${BACKUP_DIR}`);
console.log('   Rollback: node patch-stage1.mjs --rollback');
