#!/usr/bin/env node
/**
 * Stage 10: Professional dashboard with real charts + all indicators
 *
 * Backend:
 *   - GET /api/candles?timeframe=X&limit=N
 *   - GET /api/stats
 *
 * Frontend:
 *   - lightweight-charts v4 (TradingView) via CDN
 *   - Candlestick + SMA20 + EMA50 + Bollinger + Volume (main chart)
 *   - RSI14 (separate pane)
 *   - MACD (12,26,9) + Histogram (separate pane)
 *   - Real-time WS updates
 *   - Timeframe selector
 *   - Indicator toggles
 *   - Session bar, stats cards, weekly session chart, events feed
 *
 * Requires: internet for CDN (lightweight-charts).
 *
 * Usage:
 *   node patch-stage10.mjs --dry-run
 *   node patch-stage10.mjs
 *   node patch-stage10.mjs --rollback
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
const BACKUP_DIR = join('_backups', 'stage10-' + TIMESTAMP);

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
  const dirs = readdirSync('_backups').filter(d => d.startsWith('stage10-'))
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

console.log('\n=== Stage 10 ' + (isDryRun ? '(DRY RUN)' : '') + ' ===');
if (!isDryRun) console.log('Backup: ' + BACKUP_DIR + '\n');

let missed = false;

// ============================================================
// INDEX.HTML
// ============================================================
const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FALK · XAUUSD Trading Dashboard</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"></script>
</head>
<body>
  <header>
    <div>
      <h1>FALK · XAUUSD Dashboard</h1>
      <div class="subtitle">real-time · session-aware · DST-correct</div>
    </div>
    <div class="status">
      <span class="dot" id="conn-dot"></span>
      <span id="conn-status">connecting…</span>
    </div>
  </header>

  <section class="session-bar">
    <div class="cell"><span class="label">Session</span><span class="v" id="sess-name">—</span></div>
    <div class="cell"><span class="label">Market</span><span class="v" id="sess-market">—</span></div>
    <div class="cell"><span class="label">Next</span><span class="v" id="sess-next">—</span><span class="s" id="sess-next-sub"></span></div>
    <div class="cell"><span class="label">Week Open</span><span class="v mono" id="sess-open">—</span></div>
    <div class="cell"><span class="label">Week Close</span><span class="v mono" id="sess-close">—</span></div>
  </section>

  <section class="stats">
    <div class="stat"><span class="label">Price</span><span class="v" id="price">—</span><span class="s" id="price-change">—</span></div>
    <div class="stat"><span class="label">24h High</span><span class="v mono" id="high24">—</span></div>
    <div class="stat"><span class="label">24h Low</span><span class="v mono" id="low24">—</span></div>
    <div class="stat"><span class="label">24h Volume</span><span class="v mono" id="vol24">—</span></div>
    <div class="stat"><span class="label">Quality</span><span class="v" id="quality">—</span></div>
    <div class="stat"><span class="label">Fusion</span><span class="v" id="fusion">—</span></div>
    <div class="stat"><span class="label">Candles</span><span class="v" id="count">0</span></div>
    <div class="stat"><span class="label">Sources</span><span class="v" id="sources">0</span></div>
  </section>

  <section class="chart-wrap">
    <div class="toolbar">
      <span class="tlabel">TF</span>
      <div class="tfg" id="tfg">
        <button data-tf="1m" class="active">1m</button>
        <button data-tf="5m">5m</button>
        <button data-tf="1h">1h</button>
        <button data-tf="1d">1d</button>
      </div>
      <span class="tlabel">Indicators</span>
      <label class="tg"><input type="checkbox" id="ind-sma" checked> <span>SMA20</span></label>
      <label class="tg"><input type="checkbox" id="ind-ema" checked> <span>EMA50</span></label>
      <label class="tg"><input type="checkbox" id="ind-bb"> <span>BB</span></label>
      <label class="tg"><input type="checkbox" id="ind-vol" checked> <span>Vol</span></label>
      <span class="spacer"></span>
      <button id="btn-fit">Fit</button>
      <span class="count" id="chart-count">0 bars</span>
    </div>
    <div id="main-chart" class="chart-main"></div>
    <div id="rsi-chart" class="chart-sub"></div>
    <div id="macd-chart" class="chart-sub"></div>
  </section>

  <section class="two-col">
    <div class="panel">
      <h2>Weekly Session History</h2>
      <div id="week-hist" class="week-hist"></div>
    </div>
    <div class="panel">
      <h2>Recent Events</h2>
      <ul id="events"><li class="empty">waiting for events…</li></ul>
    </div>
  </section>

  <script src="/app.js"></script>
</body>
</html>
`;

// ============================================================
// STYLES.CSS
// ============================================================
const STYLES_CSS = `:root {
  --bg: #0a0e17;
  --panel: #111827;
  --panel2: #0f172a;
  --border: #1f2937;
  --text: #e5e7eb;
  --muted: #6b7280;
  --accent: #f59e0b;
  --green: #10b981;
  --red: #ef4444;
  --blue: #3b82f6;
  --purple: #8b5cf6;
  --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; }
body { padding: 16px; min-height: 100vh; }

header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
h1 { font-size: 17px; font-weight: 600; letter-spacing: -0.02em; }
.subtitle { font-size: 11px; color: var(--muted); margin-top: 3px; }
h2 { font-size: 11px; font-weight: 600; margin-bottom: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
.status { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); transition: all 0.2s; }
.dot.online { background: var(--green); box-shadow: 0 0 8px var(--green); }
.dot.offline { background: var(--red); }

.session-bar { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 14px; }
.session-bar .cell { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 3px; }
.session-bar .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
.session-bar .v { font-size: 14px; font-weight: 600; }
.session-bar .v.mono { font-family: var(--mono); font-size: 11px; }
.session-bar .s { font-size: 10px; color: var(--muted); }

.stats { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; margin-bottom: 14px; }
.stat { background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
.stat .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
.stat .v { font-size: 14px; font-weight: 600; }
.stat .v.mono { font-family: var(--mono); font-size: 12px; }
.stat .s { font-size: 10px; color: var(--muted); }

.chart-wrap { background: var(--panel2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 14px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; font-size: 11px; }
.toolbar .tlabel { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; font-size: 10px; }
.tfg { display: flex; gap: 2px; }
.tfg button { background: transparent; color: var(--muted); border: 1px solid var(--border); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; font-family: inherit; }
.tfg button.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
.tfg button:hover:not(.active) { border-color: #374151; }
.tg { display: flex; align-items: center; gap: 4px; color: var(--text); cursor: pointer; }
.tg input { accent-color: var(--accent); }
.spacer { flex: 1; }
#btn-fit { background: transparent; color: var(--muted); border: 1px solid var(--border); padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; font-family: inherit; }
#btn-fit:hover { border-color: #374151; color: var(--text); }
.count { color: var(--muted); font-family: var(--mono); font-size: 10px; }

.chart-main { height: 380px; }
.chart-sub { height: 110px; margin-top: 6px; }

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 12px; min-height: 180px; }

.week-hist { display: flex; flex-direction: column; gap: 6px; }
.week-row { display: flex; align-items: center; gap: 10px; font-size: 11px; }
.week-row .day { font-family: var(--mono); color: var(--muted); min-width: 80px; }
.week-row .bar { flex: 1; height: 14px; background: var(--border); border-radius: 3px; overflow: hidden; }
.week-row .fill { height: 100%; background: var(--green); opacity: 0.7; transition: opacity 0.2s; }
.week-row.closed .fill { background: var(--muted); opacity: 0.3; }
.week-row .sess { font-family: var(--mono); color: var(--muted); font-size: 10px; min-width: 100px; text-align: right; }

#events { list-style: none; background: var(--panel2); border: 1px solid var(--border); border-radius: 6px; max-height: 200px; overflow-y: auto; }
#events li { padding: 6px 12px; border-bottom: 1px solid var(--border); font-size: 11px; font-family: var(--mono); display: flex; gap: 10px; align-items: center; }
#events li:last-child { border-bottom: none; }
#events li.empty { color: var(--muted); font-style: italic; justify-content: center; padding: 16px; }
#events .time { color: var(--muted); min-width: 60px; }
#events .type { color: var(--accent); min-width: 60px; font-weight: 600; }
#events .type-error { color: var(--red); }
#events .type-tick { color: var(--green); }

@media (max-width: 1200px) {
  .stats { grid-template-columns: repeat(4, 1fr); }
  .session-bar { grid-template-columns: repeat(3, 1fr); }
  .two-col { grid-template-columns: 1fr; }
}
@media (max-width: 700px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
  .session-bar { grid-template-columns: 1fr 1fr; }
}
`;

// ============================================================
// APP.JS (with lightweight-charts + indicators)
// ============================================================
const APP_JS = `(() => {
  'use strict';

  // =========================
  // Utilities
  // =========================
  const $ = (id) => document.getElementById(id);
  const fmtPrice = (v) => v == null ? '—' : Number(v).toFixed(2);
  const fmtVol = (v) => v == null ? '—' : Number(v).toLocaleString();
  const fmtUtc = (iso) => iso ? iso.replace('T', ' ').replace(/\\.\\d+Z$/, 'Z') : '—';
  const fmtSec = (s) => {
    if (s == null || s < 0) return '';
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    const p = [];
    if (d) p.push(d + 'd');
    if (h) p.push(h + 'h');
    if (m || p.length === 0) p.push(m + 'm');
    return p.join(' ');
  };
  const toUnix = (iso) => Math.floor(new Date(iso).getTime() / 1000);

  // =========================
  // Chart setup
  // =========================
  if (typeof LightweightCharts === 'undefined') {
    document.body.innerHTML = '<div style="padding:40px;color:#ef4444">lightweight-charts CDN failed to load. Check internet connection.</div>';
    return;
  }
  const LC = LightweightCharts;

  const commonOpts = {
    layout: { background: { color: '#0f172a' }, textColor: '#9ca3af', fontSize: 10 },
    grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#1f2937', rightOffset: 5 },
    rightPriceScale: { borderColor: '#1f2937', scaleMargins: { top: 0.1, bottom: 0.1 } },
    crosshair: { mode: 1, vertLine: { color: '#4b5563', width: 1, style: 2 }, horzLine: { color: '#4b5563', width: 1, style: 2 } },
  };

  const mainChart = LC.createChart($('main-chart'), { ...commonOpts, height: 380 });
  const candleSeries = mainChart.addCandlestickSeries({
    upColor: '#10b981', downColor: '#ef4444', borderUpColor: '#10b981', borderDownColor: '#ef4444',
    wickUpColor: '#10b981', wickDownColor: '#ef4444',
  });
  const volumeSeries = mainChart.addHistogramSeries({
    priceFormat: { type: 'volume' }, priceScaleId: 'vol', color: '#374151',
  });
  mainChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  const sma20Series = mainChart.addLineSeries({ color: '#f59e0b', lineWidth: 2, title: 'SMA20' });
  const ema50Series = mainChart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'EMA50' });
  const bbUpper = mainChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  const bbLower = mainChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  const bbMiddle = mainChart.addLineSeries({ color: '#9ca3af', lineWidth: 1, lineStyle: 2 });

  const rsiChart = LC.createChart($('rsi-chart'), { ...commonOpts, height: 110 });
  const rsiSeries = rsiChart.addLineSeries({ color: '#8b5cf6', lineWidth: 2, title: 'RSI14' });
  const rsiUpper = rsiChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  const rsiLower = rsiChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  rsiSeries.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });

  const macdChart = LC.createChart($('macd-chart'), { ...commonOpts, height: 110 });
  const macdSeries = macdChart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'MACD' });
  const macdSignal = macdChart.addLineSeries({ color: '#f59e0b', lineWidth: 2, title: 'Signal' });
  const macdHist = macdChart.addHistogramSeries({ priceFormat: { type: 'price' }, priceScaleId: 'hist' });
  macdChart.priceScale('hist').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

  // Sync time scales
  const charts = [mainChart, rsiChart, macdChart];
  let syncing = false;
  for (const src of charts) {
    src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      for (const dst of charts) {
        if (dst !== src) {
          try { dst.timeScale().setVisibleLogicalRange(range); } catch {}
        }
      }
      syncing = false;
    });
  }

  // =========================
  // Indicators
  // =========================
  function sma(candles, period) {
    const out = [];
    for (let i = period - 1; i < candles.length; i++) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += candles[j].close;
      out.push({ time: candles[i].time, value: s / period });
    }
    return out;
  }
  function ema(candles, period) {
    if (candles.length === 0) return [];
    const k = 2 / (period + 1);
    const out = [];
    let v = candles[0].close;
    for (let i = 0; i < candles.length; i++) {
      v = i === 0 ? candles[i].close : candles[i].close * k + v * (1 - k);
      if (i >= period - 1) out.push({ time: candles[i].time, value: v });
    }
    return out;
  }
  function rsi(candles, period = 14) {
    if (candles.length <= period) return [];
    const out = [];
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const d = candles[i].close - candles[i - 1].close;
      if (d > 0) gains += d; else losses -= d;
    }
    let avgG = gains / period, avgL = losses / period;
    const pushVal = (i) => {
      const rs = avgL === 0 ? 100 : avgG / avgL;
      out.push({ time: candles[i].time, value: 100 - 100 / (1 + rs) });
    };
    pushVal(period);
    for (let i = period + 1; i < candles.length; i++) {
      const d = candles[i].close - candles[i - 1].close;
      const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      pushVal(i);
    }
    return out;
  }
  function bb(candles, period = 20, mult = 2) {
    const upper = [], middle = [], lower = [];
    for (let i = period - 1; i < candles.length; i++) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += candles[j].close;
      const mean = s / period;
      let v = 0;
      for (let j = i - period + 1; j <= i; j++) v += Math.pow(candles[j].close - mean, 2);
      const sd = Math.sqrt(v / period);
      const t = candles[i].time;
      upper.push({ time: t, value: mean + mult * sd });
      middle.push({ time: t, value: mean });
      lower.push({ time: t, value: mean - mult * sd });
    }
    return { upper, middle, lower };
  }
  function macdCalc(candles) {
    const e12 = ema(candles, 12), e26 = ema(candles, 26);
    const e12Map = new Map(e12.map(p => [p.time, p.value]));
    const macd = [];
    for (const p of e26) {
      const v12 = e12Map.get(p.time);
      if (v12 != null) macd.push({ time: p.time, value: v12 - p.value });
    }
    const k = 2 / 10;
    let sig = macd[0]?.value ?? 0;
    const signal = [];
    for (let i = 0; i < macd.length; i++) {
      sig = i === 0 ? macd[i].value : macd[i].value * k + sig * (1 - k);
      if (i >= 8) signal.push({ time: macd[i].time, value: sig });
    }
    const sigMap = new Map(signal.map(p => [p.time, p.value]));
    const hist = [];
    for (const m of macd) {
      const s = sigMap.get(m.time);
      if (s != null) {
        hist.push({
          time: m.time, value: m.value - s,
          color: m.value - s >= 0 ? 'rgba(16,185,129,0.6)' : 'rgba(239,68,68,0.6)',
        });
      }
    }
    return { macd, signal, hist };
  }

  // =========================
  // State
  // =========================
  const state = {
    timeframe: '1m',
    candles: [],
    indicators: { sma: true, ema: true, bb: false, vol: true },
  };

  function normalizeCandle(c) {
    return {
      time: toUnix(c.eventTime),
      open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
      volume: Number(c.volume) || 0,
    };
  }

  function applyChartData() {
    const cs = state.candles;
    candleSeries.setData(cs);
    if (state.indicators.vol) {
      volumeSeries.setData(cs.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)' })));
    } else {
      volumeSeries.setData([]);
    }

    if (state.indicators.sma) sma20Series.setData(sma(cs, 20)); else sma20Series.setData([]);
    if (state.indicators.ema) ema50Series.setData(ema(cs, 50)); else ema50Series.setData([]);

    if (state.indicators.bb) {
      const b = bb(cs, 20, 2);
      bbUpper.setData(b.upper); bbMiddle.setData(b.middle); bbLower.setData(b.lower);
    } else {
      bbUpper.setData([]); bbMiddle.setData([]); bbLower.setData([]);
    }

    const r = rsi(cs, 14);
    rsiSeries.setData(r);
    if (cs.length >= 14) {
      const first = cs[14].time, last = cs[cs.length - 1].time;
      rsiUpper.setData([{ time: first, value: 70 }, { time: last, value: 70 }]);
      rsiLower.setData([{ time: first, value: 30 }, { time: last, value: 30 }]);
    } else { rsiUpper.setData([]); rsiLower.setData([]); }

    const m = macdCalc(cs);
    macdSeries.setData(m.macd);
    macdSignal.setData(m.signal);
    macdHist.setData(m.hist);

    $('chart-count').textContent = cs.length + ' bars';
    updateStats24h();
  }

  function updateStats24h() {
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
  }

  // =========================
  // Data fetching
  // =========================
  async function loadCandles() {
    try {
      const r = await fetch('/api/candles?timeframe=' + state.timeframe + '&limit=500');
      if (!r.ok) throw new Error('status ' + r.status);
      const j = await r.json();
      state.candles = (j.candles || []).map(normalizeCandle).sort((a, b) => a.time - b.time);
      applyChartData();
      mainChart.timeScale().fitContent();
      rsiChart.timeScale().fitContent();
      macdChart.timeScale().fitContent();
    } catch (e) {
      console.warn('loadCandles failed:', e);
    }
  }

  async function pollSession() {
    try {
      const r = await fetch('/session/now');
      if (!r.ok) throw new Error('status ' + r.status);
      const j = await r.json();
      $('sess-name').textContent = j.session || '—';
      const open = !!j.is_market_open;
      $('sess-market').textContent = open ? '● OPEN' : '○ CLOSED';
      $('sess-market').style.color = open ? 'var(--green)' : 'var(--muted)';
      $('sess-open').textContent = fmtUtc(j.open_utc);
      $('sess-close').textContent = fmtUtc(j.close_utc);
      if (open && j.seconds_until_close != null) {
        $('sess-next').textContent = 'Closes in'; $('sess-next-sub').textContent = fmtSec(j.seconds_until_close);
      } else if (!open && j.seconds_until_next_open != null) {
        $('sess-next').textContent = 'Opens in'; $('sess-next-sub').textContent = fmtSec(j.seconds_until_next_open);
      } else {
        $('sess-next').textContent = '—'; $('sess-next-sub').textContent = '';
      }
    } catch (e) { console.warn('session poll failed:', e); }
  }

  async function pollHealth() {
    try {
      const r = await fetch('/health');
      if (!r.ok) return;
      const j = await r.json();
      $('sources').textContent = j.clients ?? 0;
    } catch {}
  }

  async function pollWeekHistory() {
    try {
      const r = await fetch('/api/session/history?days=7');
      if (!r.ok) return;
      const j = await r.json();
      const el = $('week-hist');
      el.innerHTML = (j.history || []).map(d => {
        const open = d.is_market_open;
        const fill = open ? '100%' : '20%';
        return '<div class="week-row ' + (open ? '' : 'closed') + '">' +
          '<span class="day">' + d.day + '</span>' +
          '<div class="bar"><div class="fill" style="width:' + fill + '"></div></div>' +
          '<span class="sess">' + d.session + '</span>' +
          '</div>';
      }).join('');
    } catch (e) { console.warn('week hist failed:', e); }
  }

  // =========================
  // WebSocket
  // =========================
  let candleCounter = 0;
  const events = [];

  function addEvent(type, text) {
    events.unshift({ time: new Date().toISOString().slice(11, 19), type, text });
    if (events.length > 100) events.pop();
    $('events').innerHTML = events.slice(0, 40).map(e =>
      '<li><span class="time">' + e.time + '</span>' +
      '<span class="type type-' + e.type + '">' + e.type + '</span>' +
      '<span>' + e.text + '</span></li>'
    ).join('');
  }

  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host);

    ws.onopen = () => { $('conn-dot').className = 'dot online'; $('conn-status').textContent = 'live'; };
    ws.onclose = () => {
      $('conn-dot').className = 'dot offline';
      $('conn-status').textContent = 'disconnected — retrying…';
      setTimeout(connectWS, 3000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (msg) => {
      let ev; try { ev = JSON.parse(msg.data); } catch { return; }
      if (ev.type === 'tick') {
        const d = ev.data || {};
        addEvent('tick', (d.source || '?') + ' ' + (d.price ?? '?'));
      } else if (ev.type === 'candle') {
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
      } else if (ev.type === 'quality') {
        $('quality').textContent = ev.data?.status ?? '—';
        addEvent('quality', ev.data?.status ?? '?');
      } else if (ev.type === 'fusion') {
        $('fusion').textContent = ev.data?.value != null ? fmtPrice(ev.data.value) : (ev.data?.conflict ?? '—');
        addEvent('fusion', (ev.data?.value != null ? fmtPrice(ev.data.value) : '?') + ' ' + (ev.data?.conflict || ''));
      } else if (ev.type === 'error') {
        addEvent('error', ev.data?.message ?? '?');
      }
    };
  }

  // =========================
  // Toolbar handlers
  // =========================
  $('tfg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const tf = btn.getAttribute('data-tf');
    if (!tf || tf === state.timeframe) return;
    state.timeframe = tf;
    $('tfg').querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
    loadCandles();
  });

  for (const [id, key] of [['ind-sma','sma'],['ind-ema','ema'],['ind-bb','bb'],['ind-vol','vol']]) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener('change', () => {
      state.indicators[key] = el.checked;
      applyChartData();
    });
  }

  $('btn-fit').addEventListener('click', () => {
    mainChart.timeScale().fitContent();
    rsiChart.timeScale().fitContent();
    macdChart.timeScale().fitContent();
  });

  // =========================
  // Init
  // =========================
  loadCandles();
  pollSession();
  pollHealth();
  pollWeekHistory();
  setInterval(pollSession, 30_000);
  setInterval(pollHealth, 10_000);
  setInterval(pollWeekHistory, 60_000);
  connectWS();
})();
`;

// ============================================================
// SERVER.TS patch — add /api/candles + /api/stats
// ============================================================
const API_ENDPOINT = `
    // Stage 10: /api/candles
    this.app.get('/api/candles', (req, res) => {
      const tf = String(req.query.timeframe || '1m');
      const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
      const candles: any[] = [];
      for (const ev of this.candleHistory.values()) {
        if (ev.type === 'candle' && ((ev as any).timeframe || '1m') === tf) {
          candles.push(ev.data);
        }
      }
      candles.sort((a: any, b: any) => new Date(a.eventTime).getTime() - new Date(b.eventTime).getTime());
      res.json({ timeframe: tf, candles: candles.slice(-limit) });
    });

    // Stage 10: /api/stats
    this.app.get('/api/stats', (_, res) => {
      const byTf: Record<string, number> = {};
      let minTs: string | null = null;
      let maxTs: string | null = null;
      for (const ev of this.candleHistory.values()) {
        if (ev.type === 'candle') {
          const tf = (ev as any).timeframe || '1m';
          byTf[tf] = (byTf[tf] || 0) + 1;
          const ts = (ev.data as any).eventTime;
          if (ts) {
            if (!minTs || ts < minTs) minTs = ts;
            if (!maxTs || ts > maxTs) maxTs = ts;
          }
        }
      }
      res.json({
        candles: this.candleHistory.size,
        byTimeframe: byTf,
        oldestCandle: minTs,
        newestCandle: maxTs,
        clients: this.clients.size,
        session: classifySession(new Date().toISOString()),
      });
    });
`;

// ============================================================
// Write files
// ============================================================
const files = {
  'src/dashboard/public/index.html': INDEX_HTML,
  'src/dashboard/public/styles.css': STYLES_CSS,
  'src/dashboard/public/app.js': APP_JS,
};

for (const [file, content] of Object.entries(files)) {
  console.log('\n--- ' + file + ' ---');
  if (existsSync(file) && !isDryRun) backupFile(file);
  if (isDryRun) {
    console.log('  [DRY] would write (' + content.length + ' chars)' + (existsSync(file) ? ' [overwrites]' : ' [new]'));
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
    console.log('  [WRITE]');
  }
}

// ============================================================
// Patch server.ts
// ============================================================
const SERVER = 'src/dashboard/server.ts';
console.log('\n--- ' + SERVER + ' ---');
if (!existsSync(SERVER)) { console.log('  [MISS] not found'); missed = true; }
else {
  let s = readLF(SERVER);
  if (s.includes("'/api/candles'")) {
    console.log('  [SKIP] /api/candles already present');
  } else {
    const anchor = /(res\.json\(\{ days, history \}\);\n    \}\);)/;
    if (!anchor.test(s)) {
      console.log('  [MISS] /api/session/history closing not found');
      missed = true;
    } else {
      s = s.replace(anchor, (m, p1) => p1 + API_ENDPOINT);
      console.log('  [OK] /api/candles + /api/stats added');
      if (isDryRun) {
        console.log('  [DRY] would write ' + SERVER);
      } else {
        backupFile(SERVER);
        writeLF(SERVER, s);
        console.log('  [WRITE] ' + SERVER);
      }
    }
  }
}

if (missed) {
  console.error('\n⚠️  Some patches missed.');
  if (!isDryRun) { console.error('   Rollback: node patch-stage10.mjs --rollback'); process.exit(2); }
}

if (isDryRun) { console.log('\n=== DRY RUN complete ==='); process.exit(0); }
if (noVerify) { console.log('\n✅ Patches applied.'); process.exit(0); }

console.log('\n=== VERIFICATION ===');
try {
  console.log('\n[1/2] npx tsc --noEmit');
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
  console.log('✅ tsc passed');
} catch { console.error('\n❌ tsc failed. Rollback: node patch-stage10.mjs --rollback'); process.exit(3); }

try {
  console.log('\n[2/2] npm test');
  execSync('npm test', { stdio: 'inherit' });
  console.log('✅ tests passed');
} catch { console.error('\n❌ tests failed. Rollback: node patch-stage10.mjs --rollback'); process.exit(4); }

console.log('\n🎉 Stage 10 complete.');
console.log('   Backup: ' + BACKUP_DIR);
console.log('   Run: npm start → http://localhost:3000');
console.log('   ⚠️  Requires internet for lightweight-charts CDN.');
