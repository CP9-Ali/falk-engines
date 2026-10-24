const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);
const skip = (m) => console.log('  [SKIP] ' + m);

// ?????????????????????????????????????????????????????????????????
// Phase 1 ? server.ts routes
// ?????????????????????????????????????????????????????????????????
let sv = fs.readFileSync('src/dashboard/server.ts', 'utf8');
const svBefore = sv.length;

// 1.1 Import
if (!sv.includes("from './reports-store'")) {
  const calRe = /import[^;]*from\s+'\.\.\/calendar\/session-calendar'[^;]*;\s*\n/;
  const m = sv.match(calRe);
  if (!m) throw new Error('no calendar import anchor');
  sv = sv.slice(0, m.index + m[0].length)
     + "import { reportsStore } from './reports-store';\n"
     + sv.slice(m.index + m[0].length);
  ok('server.ts import added');
} else skip('import already present');

// 1.2 express.json as first line of constructor
if (!sv.includes('express.json(')) {
  const ctor = 'constructor(private port = 3000) {';
  const i = sv.indexOf(ctor);
  if (i === -1) throw new Error('no constructor');
  const insert = i + ctor.length;
  sv = sv.slice(0, insert)
     + "\n    this.app.use(express.json({ limit: '2mb' }));"
     + sv.slice(insert);
  ok('server.ts express.json middleware added');
} else skip('express.json already present');

// 1.3 Routes before this.wss.on
if (!sv.includes('/api/reports/summary')) {
  const wssIdx = sv.indexOf('this.wss.on(');
  if (wssIdx === -1) throw new Error('no wss.on anchor');

  const routes = `
    // ?11.1 ? Reports endpoints (fusion / backtest)
    this.app.get('/api/reports/summary', (_, res) => {
      res.json({
        fusion: reportsStore.getFusionLatest(),
        backtest: reportsStore.getBacktestLatest(),
        counts: reportsStore.size(),
        server_time_utc: new Date().toISOString(),
      });
    });

    this.app.get('/api/reports/fusion/latest', (_, res) => {
      res.json(reportsStore.getFusionLatest());
    });

    this.app.get('/api/reports/fusion', (req, res) => {
      const n = Number(req.query.limit);
      const limit = Number.isFinite(n) ? Math.max(0, n) : undefined;
      res.json(reportsStore.getFusionAll(limit));
    });

    this.app.get('/api/reports/backtest/latest', (_, res) => {
      res.json(reportsStore.getBacktestLatest());
    });

    this.app.get('/api/reports/backtest', (req, res) => {
      const n = Number(req.query.limit);
      const limit = Number.isFinite(n) ? Math.max(0, n) : undefined;
      res.json(reportsStore.getBacktestAll(limit));
    });

    this.app.post('/api/reports/fusion', (req, res) => {
      const body = req.body;
      if (!body || typeof body !== 'object' || typeof body.report_id !== 'string') {
        res.status(400).json({ error: 'expected FusionReport body with report_id' });
        return;
      }
      reportsStore.pushFusion(body);
      res.json({ ok: true, size: reportsStore.size() });
    });

    this.app.post('/api/reports/backtest', (req, res) => {
      const body = req.body;
      if (!body || typeof body !== 'object' || typeof body.config_version !== 'string') {
        res.status(400).json({ error: 'expected BacktestResult body with config_version' });
        return;
      }
      reportsStore.pushBacktest(body);
      res.json({ ok: true, size: reportsStore.size() });
    });

    `;
  sv = sv.slice(0, wssIdx) + routes + sv.slice(wssIdx);
  ok('server.ts routes added');
} else skip('routes already present');

fs.writeFileSync('src/dashboard/server.ts', sv, 'utf8');
console.log('  server.ts: ' + svBefore + ' -> ' + sv.length + ' chars');

// ?????????????????????????????????????????????????????????????????
// Phase 2 ? index.html: tabs + panels
// ?????????????????????????????????????????????????????????????????
const htmlPath = 'src/dashboard/public/index.html';
const bakPath = htmlPath + '.pre-11.2.bak';
let html = fs.readFileSync(htmlPath, 'utf8');
if (!fs.existsSync(bakPath)) {
  fs.writeFileSync(bakPath, html, 'utf8');
  ok('index.html backup: ' + bakPath);
}

