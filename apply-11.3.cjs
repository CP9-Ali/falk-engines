const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);
const warn = (m) => console.log('  [WARN] ' + m);

// ????????? 1. CSS ? fix .panel scope + theme refresh ?????????
let css = fs.readFileSync('src/dashboard/public/styles.css', 'utf8');
const cssLen0 = css.length;

// 1a. Scope .panel to [data-panel] only
css = css.replace(/(?:^|\n)\.panel \{ display: none; \}/, '\n.panel[data-panel] { display: none; }');
css = css.replace(/(?:^|\n)\.panel\.active \{ display: block; \}/, '\n.panel[data-panel].active { display: block; }');
ok('styles.css ? .panel scoped to [data-panel]');

// 1b. Remove old THEME block if present (idempotent)
css = css.replace(/\n\/\* ?+\n   ?11\.3 THEME[\s\S]*$/, '');

// 1c. Append fresh theme
css += `

/* ???????????????????????????????????????????????????????????????
   ?11.3 THEME ? professional trading terminal
   ??????????????????????????????????????????????????????????????? */

/* Stats bar ? 9 columns (was 8), tighter gap */
.stats {
  grid-template-columns: repeat(9, minmax(0, 1fr)) !important;
  gap: 6px !important;
}
@media (max-width: 1400px) { .stats { grid-template-columns: repeat(6, minmax(0, 1fr)) !important; } }
@media (max-width: 900px)  { .stats { grid-template-columns: repeat(3, minmax(0, 1fr)) !important; } }
@media (max-width: 600px)  { .stats { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; } }

/* Stat cards ? hover + status colors */
.stat { transition: border-color 0.2s, background 0.2s; }
.stat:hover { border-color: #374151; background: #131c2c; }
.stat .v { transition: color 0.3s; font-variant-numeric: tabular-nums; }
.stat .v.ok   { color: #10b981; }
.stat .v.warn { color: #f59e0b; }
.stat .v.crit { color: #ef4444; }

/* Tabs ? cleaner underline */
.tabs {
  gap: 0 !important;
  margin: 16px 0 18px 0 !important;
  border-bottom: 1px solid #1f2937 !important;
}
.tab {
  padding: 9px 18px !important;
  background: transparent !important;
  border-bottom: 2px solid transparent !important;
  border-radius: 0 !important;
  transition: color 0.15s, border-color 0.15s !important;
}
.tab:hover { color: #e5e7eb !important; background: transparent !important; }
.tab.active {
  color: #60a5fa !important;
  background: transparent !important;
  border-bottom-color: #60a5fa !important;
}

/* Chart ? subtle shadow */
.chart-wrap { box-shadow: 0 2px 8px rgba(0,0,0,0.25); }

/* Tables ? row hover */
.data-table tbody tr { transition: background 0.1s; }
.data-table tbody tr:hover { background: rgba(96,165,250,0.05); }

/* Session bar ? cell hover */
.session-bar .cell { transition: border-color 0.15s; }
.session-bar .cell:hover { border-color: #374151; }

/* Scrollbars */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg); }
::-webkit-scrollbar-thumb { background: #1f2937; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #374151; }
`;
fs.writeFileSync('src/dashboard/public/styles.css', css, 'utf8');
console.log('  styles.css: ' + cssLen0 + ' -> ' + css.length + ' chars');

// ????????? 2. HTML ?????????
let html = fs.readFileSync('src/dashboard/public/index.html', 'utf8');
const htmlLen0 = html.length;

// 2a. H3 timeframe
if (!html.includes('data-tf="H3"')) {
  html = html.replace(
    '<button data-tf="1h">1h</button>',
    '<button data-tf="1h">1h</button>\n        <button data-tf="H3">H3</button>'
  );
  ok('index.html ? H3 timeframe added');
}

