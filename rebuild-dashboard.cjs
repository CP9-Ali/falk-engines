const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// ?????????????????????????????????????????????????????????????????
// 1) index.html
// ?????????????????????????????????????????????????????????????????
fs.writeFileSync('src/dashboard/public/index.html', `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FALK ? XAUUSD Dashboard</title>
  <link rel="stylesheet" href="/styles.css?v=14">
  <script src="https://unpkg.com/lightweight-charts@4.1.0/dist/lightweight-charts.standalone.production.js"><\/script>
</head>
<body>
  <div class="app">
    <header class="app-header">
      <div class="brand">
        <div class="brand-mark">FALK</div>
        <div class="brand-sub">
          <span class="symbol">XAUUSD</span>
          <span class="tagline">real-time ? session-aware ? DST-correct</span>
        </div>
      </div>
      <div class="status">
        <span class="dot" id="conn-dot"></span>
        <span id="conn-status">connecting?</span>
      </div>
    </header>

    <section class="session-bar">
      <div class="cell"><span class="lbl">Session</span><span class="val" id="sess-name">?</span></div>
      <div class="cell"><span class="lbl">Market</span><span class="val" id="sess-market">?</span></div>
      <div class="cell"><span class="lbl">Next</span><span class="val" id="sess-next">?</span><span class="sub" id="sess-next-sub"></span></div>
      <div class="cell"><span class="lbl">Week Open</span><span class="val mono" id="sess-open">?</span></div>
      <div class="cell"><span class="lbl">Week Close</span><span class="val mono" id="sess-close">?</span></div>
    </section>

    <section class="stats">
      <div class="stat"><span class="lbl">Price</span><span class="val" id="price">?</span><span class="sub" id="price-change">?</span></div>
      <div class="stat"><span class="lbl">24h High</span><span class="val mono" id="high24">?</span></div>
      <div class="stat"><span class="lbl">24h Low</span><span class="val mono" id="low24">?</span></div>
      <div class="stat"><span class="lbl">24h Volume</span><span class="val mono" id="vol24">?</span></div>
      <div class="stat"><span class="lbl">Quality</span><span class="val" id="quality">?</span></div>
      <div class="stat"><span class="lbl">Fusion</span><span class="val" id="fusion">?</span></div>
      <div class="stat"><span class="lbl">Alerts</span><span class="val" id="alerts">?</span></div>
      <div class="stat"><span class="lbl">Sources</span><span class="val" id="sources">?</span></div>
      <div class="stat"><span class="lbl">Candles</span><span class="val mono" id="count">0</span></div>
    </section>

    <nav class="tabs" id="tabs">
      <button class="tab active" data-tab="charts" type="button">Charts</button>
      <button class="tab" data-tab="fusion" type="button">Fusion</button>
      <button class="tab" data-tab="backtest" type="button">Backtest</button>
      <button class="tab" data-tab="sources" type="button">Sources</button>
      <button class="tab" data-tab="quality" type="button">Quality</button>
      <button class="tab" data-tab="alerts" type="button">Alerts</button>
    </nav>

    <main class="panels">
      <section class="panel active" data-panel="charts">
        <div class="chart-wrap">
          <div class="toolbar">
            <span class="tl">TF</span>
            <div class="tfg" id="tfg">
              <button data-tf="1m" class="active">1m</button>
              <button data-tf="5m">5m</button>
              <button data-tf="15m">15m</button>
              <button data-tf="1h">1h</button>
              <button data-tf="H3">H3</button>
              <button data-tf="4h">4h</button>
              <button data-tf="1d">1d</button>
              <button data-tf="1w">1w</button>
            </div>
            <span class="tl">Indicators</span>
            <label class="tg"><input type="checkbox" id="ind-sma" checked><span>SMA20</span></label>
            <label class="tg"><input type="checkbox" id="ind-ema" checked><span>EMA50</span></label>
            <label class="tg"><input type="checkbox" id="ind-bb"><span>BB</span></label>
            <label class="tg"><input type="checkbox" id="ind-vol" checked><span>Vol</span></label>
            <label class="tg"><input type="checkbox" id="ind-atr"><span>ATR</span></label>
            <span class="spacer"></span>
            <button id="btn-fit">Fit</button>
            <span class="count" id="chart-count">0 bars</span>
          </div>
          <div id="main-chart" class="chart-main"></div>
          <div id="rsi-chart" class="chart-sub"></div>
          <div id="macd-chart" class="chart-sub"></div>
        </div>
        <div class="two-col">
          <div class="card">
            <h3>Weekly Session History</h3>
            <div id="week-hist" class="week-hist"></div>
          </div>
          <div class="card">
            <h3>Recent Events</h3>
            <ul id="events"><li class="empty">waiting for events?</li></ul>
          </div>
        </div>
      </section>

      <section class="panel" data-panel="fusion">
        <div class="panel-head">
          <h2>Fusion Report</h2>
          <span class="pill unk" id="fusion-status">?</span>
        </div>
        <div class="empty" id="fusion-empty">No fusion reports yet. POST to /api/reports/fusion or run the pipeline.</div>
        <div id="fusion-body" hidden>
          <div class="summary-grid">
            <div class="cell"><span class="lbl">REPORT</span><span class="val mono" id="f-report">?</span></div>
            <div class="cell"><span class="lbl">AS-OF UTC</span><span class="val mono" id="f-asof">?</span></div>
            <div class="cell"><span class="lbl">POLICY</span><span class="val" id="f-policy">?</span></div>
            <div class="cell"><span class="lbl">SOURCES USED</span><span class="val mono" id="f-sources">?</span></div>
            <div class="cell"><span class="lbl">INDEPENDENT</span><span class="val mono" id="f-evidence">?</span></div>
            <div class="cell"><span class="lbl">SENSITIVE USE</span><span class="val" id="f-sensitive">?</span></div>
          </div>
          <h3 class="sub-h">Deltas (?P)</h3>
          <div id="f-deltas-wrap"></div>
          <h3 class="sub-h">Raw Sources (unmodified)</h3>
          <div id="f-raw-wrap"></div>
        </div>
      </section>

      <section class="panel" data-panel="backtest">
        <div class="panel-head">
          <h2>Backtest Result</h2>
          <span class="mono muted" id="bt-config">?</span>
        </div>
        <div class="empty" id="bt-empty">No backtest results yet. POST to /api/reports/backtest or run `npm run backtest`.</div>
        <div id="bt-body" hidden>
          <div class="metric-grid">
            <div class="metric"><span class="lbl">SHARPE</span><span class="val mono" id="bt-sharpe">?</span></div>
            <div class="metric"><span class="lbl">SORTINO</span><span class="val mono" id="bt-sortino">?</span></div>
            <div class="metric"><span class="lbl">PROFIT FACTOR</span><span class="val mono" id="bt-pf">?</span></div>
            <div class="metric"><span class="lbl">WIN RATE</span><span class="val mono" id="bt-wr">?</span></div>
            <div class="metric"><span class="lbl">MAX DRAWDOWN</span><span class="val mono" id="bt-dd">?</span></div>
            <div class="metric"><span class="lbl">TRADES</span><span class="val mono" id="bt-trades">?</span></div>
            <div class="metric"><span class="lbl">FINAL EQUITY</span><span class="val mono" id="bt-equity">?</span></div>
            <div class="metric"><span class="lbl">TOTAL FEES</span><span class="val mono" id="bt-fees">?</span></div>
          </div>
        </div>
      </section>

      <section class="panel" data-panel="sources">
        <div class="panel-head"><h2>Source Health</h2></div>
        <div class="empty" id="src-empty">Sources appear from the latest fusion report.</div>
        <div id="src-wrap"></div>
      </section>

      <section class="panel" data-panel="quality">
        <div class="panel-head"><h2>Data Quality</h2></div>
        <div class="empty" id="q-empty">Quality checks appear when the pipeline emits them.</div>
        <div id="q-wrap"></div>
      </section>

      <section class="panel" data-panel="alerts">
        <div class="panel-head"><h2>Active Alerts</h2></div>
        <div class="empty" id="a-empty">No active alerts.</div>
        <div id="a-wrap"></div>
      </section>
    </main>
  </div>
  <script src="/app.js?v=14"><\/script>
</body>
</html>
`, 'utf8');
ok('index.html rewritten');