if (html.includes('id="tabs"')) {
  skip('tabs already present');
} else {
  const statsStart = html.indexOf('<section class="stats"');
  if (statsStart === -1) throw new Error('no <section class="stats">');

  const bodyIdx = html.indexOf('</body>');
  if (bodyIdx === -1) throw new Error('no </body>');
  const beforeBody = html.slice(0, bodyIdx);
  const lastSectionClose = beforeBody.lastIndexOf('</section>');
  if (lastSectionClose === -1) throw new Error('no </section>');
  const contentEnd = lastSectionClose + '</section>'.length;

  const content = html.slice(statsStart, contentEnd);

  const tabsHTML = `
  <nav class="tabs" id="tabs">
    <button data-tab="charts" class="tab active" type="button">Charts</button>
    <button data-tab="fusion" class="tab" type="button">Fusion</button>
    <button data-tab="backtest" class="tab" type="button">Backtest</button>
    <button data-tab="sources" class="tab" type="button">Sources</button>
    <button data-tab="quality" class="tab" type="button">Quality</button>
    <button data-tab="alerts" class="tab" type="button">Alerts</button>
  </nav>
`;

  const newPanels = `
  <section data-panel="fusion" class="panel">
    <div class="panel-head">
      <h2>Fusion Report <span class="muted">?8</span></h2>
      <span class="status-pill unk" id="fusion-status">?</span>
    </div>
    <div class="panel-empty" id="fusion-empty">No fusion reports yet. POST to /api/reports/fusion.</div>
    <div class="panel-body" id="fusion-body" hidden>
      <div class="summary-grid">
        <div class="cell"><span class="label">REPORT</span><span class="v mono" id="f-report">?</span></div>
        <div class="cell"><span class="label">AS-OF (UTC)</span><span class="v mono" id="f-asof">?</span></div>
        <div class="cell"><span class="label">POLICY</span><span class="v" id="f-policy">?</span></div>
        <div class="cell"><span class="label">SOURCES USED</span><span class="v mono" id="f-sources">?</span></div>
        <div class="cell"><span class="label">INDEPENDENT EVIDENCE</span><span class="v mono" id="f-evidence">?</span></div>
        <div class="cell"><span class="label">SENSITIVE USE</span><span class="v" id="f-sensitive">?</span></div>
      </div>
      <h3>Deltas (?P)</h3>
      <div id="f-deltas-wrap"></div>
      <h3>Raw Sources (unmodified)</h3>
      <div id="f-raw-wrap"></div>
    </div>
  </section>

  <section data-panel="backtest" class="panel">
    <div class="panel-head">
      <h2>Backtest Result <span class="muted">?9</span></h2>
      <span class="mono muted" id="bt-config">?</span>
    </div>
    <div class="panel-empty" id="bt-empty">No backtest results yet. POST to /api/reports/backtest.</div>
    <div class="panel-body" id="bt-body" hidden>
      <div class="metric-grid">
        <div class="metric"><span class="label">SHARPE</span><span class="v mono" id="bt-sharpe">?</span></div>
        <div class="metric"><span class="label">SORTINO</span><span class="v mono" id="bt-sortino">?</span></div>
        <div class="metric"><span class="label">PROFIT FACTOR</span><span class="v mono" id="bt-pf">?</span></div>
        <div class="metric"><span class="label">WIN RATE</span><span class="v mono" id="bt-wr">?</span></div>
        <div class="metric"><span class="label">MAX DRAWDOWN</span><span class="v mono" id="bt-dd">?</span></div>
        <div class="metric"><span class="label">TRADES</span><span class="v mono" id="bt-trades">?</span></div>
        <div class="metric"><span class="label">FINAL EQUITY</span><span class="v mono" id="bt-equity">?</span></div>
        <div class="metric"><span class="label">TOTAL FEES</span><span class="v mono" id="bt-fees">?</span></div>
      </div>
    </div>
  </section>

  <section data-panel="sources" class="panel">
    <div class="panel-head"><h2>Source Health <span class="muted">?2 ?5 ?6</span></h2></div>
    <div class="panel-empty" id="src-empty">Sources appear from the latest fusion report.</div>
    <div id="src-wrap"></div>
  </section>

  <section data-panel="quality" class="panel">
    <div class="panel-head"><h2>Data Quality <span class="muted">?9</span></h2></div>
    <div class="panel-empty" id="q-empty">Quality checks appear when the pipeline emits them.</div>
    <div id="q-wrap"></div>
  </section>

  <section data-panel="alerts" class="panel">
    <div class="panel-head"><h2>Active Alerts <span class="muted">?10</span></h2></div>
    <div class="panel-empty" id="a-empty">No active alerts.</div>
    <div id="a-wrap"></div>
  </section>
`;

  // Splice: html[:statsStart] + TABS + CHARTS_PANEL(content) + PANELS + html[contentEnd:]
  const newHtml =
    html.slice(0, statsStart)
    + tabsHTML
    + '\n  <section data-panel="charts" class="panel active">\n    '
    + content
    + '\n  </section>\n'
    + newPanels
    + '\n  '
    + html.slice(contentEnd);

  fs.writeFileSync(htmlPath, newHtml, 'utf8');
  ok('index.html: tabs + 5 panels added, existing sections wrapped');
}