// 2b. ATR checkbox
if (!html.includes('ind-atr')) {
  html = html.replace(
    '<label class="tg"><input type="checkbox" id="ind-vol" checked> <span>Vol</span></label>',
    `<label class="tg"><input type="checkbox" id="ind-vol" checked> <span>Vol</span></label>
      <label class="tg"><input type="checkbox" id="ind-atr"> <span>ATR</span></label>`
  );
  ok('index.html ? ATR checkbox added');
}

// 2c. Alerts stat
if (!html.includes('id="alerts"')) {
  const statsEnd = html.indexOf('</section>', html.indexOf('<section class="stats"'));
  if (statsEnd > 0) {
    html = html.slice(0, statsEnd) + '    <div class="stat"><span class="label">Alerts</span><span class="v" id="alerts">?</span></div>\n  ' + html.slice(statsEnd);
    ok('index.html ? Alerts stat card added');
  }
}

// 2d. Move stats OUTSIDE [data-panel="charts"]
{
  const statsRe = /\s*<section class="stats"[\s\S]*?<\/section>/;
  const m = html.match(statsRe);
  const chartsStart = html.indexOf('<section data-panel="charts"');
  if (m && m.index !== undefined && m.index > chartsStart) {
    const block = m[0];
    // remove
    html = html.slice(0, m.index) + html.slice(m.index + block.length);
    // insert after </nav>
    const navEnd = html.indexOf('</nav>') + '</nav>'.length;
    html = html.slice(0, navEnd) + '\n\n  ' + block.trim() + '\n' + html.slice(navEnd);
    ok('index.html ? stats moved outside charts panel (always visible)');
  } else {
    warn('stats already outside charts panel');
  }
}

fs.writeFileSync('src/dashboard/public/index.html', html, 'utf8');
console.log('  index.html: ' + htmlLen0 + ' -> ' + html.length + ' chars');

// ????????? 3. JS ?????????
let app = fs.readFileSync('src/dashboard/public/app.js', 'utf8');
const appLen0 = app.length;

// 3a. State ? add atr
app = app.replace(
  "indicators: { sma: true, ema: true, bb: false, vol: true },",
  "indicators: { sma: true, ema: true, bb: false, vol: true, atr: false },"
);

// 3b. ATR function
if (!app.includes('function atr(')) {
  app = app.replace(
    '  function bb(candles, period = 20, mult = 2) {',
    `  function atr(candles, period = 14) {
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

  function bb(candles, period = 20, mult = 2) {`
  );
  ok('app.js ? ATR function added');
}

// 3c. ATR series ? hidden price scale, plotted on its own axis
if (!app.includes('atrSeries')) {
  app = app.replace(
    "  const rsiChart = LC.createChart($('rsi-chart'),",
    `  const atrSeries = mainChart.addLineSeries({ color: '#06b6d4', lineWidth: 1, lineStyle: 2, title: 'ATR', priceScaleId: 'atr', lastValueVisible: false, priceLineVisible: false });
  mainChart.priceScale('atr').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 }, visible: false });

  const rsiChart = LC.createChart($('rsi-chart'),`
  );
  ok('app.js ? ATR series registered');
}

// 3d. Apply ATR
if (!app.includes('atrSeries.setData')) {
  app = app.replace(
    '    if (state.indicators.sma) sma20Series.setData(sma(cs, 20)); else sma20Series.setData([]);',
    `    if (state.indicators.sma) sma20Series.setData(sma(cs, 20)); else sma20Series.setData([]);
    if (state.indicators.atr) atrSeries.setData(atr(cs, 14)); else atrSeries.setData([]);`
  );
  ok('app.js ? ATR data applied');
}

// 3e. Wire ATR checkbox
app = app.replace(
  "for (const [id, key] of [['ind-sma','sma'],['ind-ema','ema'],['ind-bb','bb'],['ind-vol','vol']]) {",
  "for (const [id, key] of [['ind-sma','sma'],['ind-ema','ema'],['ind-bb','bb'],['ind-vol','vol'],['ind-atr','atr']]) {"
);

