#!/usr/bin/env node
/**
 * Stage 10.1: extend timeframe selector to all 7 canonical timeframes
 * (1m, 5m, 15m, 1h, 4h, 1d, 1w)
 *
 * - index.html: adds 15m / 4h / 1w buttons
 * - app.js: unchanged (reads data-tf dynamically)
 * - server.ts: unchanged (filters by timeframe string)
 *
 * Usage:
 *   node patch-stage10_1.mjs --dry-run
 *   node patch-stage10_1.mjs
 *   node patch-stage10_1.mjs --rollback
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const args = process.argv.slice(2);
const isDryRun   = args.includes('--dry-run');
const isRollback = args.includes('--rollback');
const noVerify   = args.includes('--no-verify');
const fromArg    = args.find(a => a.startsWith('--from='))?.slice('--from='.length);

const TIMESTAMP  = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = join('_backups', 'stage10_1-' + TIMESTAMP);

function readLF(p) { return readFileSync(p, 'utf8').split('\r\n').join('\n'); }
function writeLF(p, c) { writeFileSync(p, c, 'utf8'); }
function backupFile(p) {
  const safe = p.split('/').join('__').split('\\').join('__').split(':').join('__');
  const dest = join(BACKUP_DIR, safe);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(p, dest);
}
function findLatestBackup() {
  if (!existsSync('_backups')) return null;
  const dirs = readdirSync('_backups').filter(d => d.startsWith('stage10_1-'))
    .map(d => join('_backups', d)).filter(p => statSync(p).isDirectory()).sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}
function rollback(dir) {
  console.log('\n=== ROLLBACK from ' + dir + ' ===');
  for (const safe of readdirSync(dir)) {
    const originalPath = safe.split('__').join('/');
    copyFileSync(join(dir, safe), originalPath);
    console.log('  [RESTORE] ' + originalPath);
  }
  console.log('\n✅ Rollback complete.');
}

if (isRollback) {
  const dir = fromArg || findLatestBackup();
  if (!dir || !existsSync(dir)) { console.error('❌ No backup dir.'); process.exit(1); }
  rollback(dir); process.exit(0);
}

console.log('\n=== Stage 10.1 ' + (isDryRun ? '(DRY RUN)' : '') + ' ===');
if (!isDryRun) console.log('Backup: ' + BACKUP_DIR + '\n');

const FILE = 'src/dashboard/public/index.html';
if (!existsSync(FILE)) {
  console.error('❌ ' + FILE + ' not found');
  process.exit(1);
}

let s = readLF(FILE);

const OLD = `        <button data-tf="1m" class="active">1m</button>
        <button data-tf="5m">5m</button>
        <button data-tf="1h">1h</button>
        <button data-tf="1d">1d</button>`;

const NEW = `        <button data-tf="1m" class="active">1m</button>
        <button data-tf="5m">5m</button>
        <button data-tf="15m">15m</button>
        <button data-tf="1h">1h</button>
        <button data-tf="4h">4h</button>
        <button data-tf="1d">1d</button>
        <button data-tf="1w">1w</button>`;

console.log('\n--- ' + FILE + ' ---');

if (s.includes('data-tf="15m"')) {
  console.log('  [SKIP] 15m button already present');
} else if (!s.includes(OLD)) {
  console.error('  [MISS] timeframe button block not found');
  console.error('  Expected block:');
  console.error(OLD.split('\n').map(l => '    ' + l).join('\n'));
  console.error('\n  Current <div class="tfg"> content:');
  const m = s.match(/<div class="tfg"[^>]*>([\s\S]*?)<\/div>/);
  if (m) console.error(m[1].split('\n').map(l => '    ' + l).join('\n'));
  process.exit(2);
} else {
  s = s.split(OLD).join(NEW);
  console.log('  [OK] timeframe buttons updated (7 total)');
  if (isDryRun) {
    console.log('  [DRY] would write ' + FILE);
  } else {
    backupFile(FILE);
    writeLF(FILE, s);
    console.log('  [WRITE] ' + FILE);
  }
}

// Sanity: app.js should have no hardcoded tf list
const APPJS = 'src/dashboard/public/app.js';
if (existsSync(APPJS)) {
  const a = readFileSync(APPJS, 'utf8');
  const hardcoded = /\[['"]1m['"],\s*['"]5m['"]/.test(a);
  console.log('\n--- ' + APPJS + ' ---');
  if (hardcoded) {
    console.log('  [WARN] app.js appears to have a hardcoded timeframe array — inspect manually');
  } else {
    console.log('  [OK] no hardcoded timeframe array (uses data-tf attributes)');
  }
}

if (isDryRun) {
  console.log('\n=== DRY RUN complete ===');
  process.exit(0);
}

if (noVerify) {
  console.log('\n✅ Patched (no-verify).');
  process.exit(0);
}

console.log('\n=== VERIFICATION ===');
try {
  console.log('\n[1/2] npx tsc --noEmit');
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
  console.log('✅ tsc passed');
} catch {
  console.error('\n❌ tsc failed. Rollback: node patch-stage10_1.mjs --rollback');
  process.exit(3);
}

try {
  console.log('\n[2/2] npm test');
  execSync('npm test', { stdio: 'inherit' });
  console.log('✅ tests passed');
} catch {
  console.error('\n❌ tests failed. Rollback: node patch-stage10_1.mjs --rollback');
  process.exit(4);
}

console.log('\n🎉 Stage 10.1 complete.');
console.log('   Backup: ' + BACKUP_DIR);
console.log('   Run: npm start → http://localhost:3000');