// ?????????????????????????????????????????????????????????????????
// Phase 3 ? styles.css append
// ?????????????????????????????????????????????????????????????????
const cssPath = 'src/dashboard/public/styles.css';
let css = fs.readFileSync(cssPath, 'utf8');
if (css.includes('/* ?11.2')) {
  skip('styles.css ?11.2 already appended');
} else {
  const cssAppend = `

/* ???????????????????????????????????????????????????????????????
   ?11.2 ? Tabs, panels, tables, metrics
   ??????????????????????????????????????????????????????????????? */
.tabs {
  display: flex;
  gap: 0;
  margin: 12px 0 16px 0;
  border-bottom: 1px solid #1f2937;
}
.tab {
  background: transparent;
  border: none;
  color: #6b7280;
  padding: 10px 18px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
  font-family: inherit;
}
.tab:hover { color: #e5e7eb; }
.tab.active {
  color: #60a5fa;
  border-bottom-color: #60a5fa;
}

.panel { display: none; }
.panel.active { display: block; }
.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 0 0 12px 0;
}
.panel-head h2 {
  font-size: 13px;
  font-weight: 600;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #e5e7eb;
}
.panel-head h2 .muted {
  color: #4b5563;
  font-weight: 400;
  font-size: 10px;
  margin-left: 6px;
}
.panel-empty {
  padding: 40px;
  text-align: center;
  color: #6b7280;
  font-size: 12px;
  border: 1px dashed #1f2937;
  border-radius: 6px;
  background: #111827;
  margin-bottom: 16px;
}
.panel-body { display: block; }
.panel h3 {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #6b7280;
  margin: 20px 0 8px 0;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
.summary-grid .cell {
  background: #111827;
  border: 1px solid #1f2937;
  border-radius: 6px;
  padding: 10px 12px;
}
.summary-grid .label {
  display: block;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #6b7280;
  margin-bottom: 4px;
}
.summary-grid .v {
  font-size: 13px;
  font-weight: 600;
  color: #e5e7eb;
}
.summary-grid .v.mono { font-family: ui-monospace, Menlo, monospace; }

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}
.metric {
  background: #111827;
  border: 1px solid #1f2937;
  border-radius: 6px;
  padding: 12px;
}
.metric .label {
  display: block;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #6b7280;
  margin-bottom: 6px;
}
.metric .v {
  font-size: 18px;
  font-weight: 600;
  color: #e5e7eb;
}
.metric .v.mono { font-family: ui-monospace, Menlo, monospace; }
.metric .v.pos { color: #10b981; }
.metric .v.neg { color: #ef4444; }

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  background: #111827;
  border: 1px solid #1f2937;
  border-radius: 6px;
  overflow: hidden;
  margin-bottom: 16px;
}
.data-table th {
  text-align: left;
  padding: 8px 12px;
  background: #1f2937;
  color: #9ca3af;
  font-size: 9px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 1px solid #374151;
}
.data-table td {
  padding: 8px 12px;
  border-bottom: 1px solid #1f2937;
  color: #d1d5db;
}
.data-table tr:last-child td { border-bottom: none; }
.data-table td.mono { font-family: ui-monospace, Menlo, monospace; }
.data-table .null { color: #4b5563; font-style: italic; }
.data-table .unknown { color: #f59e0b; font-weight: 600; }

.status-pill {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.status-pill.ok { background: rgba(16, 185, 129, 0.15); color: #10b981; }
.status-pill.warn { background: rgba(245, 158, 11, 0.15); color: #f59e0b; }
.status-pill.crit { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.status-pill.unk { background: rgba(107, 114, 128, 0.15); color: #9ca3af; }
`;
  fs.writeFileSync(cssPath, css + cssAppend, 'utf8');
  ok('styles.css appended (+?11.2 block)');
}