// 3f. pollReports function ? before Init
if (!app.includes('pollReports')) {
  const anchor = `  // =========================
  // Init
  // =========================`;
  const newFn = `  // =========================
  // Reports polling ? data-driven stats (sources/fusion/quality/alerts)
  // =========================
  async function pollReports() {
    try {
      const r = await fetch('/api/reports/summary');
      if (!r.ok) return;
      const j = await r.json();
      const fusion = j.fusion?.report;

      const sEl = $('sources');
      if (sEl) {
        const counts = fusion?.source_counts;
        sEl.textContent = counts?.total ?? '?';
        sEl.title = counts
          ? 'total=' + (counts.total ?? 0) + ' comparable=' + (counts.comparable ?? 0) + ' blocked=' + (counts.blocked ?? 0) + ' dropped=' + (counts.dropped_by_policy ?? 0)
          : 'no fusion report';
      }

      const fEl = $('fusion');
      if (fEl) {
        if (fusion) {
          const st = fusion.conflict_status || '?';
          fEl.textContent = st;
          fEl.className = 'v ' + (
            st === 'CONSISTENT' || st === 'SKIPPED' ? 'ok' :
            st === 'DISCREPANCY' || st === 'INSUFFICIENT_COMPARABLE_DATA' ? 'warn' :
            'crit'
          );
        } else {
          fEl.textContent = '?';
          fEl.className = 'v';
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
        qEl.className = 'v ' + (blocked === null ? '' : (blocked ? 'crit' : 'ok'));
      }

      const aEl = $('alerts');
      if (aEl) {
        aEl.textContent = blocked === null ? '?' : (blocked ? '1' : '0');
        aEl.className = 'v ' + (blocked === null ? '' : (blocked ? 'warn' : 'ok'));
      }
    } catch (e) { /* retry next tick */ }
  }

  // =========================
  // Init
  // =========================`;
  app = app.replace(anchor, newFn);
  ok('app.js ? pollReports added');
}

// 3g. Wire pollReports into init
if (!app.includes('setInterval(pollReports')) {
  app = app.replace(
    `  setInterval(pollSession, 30_000);
  setInterval(pollHealth, 10_000);
  setInterval(pollWeekHistory, 60_000);
  connectWS();`,
    `  pollReports();
  setInterval(pollSession, 30_000);
  setInterval(pollHealth, 10_000);
  setInterval(pollWeekHistory, 60_000);
  setInterval(pollReports, 5_000);
  connectWS();`
  );
  ok('app.js ? pollReports wired into init');
}

// 3h. pollHealth ? use /api/stats for candle count
if (app.includes("$('sources').textContent = j.clients ?? 0;")) {
  app = app.replace(
    /async function pollHealth\(\) \{[\s\S]*?catch \{\}\s*\}/,
    `async function pollHealth() {
    try {
      const r = await fetch('/api/stats');
      if (!r.ok) return;
      const j = await r.json();
      const countEl = $('count');
      if (countEl) countEl.textContent = j.candles ?? 0;
    } catch {}
  }`
  );
  ok('app.js ? pollHealth uses /api/stats for candle count');
}

fs.writeFileSync('src/dashboard/public/app.js', app, 'utf8');
console.log('  app.js: ' + appLen0 + ' -> ' + app.length + ' chars');

// ????????? 4. Verify ?????????
console.log('\n??? verification ???');
console.log('  .panel[data-panel] in CSS:  ', css.includes('.panel[data-panel]'));
console.log('  theme block in CSS:         ', css.includes('?11.3 THEME'));
console.log('  H3 in HTML:                 ', html.includes('data-tf="H3"'));
console.log('  ATR checkbox in HTML:       ', html.includes('ind-atr'));
console.log('  Alerts stat in HTML:        ', html.includes('id="alerts"'));
console.log('  ATR series in JS:           ', app.includes('atrSeries'));
console.log('  ATR function in JS:         ', app.includes('function atr('));
console.log('  pollReports in JS:          ', app.includes('pollReports'));
console.log('  pollHealth uses /api/stats: ', app.includes('j.candles'));

console.log('\nDONE. ?11.3 applied.');
