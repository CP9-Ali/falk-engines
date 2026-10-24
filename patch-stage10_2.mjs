#!/usr/bin/env node
/**
 * Stage 10.2: fix NaN prices + empty chart
 *
 * Root cause: broadcast sends RawDataPoint<Candle> shape
 *   { eventTime, value: { open, high, low, close, volume } }
 * but normalizeCandle read c.open directly (→ NaN)
 *
 * Fixes:
 *   1. normalizeCandle reads c.value?.X or c.X (both shapes)
 *   2. isValidCandle filters NaN/invalid OHLC
 *   3. fmtPrice/fmtVol null-safe
 *   4. loadCandles filters valid only
 *   5. WS candle handler validates
 *   6. updateStats24h null-safe
 *   7. /api/candles/debug endpoint for shape inspection
 *
 * Usage:
 *   node patch-stage10_2.mjs --dry-run
 *   node patch-stage10_2.mjs
 *   node patch-stage10_2.mjs --rollback
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isRollback = args.includes('--rollback');
const fromArg = args.find(a => a.startsWith('--from='))?.slice('--from='.length);

const TS = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const BACKUP_DIR = join('_backups', 'stage10_2-' + TS);

function backupFile(p) {
  const safe = p.split('/').join('__').split('\\').join('__').split(':').join('__');
  const dest = join(BACKUP_DIR, safe);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(p, dest);
}
function findLatest() {
  if (!existsSync('_backups')) return null;
  const dirs = readdirSync('_backups').filter(d => d.startsWith('stage10_2-'))
    .map(d => join('_backups', d)).filter(p => statSync(p).isDirectory()).sort();
  return dirs.length ? dirs[dirs.length - 1] : null;
}

if (isRollback) {
  const dir = fromArg || findLatest();
  if (!dir) { console.error('❌ No backup'); process.exit(1); }
  for (const safe of readdirSync(dir)) {
    const orig = safe.split('__').join('/');
    copyFileSync(join(dir, safe), orig);
    console.log('  [RESTORE] ' + orig);
  }
  process.exit(0);
}

const APP = 'src/dashboard/public/app.js';
const SRV = 'src/dashboard/server.ts';

if (!existsSync(APP)) { console.error('❌ ' + APP + ' not found'); process.exit(1); }
if (!existsSync(SRV)) { console.error('❌ ' + SRV + ' not found'); process.exit(1); }

let app = readFileSync(APP, 'utf8').replace(/\r\n/g, '\n');
let srv = readFileSync(SRV, 'utf8').replace(/\r\n/g, '\n');

function mustReplace(haystack, from, to, label) {
  if (!haystack.includes(from)) {
    console.error('❌ Pattern not found: ' + label);
    process.exit(2);
  }
  console.log('  [OK] ' + label);
  return haystack.split(from).join(to);
}

// Fix 1: fmtPrice
app = mustReplace(app,
  "const fmtPrice = (v) => v == null ? '—' : Number(v).toFixed(2);",
  "const fmtPrice = (v) => { if (v == null) return '—'; const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : '—'; };",
  'fmtPrice');

// Fix 2: fmtVol
app = mustReplace(app,
  "const fmtVol = (v) => v == null ? '—' : Number(v).toLocaleString();",
  "const fmtVol = (v) => { if (v == null) return '—'; const n = Number(v); return Number.isFinite(n) ? n.toLocaleString() : '—'; };",
  'fmtVol');

// Fix 3: normalizeCandle + isValidCandle
const OLD_NC = `  function normalizeCandle(c) {
    return {
      time: toUnix(c.eventTime),
      open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
      volume: Number(c.volume) || 0,
    };
  }`;
const NEW_NC = `  function normalizeCandle(c) {
    if (!c) return null;
    const v = c.value || c;
    const rawTime = c.eventTime ?? c.event_time_utc ?? c.time;
    let t = NaN;
    if (typeof rawTime === 'number') t = rawTime;
    else if (typeof rawTime === 'string') t = toUnix(rawTime);
    const vol = v.volume ?? c.volume_value ?? 0;
    return {
      time: t,
      open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close),
      volume: Number(vol) || 0,
    };
  }

  function isValidCandle(c) {
    return !!c
      && Number.isFinite(c.time) && c.time > 0
      && Number.isFinite(c.open) && c.open > 0
      && Number.isFinite(c.high) && c.high > 0
      && Number.isFinite(c.low) && c.low > 0
      && Number.isFinite(c.close) && c.close > 0
      && c.high >= c.low;
  }`;
app = mustReplace(app, OLD_NC, NEW_NC, 'normalizeCandle + isValidCandle');

// Fix 4: loadCandles filter
app = mustReplace(app,
  "state.candles = (j.candles || []).map(normalizeCandle).sort((a, b) => a.time - b.time);",
  "state.candles = (j.candles || []).map(normalizeCandle).filter(isValidCandle).sort((a, b) => a.time - b.time);",
  'loadCandles filter');

// Fix 5: WS candle handler
const OLD_WS = `      } else if (ev.type === 'candle') {
        candleCounter++;
        const tf = ev.timeframe || '1m';
        if (tf === state.timeframe && ev.data?.eventTime) {
          const c = normalizeCandle(ev.data);
          const idx = state.candles.findIndex(x => x.time === c.time);
          if (idx >= 0) state.candles[idx] = c;
          else state.candles.push(c);
          state.candles.sort((a, b) => a.time - b.time);
          applyChartData();
        }
        addEvent('candle', tf + ' close=' + (ev.data?.close ?? '—'));
      }`;
const NEW_WS = `      } else if (ev.type === 'candle') {
        candleCounter++;
        const tf = ev.timeframe || '1m';
        const c = normalizeCandle(ev.data);
        if (tf === state.timeframe && c && isValidCandle(c)) {
          const idx = state.candles.findIndex(x => x.time === c.time);
          if (idx >= 0) state.candles[idx] = c;
          else state.candles.push(c);
          state.candles.sort((a, b) => a.time - b.time);
          applyChartData();
        }
        addEvent('candle', tf + ' close=' + (c?.close ?? '—'));
      }`;
app = mustReplace(app, OLD_WS, NEW_WS, 'ws-candle-handler');

// Fix 6: applyChartData tail
app = mustReplace(app,
  "    $('chart-count').textContent = cs.length + ' bars';\n    updateStats24h();",
  "    $('chart-count').textContent = cs.length === 0 ? 'no data yet' : cs.length + ' bars';\n    updateStats24h(cs);",
  'applyChartData tail');

// Fix 7: updateStats24h
const OLD_US = `  function updateStats24h() {
    const cs = state.candles;
    if (cs.length === 0) return;
    const last = cs[cs.length - 1];
    const cutoff = last.time - 86400;
    let firstIn24h = cs[0];
    for (const c of cs) { if (c.time >= cutoff) { firstIn24h = c; break; } }
    const high = Math.max(...cs.filter(c => c.time >= cutoff).map(c => c.high));
    const low = Math.min(...cs.filter(c => c.time >= cutoff).map(c => c.low));
    const vol = cs.filter(c => c.time >= cutoff).reduce((a, c) => a + c.volume, 0);
    const change = last.close - firstIn24h.open;
    const changePct = firstIn24h.open !== 0 ? (change / firstIn24h.open) * 100 : 0;

    $('price').textContent = fmtPrice(last.close);
    $('price-change').textContent = (change >= 0 ? '+' : '') + fmtPrice(change) + ' (' + (change >= 0 ? '+' : '') + changePct.toFixed(2) + '%)';
    $('price-change').style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
    $('high24').textContent = fmtPrice(high);
    $('low24').textContent = fmtPrice(low);
    $('vol24').textContent = fmtVol(vol);
    $('count').textContent = cs.length;
  }`;
const NEW_US = `  function updateStats24h(cs) {
    cs = cs || state.candles;
    if (!cs || cs.length === 0) {
      $('price').textContent = '—';
      $('price-change').textContent = '—';
      $('price-change').style.color = '';
      $('high24').textContent = '—';
      $('low24').textContent = '—';
      $('vol24').textContent = '—';
      $('count').textContent = '0';
      return;
    }
    const last = cs[cs.length - 1];
    const cutoff = last.time - 86400;
    const recent = cs.filter(c => c.time >= cutoff);
    if (recent.length === 0) return;
    const firstIn24h = recent[0];
    const high = Math.max(...recent.map(c => c.high));
    const low = Math.min(...recent.map(c => c.low));
    const vol = recent.reduce((a, c) => a + c.volume, 0);
    const change = last.close - firstIn24h.open;
    const changePct = firstIn24h.open !== 0 ? (change / firstIn24h.open) * 100 : 0;

    $('price').textContent = fmtPrice(last.close);
    $('price-change').textContent = (change >= 0 ? '+' : '') + fmtPrice(change) + ' (' + (change >= 0 ? '+' : '') + changePct.toFixed(2) + '%)';
    $('price-change').style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
    $('high24').textContent = fmtPrice(high);
    $('low24').textContent = fmtPrice(low);
    $('vol24').textContent = fmtVol(vol);
    $('count').textContent = cs.length;
  }`;
app = mustReplace(app, OLD_US, NEW_US, 'updateStats24h');

// Fix 8: state.debug flag
app = mustReplace(app,
  "    indicators: { sma: true, ema: true, bb: false, vol: true },\n  };",
  "    indicators: { sma: true, ema: true, bb: false, vol: true },\n    debug: new URLSearchParams(location.search).has('debug'),\n  };",
  'state.debug flag');

// Fix 9: debug log in loadCandles
app = mustReplace(app,
  "      const j = await r.json();\n      state.candles",
  "      const j = await r.json();\n      if (state.debug) console.log('[falk] loaded', (j.candles || []).length, 'raw candles, sample:', (j.candles || [])[0]);\n      state.candles",
  'loadCandles debug log');

// Fix 10: server /api/candles/debug
if (!srv.includes("'/api/candles/debug'")) {
  const debugEndpoint = `
    // Stage 10.2: /api/candles/debug — inspect raw candle shape
    this.app.get('/api/candles/debug', (_, res) => {
      const out: any[] = [];
      for (const ev of this.candleHistory.values()) {
        if (out.length >= 3) break;
        const d: any = ev.data;
        out.push({
          type: ev.type,
          timeframe: (ev as any).timeframe,
          dataType: typeof d,
          dataKeys: d && typeof d === 'object' ? Object.keys(d) : null,
          hasValue: !!(d && d.value),
          hasEventTime: !!(d && (d.eventTime || d.event_time_utc)),
          hasOpen: !!(d && (d.open != null || (d.value && d.value.open != null))),
          sample: d,
        });
      }
      res.json({ total: this.candleHistory.size, samples: out });
    });
`;
  const anchor = "    this.wss.on('connection', (ws) => {";
  if (!srv.includes(anchor)) {
    console.error('❌ server.ts wss anchor not found');
    process.exit(3);
  }
  srv = srv.replace(anchor, debugEndpoint + '\n' + anchor);
  console.log('  [OK] /api/candles/debug added');
} else {
  console.log('  [SKIP] /api/candles/debug already present');
}

// Write
if (isDryRun) {
  console.log('\n=== DRY RUN — no files written ===');
  process.exit(0);
}

backupFile(APP);
backupFile(SRV);
writeFileSync(APP, app, 'utf8');
writeFileSync(SRV, srv, 'utf8');
console.log('\n  [WRITE] ' + APP);
console.log('  [WRITE] ' + SRV);

console.log('\n=== VERIFICATION ===');
try {
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
  console.log('✅ tsc passed');
} catch {
  console.error('❌ tsc failed. Rollback: node patch-stage10_2.mjs --rollback');
  process.exit(4);
}

try {
  execSync('npm test', { stdio: 'inherit' });
  console.log('✅ tests passed');
} catch {
  console.error('❌ tests failed. Rollback: node patch-stage10_2.mjs --rollback');
  process.exit(5);
}

console.log('\n🎉 Stage 10.2 complete.');
console.log('   Backup: ' + BACKUP_DIR);
console.log('   Test: restart npm start → http://localhost:3000?debug=1');
console.log('   Debug: http://localhost:3000/api/candles/debug');