// ?????????????????????????????????????????????????????????????????
// 2) styles.css
// ?????????????????????????????????????????????????????????????????
fs.writeFileSync('src/dashboard/public/styles.css', `:root {
  --bg: #0a0e17;
  --bg2: #0f1520;
  --panel: #111827;
  --panel2: #0f172a;
  --border: #1f2937;
  --border2: #2d3748;
  --text: #e5e7eb;
  --muted: #6b7280;
  --muted2: #4b5563;
  --accent: #f59e0b;
  --accent2: #60a5fa;
  --green: #10b981;
  --red: #ef4444;
  --amber: #f59e0b;
  --blue: #3b82f6;
  --purple: #8b5cf6;
  --cyan: #06b6d4;
  --mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
body { padding: 14px 16px; min-height: 100vh; }
.app { max-width: 1600px; margin: 0 auto; }

/* Header */
.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.brand { display: flex; align-items: baseline; gap: 14px; }
.brand-mark {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--accent);
}
.brand-sub { display: flex; flex-direction: column; gap: 2px; }
.symbol { font-size: 14px; font-weight: 600; color: var(--text); }
.tagline { font-size: 10px; color: var(--muted); }
.status { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--muted); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted2); transition: all 0.2s; }
.dot.online { background: var(--green); box-shadow: 0 0 8px var(--green); }
.dot.offline { background: var(--red); }

/* Session bar */
.session-bar {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}
.session-bar .cell {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 9px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  transition: border-color 0.15s;
}
.session-bar .cell:hover { border-color: var(--border2); }
.session-bar .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
.session-bar .val { font-size: 14px; font-weight: 600; }
.session-bar .val.mono { font-family: var(--mono); font-size: 11px; }
.session-bar .sub { font-size: 10px; color: var(--muted); }

/* Stats */
.stats {
  display: grid;
  grid-template-columns: repeat(9, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 14px;
}
.stat {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: border-color 0.15s, background 0.15s;
}
.stat:hover { border-color: var(--border2); background: #131c2c; }
.stat .lbl { font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
.stat .val { font-size: 14px; font-weight: 600; transition: color 0.3s; }
.stat .val.mono { font-family: var(--mono); font-size: 12px; }
.stat .val.ok { color: var(--green); }
.stat .val.warn { color: var(--amber); }
.stat .val.crit { color: var(--red); }
.stat .sub { font-size: 10px; color: var(--muted); }

/* Tabs */
.tabs {
  display: flex;
  gap: 0;
  margin: 16px 0 18px 0;
  border-bottom: 1px solid var(--border);
}
.tab {
  background: transparent;
  border: none;
  color: var(--muted);
  padding: 9px 18px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s;
  font-family: inherit;
}
.tab:hover { color: var(--text); }
.tab.active {
  color: var(--accent2);
  border-bottom-color: var(--accent2);
}

/* Panels */
.panel { display: none; }
.panel.active { display: block; }

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.panel-head h2 {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
}
.panel-head .muted { color: var(--muted2); font-size: 10px; }

.empty {
  padding: 40px 20px;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
  border: 1px dashed var(--border);
  border-radius: 6px;
  background: var(--panel);
  margin-bottom: 16px;
}

/* Chart area */
.chart-wrap {
  background: var(--panel2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 14px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.25);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
  font-size: 11px;
}
.toolbar .tl { color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; font-size: 10px; }
.tfg { display: flex; gap: 2px; }
.tfg button {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
  transition: all 0.15s;
}
.tfg button.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
.tfg button:hover:not(.active) { border-color: var(--border2); color: var(--text); }
.tg { display: flex; align-items: center; gap: 4px; color: var(--text); cursor: pointer; user-select: none; }
.tg input { accent-color: var(--accent); cursor: pointer; }
.spacer { flex: 1; }
#btn-fit {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
}
#btn-fit:hover { border-color: var(--border2); color: var(--text); }
.count { color: var(--muted); font-family: var(--mono); font-size: 10px; }

.chart-main { height: 360px; }
.chart-sub { height: 100px; margin-top: 6px; }

/* Two-column cards */
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  min-height: 180px;
}
.card h3 {
  font-size: 11px;
  font-weight: 600;
  margin-bottom: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

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

/* Summary + metric grids */
.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
.summary-grid .cell {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
}
.summary-grid .lbl { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 4px; }
.summary-grid .val { font-size: 13px; font-weight: 600; color: var(--text); }
.summary-grid .val.mono { font-family: var(--mono); }

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
.metric {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
}
.metric .lbl { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); margin-bottom: 6px; }
.metric .val { font-size: 18px; font-weight: 600; color: var(--text); }
.metric .val.mono { font-family: var(--mono); }
.metric .val.pos { color: var(--green); }
.metric .val.neg { color: var(--red); }

.sub-h {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--muted);
  margin: 20px 0 8px 0;
}

/* Tables */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 16px;
}
.data-table th {
  text-align: left;
  padding: 8px 12px;
  background: var(--border);
  color: var(--muted);
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid var(--border2);
}
.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}
.data-table tr:last-child td { border-bottom: none; }
.data-table tbody tr { transition: background 0.1s; }
.data-table tbody tr:hover { background: rgba(96,165,250,0.05); }
.data-table td.mono { font-family: var(--mono); }
.data-table .null { color: var(--muted2); font-style: italic; }
.data-table .unknown { color: var(--amber); font-weight: 600; }

/* Status pill */
.pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.pill.ok { background: rgba(16,185,129,0.15); color: var(--green); }
.pill.warn { background: rgba(245,158,11,0.15); color: var(--amber); }
.pill.crit { background: rgba(239,68,68,0.15); color: var(--red); }
.pill.unk { background: rgba(107,114,128,0.15); color: var(--muted); }

/* Scrollbars */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--border2); }

/* Responsive */
@media (max-width: 1400px) { .stats { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
@media (max-width: 900px) {
  .stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .session-bar { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .two-col { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .session-bar { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`, 'utf8');