// ?????????????????????????????????????????????????????????????????
// Phase 4 ? app.js append (own IIFE, isolated scope)
// ?????????????????????????????????????????????????????????????????
const appPath = 'src/dashboard/public/app.js';
let app = fs.readFileSync(appPath, 'utf8');
if (app.includes('// ?11.2 ? multi-panel')) {
  skip('app.js ?11.2 already appended');
} else {
  const appAppend = `

// ???????????????????????????????????????????????????????????????
// ?11.2 ? Multi-panel dashboard (own IIFE, isolated scope)
// ???????????????????????????????????????????????????????????????
(() => {
  'use strict';

  const qs  = (s) => document.querySelector(s);
  const qsa = (s) => Array.from(document.querySelectorAll(s));
  const $   = (id) => document.getElementById(id);

  // ?? Tabs ????????????????????????????????????????????????????
  const tabs   = qsa('.tab');
  const panels = qsa('.panel');
  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));
      t.classList.add('active');
      const panel = qs('.panel[data-panel="' + t.dataset.tab + '"]');
      if (panel) panel.classList.add('active');
    });
  });

  // ?? Formatters ??????????????????????????????????????????????
  const fmt = (v, d = 2) => {
    if (v === null || v === undefined) return '?';
    if (typeof v === 'number' && !Number.isFinite(v)) return '?';
    if (typeof v === 'number') return v.toFixed(d);
    return String(v);
  };
  const fmtPct = (v, d = 2) => {
    if (v === null || v === undefined) return '?';
    return (v * 100).toFixed(d) + '%';
  };
  const fmtNull = (v, d = 2) => {
    if (v === null || v === undefined) return '<span class="null">?</span>';
    return fmt(v, d);
  };
  const pillClass = (status) => {
    if (status === 'CONSISTENT' || status === 'SKIPPED') return 'ok';
    if (status === 'DISCREPANCY' || status === 'INSUFFICIENT_COMPARABLE_DATA') return 'warn';
    if (status === 'UNRESOLVED_CONFLICT' || status === 'FAILED') return 'crit';
    return 'unk';
  };

  // ?? Fusion panel ????????????????????????????????????????????
  function renderFusion(stored) {
    const emptyEl  = $('fusion-empty');
    const bodyEl   = $('fusion-body');
    const statusEl = $('fusion-status');
    if (!stored || !stored.report) {
      if (emptyEl) emptyEl.hidden = false;
      if (bodyEl) bodyEl.hidden = true;
      if (statusEl) { statusEl.textContent = '?'; statusEl.className = 'status-pill unk'; }
      return;
    }
    const r = stored.report;
    if (emptyEl) emptyEl.hidden = true;
    if (bodyEl) bodyEl.hidden = false;
    if (statusEl) {
      statusEl.textContent = r.conflict_status || '?';
      statusEl.className = 'status-pill ' + pillClass(r.conflict_status);
    }
    $('f-report').textContent   = r.report_id || '?';
    $('f-asof').textContent     = r.as_of_cutoff || '?';
    $('f-policy').textContent   = r.policy_version || '?';
    const sc = r.source_counts || {};
    $('f-sources').textContent  = (r.sources_used || 0) + ' / ' + (sc.total || 0);
    $('f-evidence').textContent = String(sc.comparable || 0);
    const sens = !!r.sensitive_use_blocked;
    $('f-sensitive').textContent = sens ? 'BLOCKED' : 'allowed';
    $('f-sensitive').style.color = sens ? '#ef4444' : '#10b981';

    // Deltas
    const dWrap = $('f-deltas-wrap');
    if (dWrap) {
      if (!r.deltas || r.deltas.length === 0) {
        dWrap.innerHTML = '<div class="panel-empty">No deltas recorded (single source or insufficient evidence).</div>';
      } else {
        const rows = r.deltas.map((d) =>
          '<tr><td>' + d.from + '</td><td>' + d.to +
          '</td><td class="mono">' + fmt(d.delta_p, 4) +
          '</td><td class="mono">' + (d.delta_p_pct == null ? fmtNull(null) : fmt(d.delta_p_pct, 4) + '%') +
          '</td></tr>'
        ).join('');
        dWrap.innerHTML = '<table class="data-table"><thead><tr><th>From</th><th>To</th><th>?P</th><th>?P%</th></tr></thead><tbody>' + rows + '</tbody></table>';
      }
    }

    // Raw values
    const rWrap = $('f-raw-wrap');
    if (rWrap) {
      if (!r.raw_values || r.raw_values.length === 0) {
        rWrap.innerHTML = '<div class="panel-empty">No raw values.</div>';
      } else {
        const rows = r.raw_values.map((v) =>
          '<tr>' +
            '<td>' + v.sourceId + '</td>' +
            '<td>' + v.field + '</td>' +
            '<td class="mono">' + fmtNull(v.value, 4) + '</td>' +
            '<td>' + (v.status === 'BLOCKED' ? '<span class="unknown">BLOCKED</span>' : v.status) + '</td>' +
            '<td>' + (v.reason || '?') + '</td>' +
            '<td class="mono muted">' + (v.lineage_id || '?') + '</td>' +
          '</tr>'
        ).join('');
        rWrap.innerHTML = '<table class="data-table"><thead><tr><th>Source</th><th>Field</th><th>Value</th><th>Status</th><th>Reason</th><th>Lineage</th></tr></thead><tbody>' + rows + '</tbody></table>';
      }
    }
  }

  // ?? Backtest panel ??????????????????????????????????????????
  function renderBacktest(stored) {
    const emptyEl  = $('bt-empty');
    const bodyEl   = $('bt-body');
    const configEl = $('bt-config');
    if (!stored || !stored.report) {
      if (emptyEl) emptyEl.hidden = false;
      if (bodyEl) bodyEl.hidden = true;
      if (configEl) configEl.textContent = '?';
      return;
    }
    const r = stored.report;
    if (emptyEl) emptyEl.hidden = true;
    if (bodyEl) bodyEl.hidden = false;
    if (configEl) configEl.textContent = (r.config_version || '?') + ' ? ' +
      (r.from_utc || '').slice(0, 10) + ' ? ' + (r.to_utc || '').slice(0, 10);

    const m = r.metrics || {};
    $('bt-sharpe').textContent  = m.sharpe_ratio == null ? '?' : fmt(m.sharpe_ratio, 2);
    $('bt-sortino').textContent = m.sortino_ratio == null ? '?' : fmt(m.sortino_ratio, 2);
    $('bt-pf').textContent      = m.profit_factor == null ? '?' : fmt(m.profit_factor, 2);
    $('bt-wr').textContent      = m.win_rate == null ? '?' : fmtPct(m.win_rate, 1);
    $('bt-dd').textContent      = m.max_drawdown_pct == null ? '?' : '-' + fmt(m.max_drawdown_pct, 2) + '%';
    $('bt-trades').textContent  = m.total_trades == null ? '?' : String(m.total_trades);
    $('bt-equity').textContent  = '$' + fmt(r.final_equity || 0, 2);
    $('bt-fees').textContent    = '$' + fmt(m.total_fees_abs || 0, 2);

    if (m.max_drawdown_pct != null) {
      $('bt-dd').className = 'v mono ' +
        (m.max_drawdown_pct >= 20 ? 'neg' : m.max_drawdown_pct >= 10 ? '' : 'pos');
    }
    if (m.total_pnl_abs != null) {
      $('bt-equity').className = 'v mono ' +
        (m.total_pnl_abs > 0 ? 'pos' : m.total_pnl_abs < 0 ? 'neg' : '');
    }
  }

  // ?? Sources panel (from latest fusion raw_values) ????????????
  function renderSources(stored) {
    const emptyEl = $('src-empty');
    const wrapEl  = $('src-wrap');
    if (!stored || !stored.report || !Array.isArray(stored.report.raw_values) || stored.report.raw_values.length === 0) {
      if (emptyEl) emptyEl.hidden = false;
      if (wrapEl) wrapEl.innerHTML = '';
      return;
    }
    if (emptyEl) emptyEl.hidden = true;
    const rows = stored.report.raw_values.map((v) =>
      '<tr>' +
        '<td>' + v.sourceId + '</td>' +
        '<td>' + v.field + '</td>' +
        '<td class="mono">' + fmtNull(v.value, 4) + '</td>' +
        '<td>' + (v.status === 'BLOCKED' ? '<span class="unknown">BLOCKED</span>' : v.status) + '</td>' +
        '<td class="mono">' + (v.source_independence_key || '?') + '</td>' +
        '<td>' + (v.reason || '?') + '</td>' +
      '</tr>'
    ).join('');
    if (wrapEl) wrapEl.innerHTML =
      '<table class="data-table"><thead><tr><th>Source</th><th>Field</th><th>Value</th><th>Status</th><th>Independence</th><th>Reason</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // ?? Fetch + poll ????????????????????????????????????????????
  async function refresh() {
    try {
      const res = await fetch('/api/reports/summary');
      if (!res.ok) return;
      const data = await res.json();
      renderFusion(data.fusion);
      renderBacktest(data.backtest);
      renderSources(data.fusion);
    } catch (e) {
      /* network blip ? retry on next tick */
    }
  }

  refresh();
  setInterval(refresh, 5000);
})();
`;
  fs.writeFileSync(appPath, app + appAppend, 'utf8');
  ok('app.js appended (+?11.2 panels)');
}

console.log('\nDONE. ?11.1 + ?11.2 applied.');