ok('styles.css rewritten');

// ?????????????????????????????????????????????????????????????????
// 3) app.js
// ?????????????????????????????????????????????????????????????????
fs.writeFileSync('src/dashboard/public/app.js', `(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fmtNum = (v, d = 2) => {
    if (v === null || v === undefined) return '?';
    if (typeof v !== 'number' || !Number.isFinite(v)) return '?';
    return v.toFixed(d);
  };
  const fmtPct = (v, d = 2) => v == null ? '?' : (v * 100).toFixed(d) + '%';
  const fmtUtc = (iso) => iso ? iso.replace('T', ' ').replace(/\\.\\d+Z$/, 'Z') : '?';
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

  // ??? Guard: lightweight-charts must load ?????????????????????
  if (typeof LightweightCharts === 'undefined') {
    document.body.innerHTML = '<div style="padding:40px;color:#ef4444">lightweight-charts failed to load. Check internet connection.</div>';
    return;
  }
  const LC = LightweightCharts;

  // ??? Chart setup ?????????????????????????????????????????????
  const commonOpts = {
    layout: { background: { color: '#0f172a' }, textColor: '#9ca3af', fontSize: 10 },
    grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#1f2937', rightOffset: 5 },
    rightPriceScale: { borderColor: '#1f2937', scaleMargins: { top: 0.1, bottom: 0.1 } },
    crosshair: { mode: 1, vertLine: { color: '#4b5563', width: 1, style: 2 }, horzLine: { color: '#4b5563', width: 1, style: 2 } },
  };

  function attachResize(chart, container) {
    const ro = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) chart.applyOptions({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(container);
    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) chart.applyOptions({ width, height });
  }

  const mainChart = LC.createChart($('main-chart'), { ...commonOpts, height: 360, width: $('main-chart').clientWidth || 800 });
  const candleSeries = mainChart.addCandlestickSeries({
    upColor: '#10b981', downColor: '#ef4444',
    borderUpColor: '#10b981', borderDownColor: '#ef4444',
    wickUpColor: '#10b981', wickDownColor: '#ef4444',
  });
  const volumeSeries = mainChart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', color: '#374151' });
  mainChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  const sma20Series = mainChart.addLineSeries({ color: '#f59e0b', lineWidth: 2, title: 'SMA20' });
  const ema50Series = mainChart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'EMA50' });
  const bbUpper = mainChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  const bbLower = mainChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  const bbMiddle = mainChart.addLineSeries({ color: '#9ca3af', lineWidth: 1, lineStyle: 2 });
  const atrSeries = mainChart.addLineSeries({ color: '#06b6d4', lineWidth: 1, lineStyle: 2, title: 'ATR', priceScaleId: 'atr', lastValueVisible: false, priceLineVisible: false });
  mainChart.priceScale('atr').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 }, visible: false });

  const rsiChart = LC.createChart($('rsi-chart'), { ...commonOpts, height: 100, width: $('rsi-chart').clientWidth || 800 });
  const rsiSeries = rsiChart.addLineSeries({ color: '#8b5cf6', lineWidth: 2, title: 'RSI14' });
  const rsiUpper = rsiChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  const rsiLower = rsiChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  rsiSeries.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });

  const macdChart = LC.createChart($('macd-chart'), { ...commonOpts, height: 100, width: $('macd-chart').clientWidth || 800 });
  const macdSeries = macdChart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'MACD' });
  const macdSignal = macdChart.addLineSeries({ color: '#f59e0b', lineWidth: 2, title: 'Signal' });
  const macdHist = macdChart.addHistogramSeries({ priceFormat: { type: 'price' }, priceScaleId: 'hist' });
  macdChart.priceScale('hist').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

  attachResize(mainChart, $('main-chart'));
  attachResize(rsiChart, $('rsi-chart'));
  attachResize(macdChart, $('macd-chart'));

  // Sync time scales
  const charts = [mainChart, rsiChart, macdChart];
  let syncing = false;
  for (const src of charts) {
    src.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (syncing || !range) return;
      syncing = true;
      for (const dst of charts) {
        if (dst !== src) { try { dst.timeScale().setVisibleLogicalRange(range); } catch {} }
      }
      syncing = false;
    });
  }

  // ??? Indicators ??????????????????????????????????????????????
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
  function atr(candles, period = 14) {
    if (candles.length < period + 1) return [];
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
      const tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
      trs.push({ time: candles[i].time, tr });
    }
    const out = [];
    let sum = 0;
    for (let i = 0; i < period; i++) sum += trs[i].tr;
    let v = sum / period;
    out.push({ time: trs[period - 1].time, value: v });
    for (let i = period; i < trs.length; i++) {
      v = (v * (period - 1) + trs[i].tr) / period;
      out.push({ time: trs[i].time, value: v });
    }
    return out;
  }

  // ??? Dedupe ??????????????????????????????????????????????????
  function dedupeCandles(candles) {
    const map = new Map();
    for (const c of candles) if (c && Number.isFinite(c.time)) map.set(c.time, c);
    return Array.from(map.values()).sort((a, b) => a.time - b.time);
  }

  // ??? State ???????????????????????????????????????????????????
  const state = {
    timeframe: '1m',
    candles: [],
    indicators: { sma: true, ema: true, bb: false, vol: true, atr: false },
    debug: new URLSearchParams(location.search).has('debug'),
  };

  function normalizeCandle(c) {
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
    return !!c && Number.isFinite(c.time) && c.time > 0
      && Number.isFinite(c.open) && c.open > 0
      && Number.isFinite(c.high) && c.high > 0
      && Number.isFinite(c.low) && c.low > 0
      && Number.isFinite(c.close) && c.close > 0
      && c.high >= c.low;
  }

  function applyChartData() {
    const cs = state.candles;
    candleSeries.setData(cs);

    if (state.indicators.vol) {
      volumeSeries.setData(cs.map(c => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)' })));
    } else volumeSeries.setData([]);

    if (state.indicators.sma) sma20Series.setData(sma(cs, 20)); else sma20Series.setData([]);
    if (state.indicators.ema) ema50Series.setData(ema(cs, 50)); else ema50Series.setData([]);
    if (state.indicators.atr) atrSeries.setData(atr(cs, 14)); else atrSeries.setData([]);

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

    $('chart-count').textContent = cs.length === 0 ? 'no data yet' : cs.length + ' bars';
    updateStats24h(cs);
  }

  function updateStats24h(cs) {
    cs = cs || state.candles;
    if (!cs || cs.length === 0) {
      $('price').textContent = '?';
      $('price-change').textContent = '?';
      $('price-change').style.color = '';
      $('high24').textContent = '?';
      $('low24').textContent = '?';
      $('vol24').textContent = '?';
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

    $('price').textContent = fmtNum(last.close);
    $('price-change').textContent = (change >= 0 ? '+' : '') + fmtNum(change) + ' (' + (change >= 0 ? '+' : '') + changePct.toFixed(2) + '%)';
    $('price-change').style.color = change >= 0 ? 'var(--green)' : 'var(--red)';
    $('high24').textContent = fmtNum(high);
    $('low24').textContent = fmtNum(low);
    $('vol24').textContent = vol.toLocaleString();
  }

  // ??? Data fetching ???????????????????????????????????????????
  async function loadAvailableTimeframes() {
    try {
      const r = await fetch('/api/stats');
      if (!r.ok) return;
      const j = await r.json();
      const byTf = j.byTimeframe || {};
      const available = Object.keys(byTf).filter(tf => byTf[tf] > 0);
      if (available.length === 0) return;
      const ORDER = ['1m', '5m', '15m', '1h', 'H3', '4h', '1d', '1w'];
      const sorted = available.slice().sort((a, b) => {
        const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
      const preferred = sorted.includes('1m') ? '1m' : sorted[0];
      const tfg = $('tfg');
      if (tfg) {
        tfg.innerHTML = sorted.map(tf =>
          '<button data-tf="' + tf + '"' + (tf === preferred ? ' class="active"' : '') + '>' + tf + '</button>'
        ).join('');
        state.timeframe = preferred;
      }
    } catch (e) {}
  }

  async function loadCandles() {
    try {
      const r = await fetch('/api/candles?timeframe=' + state.timeframe + '&limit=500');
      if (!r.ok) throw new Error('status ' + r.status);
      const j = await r.json();
      state.candles = dedupeCandles((j.candles || []).map(normalizeCandle).filter(isValidCandle));
      applyChartData();
      mainChart.timeScale().fitContent();
      rsiChart.timeScale().fitContent();
      macdChart.timeScale().fitContent();
    } catch (e) {}
  }

  async function pollSession() {
    try {
      const r = await fetch('/session/now');
      if (!r.ok) return;
      const j = await r.json();
      $('sess-name').textContent = j.session || '?';
      const open = !!j.is_market_open;
      $('sess-market').textContent = open ? '? OPEN' : '? CLOSED';
      $('sess-market').style.color = open ? 'var(--green)' : 'var(--muted)';
      $('sess-open').textContent = fmtUtc(j.open_utc);
      $('sess-close').textContent = fmtUtc(j.close_utc);
      if (open && j.seconds_until_close != null) {
        $('sess-next').textContent = 'Closes in';
        $('sess-next-sub').textContent = fmtSec(j.seconds_until_close);
      } else if (!open && j.seconds_until_next_open != null) {
        $('sess-next').textContent = 'Opens in';
        $('sess-next-sub').textContent = fmtSec(j.seconds_until_next_open);
      } else {
        $('sess-next').textContent = '?';
        $('sess-next-sub').textContent = '';
      }
    } catch (e) {}
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
          '<span class="sess">' + d.session + '</span></div>';
      }).join('');
    } catch (e) {}
  }

  async function pollStats() {
    try {
      const r = await fetch('/api/stats');
      if (!r.ok) return;
      const j = await r.json();
      $('count').textContent = j.candles ?? 0;
    } catch (e) {}
  }

  async function pollReports() {
    try {
      const r = await fetch('/api/reports/summary');
      if (!r.ok) return;
      const j = await r.json();
      const fusion = j.fusion?.report;

      // Sources
      const sEl = $('sources');
      if (sEl) {
        const counts = fusion?.source_counts;
        sEl.textContent = counts?.total ?? '?';
        sEl.title = counts
          ? 'total=' + (counts.total ?? 0) + ' comparable=' + (counts.comparable ?? 0) + ' blocked=' + (counts.blocked ?? 0)
          : 'no fusion report';
      }

      // Fusion
      const fEl = $('fusion');
      if (fEl) {
        if (fusion) {
          const st = fusion.conflict_status || '?';
          fEl.textContent = st;
          fEl.className = 'val ' + (
            st === 'CONSISTENT' || st === 'SKIPPED' ? 'ok' :
            st === 'DISCREPANCY' || st === 'INSUFFICIENT_COMPARABLE_DATA' ? 'warn' :
            'crit'
          );
        } else {
          fEl.textContent = '?';
          fEl.className = 'val';
        }
      }

      const blocked = fusion
        ? (typeof fusion.sensitive_use_blocked === 'boolean'
            ? fusion.sensitive_use_blocked
            : (fusion.conflict_status !== 'CONSISTENT' && fusion.conflict_status !== 'SKIPPED'))
        : null;

      const qEl = $('quality');
      if (qEl) {
        qEl.textContent = blocked === null ? '?' : (blocked ? 'BLOCKED' : 'OK');
        qEl.className = 'val ' + (blocked === null ? '' : (blocked ? 'crit' : 'ok'));
      }

      const aEl = $('alerts');
      if (aEl) {
        aEl.textContent = blocked === null ? '?' : (blocked ? '1' : '0');
        aEl.className = 'val ' + (blocked === null ? '' : (blocked ? 'warn' : 'ok'));
      }

      renderFusion(j.fusion);
      renderBacktest(j.backtest);
      renderSources(j.fusion);
    } catch (e) {}
  }

  // ??? Panel renderers ?????????????????????????????????????????
  function pillClass(status) {
    if (status === 'CONSISTENT' || status === 'SKIPPED') return 'ok';
    if (status === 'DISCREPANCY' || status === 'INSUFFICIENT_COMPARABLE_DATA') return 'warn';
    if (status === 'UNRESOLVED_CONFLICT' || status === 'FAILED') return 'crit';
    return 'unk';
  }

  function renderFusion(stored) {
    const emptyEl = $('fusion-empty');
    const bodyEl = $('fusion-body');
    const statusEl = $('fusion-status');
    if (!stored || !stored.report) {
      emptyEl.hidden = false;
      bodyEl.hidden = true;
      statusEl.textContent = '?';
      statusEl.className = 'pill unk';
      return;
    }
    const r = stored.report;
    emptyEl.hidden = true;
    bodyEl.hidden = false;
    statusEl.textContent = r.conflict_status || '?';
    statusEl.className = 'pill ' + pillClass(r.conflict_status);

    $('f-report').textContent = r.report_id || '?';
    $('f-asof').textContent = r.as_of_cutoff || '?';
    $('f-policy').textContent = r.policy_version || '?';
    const sc = r.source_counts || {};
    $('f-sources').textContent = (r.sources_used || 0) + ' / ' + (sc.total || 0);
    $('f-evidence').textContent = String(sc.comparable || 0);

    const sens = typeof r.sensitive_use_blocked === 'boolean'
      ? r.sensitive_use_blocked
      : (r.conflict_status !== 'CONSISTENT' && r.conflict_status !== 'SKIPPED');
    $('f-sensitive').textContent = sens ? 'BLOCKED' : 'allowed';
    $('f-sensitive').style.color = sens ? 'var(--red)' : 'var(--green)';

    const dWrap = $('f-deltas-wrap');
    if (!r.deltas || r.deltas.length === 0) {
      dWrap.innerHTML = '<div class="empty">No deltas recorded.</div>';
    } else {
      const rows = r.deltas.map(d =>
        '<tr><td>' + d.from + '</td><td>' + d.to +
        '</td><td class="mono">' + fmtNum(d.delta_p, 4) +
        '</td><td class="mono">' + (d.delta_p_pct == null ? '?' : fmtNum(d.delta_p_pct, 4) + '%') +
        '</td></tr>'
      ).join('');
      dWrap.innerHTML = '<table class="data-table"><thead><tr><th>From</th><th>To</th><th>?P</th><th>?P%</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }

    const rWrap = $('f-raw-wrap');
    if (!r.raw_values || r.raw_values.length === 0) {
      rWrap.innerHTML = '<div class="empty">No raw values.</div>';
    } else {
      const rows = r.raw_values.map(v =>
        '<tr><td>' + v.sourceId + '</td><td>' + v.field +
        '</td><td class="mono">' + (v.value == null ? '?' : fmtNum(v.value, 4)) +
        '</td><td>' + (v.status === 'BLOCKED' ? '<span class="unknown">BLOCKED</span>' : v.status) +
        '</td><td>' + (v.reason || '?') +
        '</td><td class="mono">' + (v.lineage_id || '?') + '</td></tr>'
      ).join('');
      rWrap.innerHTML = '<table class="data-table"><thead><tr><th>Source</th><th>Field</th><th>Value</th><th>Status</th><th>Reason</th><th>Lineage</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }
  }

  function renderBacktest(stored) {
    const emptyEl = $('bt-empty');
    const bodyEl = $('bt-body');
    const configEl = $('bt-config');
    if (!stored || !stored.report) {
      emptyEl.hidden = false;
      bodyEl.hidden = true;
      configEl.textContent = '?';
      return;
    }
    const r = stored.report;
    emptyEl.hidden = true;
    bodyEl.hidden = false;
    configEl.textContent = (r.config_version || '?') + ' ? ' +
      (r.from_utc || '').slice(0, 10) + ' ? ' + (r.to_utc || '').slice(0, 10);

    const m = r.metrics || {};
    $('bt-sharpe').textContent = m.sharpe_ratio == null ? '?' : fmtNum(m.sharpe_ratio, 2);
    $('bt-sortino').textContent = m.sortino_ratio == null ? '?' : fmtNum(m.sortino_ratio, 2);
    $('bt-pf').textContent = m.profit_factor == null ? '?' : fmtNum(m.profit_factor, 2);
    $('bt-wr').textContent = m.win_rate == null ? '?' : fmtPct(m.win_rate, 1);
    $('bt-dd').textContent = m.max_drawdown_pct == null ? '?' : '-' + fmtNum(m.max_drawdown_pct, 2) + '%';
    $('bt-trades').textContent = m.total_trades == null ? '?' : String(m.total_trades);
    $('bt-equity').textContent = '$' + fmtNum(r.final_equity || 0, 2);
    $('bt-fees').textContent = '$' + fmtNum(m.total_fees_abs || 0, 2);

    if (m.max_drawdown_pct != null) {
      $('bt-dd').className = 'val mono ' + (m.max_drawdown_pct >= 20 ? 'neg' : m.max_drawdown_pct >= 10 ? '' : 'pos');
    }
    if (m.total_pnl_abs != null) {
      $('bt-equity').className = 'val mono ' + (m.total_pnl_abs > 0 ? 'pos' : m.total_pnl_abs < 0 ? 'neg' : '');
    }
  }

  function renderSources(stored) {
    const emptyEl = $('src-empty');
    const wrapEl = $('src-wrap');
    if (!stored || !stored.report || !Array.isArray(stored.report.raw_values) || stored.report.raw_values.length === 0) {
      emptyEl.hidden = false;
      wrapEl.innerHTML = '';
      return;
    }
    emptyEl.hidden = true;
    const rows = stored.report.raw_values.map(v =>
      '<tr><td>' + v.sourceId + '</td><td>' + v.field +
      '</td><td class="mono">' + (v.value == null ? '?' : fmtNum(v.value, 4)) +
      '</td><td>' + (v.status === 'BLOCKED' ? '<span class="unknown">BLOCKED</span>' : v.status) +
      '</td><td class="mono">' + (v.source_independence_key || '?') +
      '</td><td>' + (v.reason || '?') + '</td></tr>'
    ).join('');
    wrapEl.innerHTML = '<table class="data-table"><thead><tr><th>Source</th><th>Field</th><th>Value</th><th>Status</th><th>Independence</th><th>Reason</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // ??? Events list ?????????????????????????????????????????????
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

  // ??? Tabs ????????????????????????????????????????????????????
  document.querySelectorAll('.tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      t.classList.add('active');
      const panel = document.querySelector('.panel[data-panel="' + t.dataset.tab + '"]');
      if (panel) panel.classList.add('active');
    });
  });

  // ??? Toolbar ????????????????????????????????????????????????
  $('tfg').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const tf = btn.getAttribute('data-tf');
    if (!tf || tf === state.timeframe) return;
    state.timeframe = tf;
    document.querySelectorAll('#tfg button').forEach(b => b.classList.toggle('active', b === btn));
    loadCandles();
  });
  for (const [id, key] of [['ind-sma','sma'],['ind-ema','ema'],['ind-bb','bb'],['ind-vol','vol'],['ind-atr','atr']]) {
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

  // ??? WebSocket ??????????????????????????????????????????????
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host);
    ws.onopen = () => { $('conn-dot').className = 'dot online'; $('conn-status').textContent = 'live'; };
    ws.onclose = () => {
      $('conn-dot').className = 'dot offline';
      $('conn-status').textContent = 'disconnected ? retrying?';
      setTimeout(connectWS, 3000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (msg) => {
      let ev; try { ev = JSON.parse(msg.data); } catch { return; }
      if (ev.type === 'tick') {
        const d = ev.data || {};
        addEvent('tick', (d.source || '?') + ' ' + (d.price ?? '?'));
      } else if (ev.type === 'candle') {
        const tf = ev.timeframe || '1m';
        const c = normalizeCandle(ev.data);
        if (tf === state.timeframe && c && isValidCandle(c)) {
          state.candles = dedupeCandles([...state.candles, c]);
          applyChartData();
        }
        addEvent('candle', tf + ' close=' + (c?.close ?? '?'));
      } else if (ev.type === 'quality') {
        addEvent('quality', ev.data?.status ?? '?');
      } else if (ev.type === 'fusion') {
        addEvent('fusion', (ev.data?.value != null ? fmtNum(ev.data.value) : '?') + ' ' + (ev.data?.conflict || ''));
      } else if (ev.type === 'error') {
        addEvent('error', ev.data?.message ?? '?');
      }
    };
  }

  // ??? Init ????????????????????????????????????????????????????
  (async () => {
    await loadAvailableTimeframes();
    await loadCandles();
  })();

  pollSession();
  pollWeekHistory();
  pollStats();
  pollReports();
  setInterval(pollSession, 30_000);
  setInterval(pollWeekHistory, 60_000);
  setInterval(pollStats, 10_000);
  setInterval(pollReports, 5_000);
  connectWS();

  window.falkDiag = () => ({
    timeframe: state.timeframe,
    candles: state.candles.length,
    indicators: state.indicators,
  });
})();
`, 'utf8');
ok('app.js rewritten');

console.log('\nDONE. Dashboard frontend fully rebuilt.');
