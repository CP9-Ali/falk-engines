(() => {
  'use strict';

  // =========================
  // Utilities
  // =========================
  const $ = (id) => document.getElementById(id);
  const fmtPrice = (v) => { if (v == null) return 'â€”'; const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : 'â€”'; };
  const fmtVol = (v) => { if (v == null) return 'â€”'; const n = Number(v); return Number.isFinite(n) ? n.toLocaleString() : 'â€”'; };
  const fmtUtc = (iso) => iso ? iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : 'â€”';
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
  const CHART_COLORS = (() => {
    const cs = getComputedStyle(document.documentElement);
    const get = (n, fb) => (cs.getPropertyValue(n).trim() || fb);
    return {
      bg:     get('--panel2', '#0f172a'),
      text:   get('--text',   '#9ca3af'),
      border: get('--border', '#1f2937'),
      cross:  get('--muted',  '#4b5563'),
      up:     get('--green',  '#10b981'),
      down:   get('--red',    '#ef4444'),
      vol:    get('--muted',  '#374151'),
      sma:    get('--accent', '#f59e0b'),
      bb:     get('--text',   '#9ca3af'),
    };
  })();

  const commonOpts = {
    layout: { background: { color: CHART_COLORS.bg }, textColor: CHART_COLORS.text, fontSize: 10 },
    grid: { vertLines: { color: CHART_COLORS.border }, horzLines: { color: CHART_COLORS.border } },
    timeScale: { timeVisible: true, secondsVisible: false, borderColor: CHART_COLORS.border, rightOffset: 5 },
    rightPriceScale: { borderColor: CHART_COLORS.border, scaleMargins: { top: 0.1, bottom: 0.1 } },
    crosshair: { mode: 1, vertLine: { color: CHART_COLORS.cross, width: 1, style: 2 }, horzLine: { color: CHART_COLORS.cross, width: 1, style: 2 } },
  };

  function attachResize(chart, container) {
    const ro = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) {
        chart.applyOptions({ width: Math.floor(width), height: Math.floor(height) });
      }
    });
    ro.observe(container);
    const { width, height } = container.getBoundingClientRect();
    if (width > 0 && height > 0) chart.applyOptions({ width, height });
  }

  const mainChart = LC.createChart($('main-chart'), { ...commonOpts, height: 380, width: $('main-chart').clientWidth || 800 });
  const candleSeries = mainChart.addCandlestickSeries({
    upColor: CHART_COLORS.up, downColor: CHART_COLORS.down, borderUpColor: CHART_COLORS.up, borderDownColor: CHART_COLORS.down,
    wickUpColor: CHART_COLORS.up, wickDownColor: CHART_COLORS.down,
  });
  const volumeSeries = mainChart.addHistogramSeries({
    priceFormat: { type: 'volume' }, priceScaleId: 'vol', color: CHART_COLORS.vol,
  });
  mainChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  const sma20Series = mainChart.addLineSeries({ color: CHART_COLORS.sma, lineWidth: 2, title: 'SMA20' });
  const ema50Series = mainChart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'EMA50' });
  const bbUpper = mainChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  const bbLower = mainChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  const bbMiddle = mainChart.addLineSeries({ color: CHART_COLORS.bb, lineWidth: 1, lineStyle: 2 });

  const atrSeries = mainChart.addLineSeries({ color: '#06b6d4', lineWidth: 1, lineStyle: 2, title: 'ATR', priceScaleId: 'atr', lastValueVisible: false, priceLineVisible: false });
  mainChart.priceScale('atr').applyOptions({ scaleMargins: { top: 0.05, bottom: 0.05 }, visible: false });

  const rsiChart = LC.createChart($('rsi-chart'), { ...commonOpts, height: 110, width: $('rsi-chart').clientWidth || 800 });
  const rsiSeries = rsiChart.addLineSeries({ color: '#8b5cf6', lineWidth: 2, title: 'RSI14' });
  const rsiUpper = rsiChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  const rsiLower = rsiChart.addLineSeries({ color: '#6b7280', lineWidth: 1, lineStyle: 2 });
  rsiSeries.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });

  const macdChart = LC.createChart($('macd-chart'), { ...commonOpts, height: 110, width: $('macd-chart').clientWidth || 800 });
  const macdSeries = macdChart.addLineSeries({ color: '#3b82f6', lineWidth: 2, title: 'MACD' });
  const macdSignal = macdChart.addLineSeries({ color: '#f59e0b', lineWidth: 2, title: 'Signal' });
  const macdHist = macdChart.addHistogramSeries({ priceFormat: { type: 'price' }, priceScaleId: 'hist' });
  macdChart.priceScale('hist').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

  // Stage 12: responsive resize
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
  // Dedup â€” lightweight-charts v4 silently rejects duplicate timestamps
  // =========================
  function dedupeCandles(candles) {
    const map = new Map();
    for (const c of candles) {
      if (c && Number.isFinite(c.time)) {
        map.set(c.time, c);  // last wins (newer data replaces older)
      }
    }
    return Array.from(map.values()).sort((a, b) => a.time - b.time);
  }

  // =========================
  // State
  // =========================
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
    return !!c
      && Number.isFinite(c.time) && c.time > 0
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
    } else {
      volumeSeries.setData([]);
    }

    if (state.indicators.sma) sma20Series.setData(sma(cs, 20)); else sma20Series.setData([]);
    if (state.indicators.atr) atrSeries.setData(atr(cs, 14)); else atrSeries.setData([]);
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

    $('chart-count').textContent = cs.length === 0 ? 'no data yet' : cs.length + ' bars';
    updateStats24h(cs);
  }

  function updateStats24h(cs) {
    cs = cs || state.candles;
    if (!cs || cs.length === 0) {
      $('price').textContent = 'â€”';
      $('price-change').textContent = 'â€”';
      $('price-change').style.color = '';
      $('high24').textContent = 'â€”';
      $('low24').textContent = 'â€”';
      $('vol24').textContent = 'â€”';
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
  }

  // =========================
  // Data fetching
  // =========================
  async function loadAvailableTimeframes() {
    try {
      const r = await fetch('/api/stats');
      if (!r.ok) return;
      const j = await r.json();
      const byTf = j.byTimeframe || {};
      const available = Object.keys(byTf).filter(tf => byTf[tf] > 0);
      if (available.length === 0) {
        addEvent('error', 'no candle data available yet â€” waiting for pipeline');
        return;
      }
      const ORDER = ['1m', '5m', '15m', '1h', '4h', '1d', '1w', 'H3'];
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
      addEvent('quality', 'timeframes: ' + sorted.join(',') + ' (default: ' + preferred + ')');
    } catch (e) {
      console.warn('loadAvailableTimeframes failed:', e);
    }
  }

  async function loadCandles() {
    try {
      const r = await fetch('/api/candles?timeframe=' + state.timeframe + '&limit=500');
      if (!r.ok) throw new Error('status ' + r.status);
      const j = await r.json();
      if (state.debug) console.log('[falk] loaded', (j.candles || []).length, 'raw candles, sample:', (j.candles || [])[0]);
      state.candles = dedupeCandles((j.candles || []).map(normalizeCandle).filter(isValidCandle));
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
      $('sess-name').textContent = j.session || 'â€”';
      const open = !!j.is_market_open;
      $('sess-market').textContent = open ? 'â—ڈ OPEN' : 'â—‹ CLOSED';
      $('sess-market').style.color = open ? 'var(--green)' : 'var(--muted)';
      $('sess-open').textContent = fmtUtc(j.open_utc);
      $('sess-close').textContent = fmtUtc(j.close_utc);
      if (open && j.seconds_until_close != null) {
        $('sess-next').textContent = 'Closes in'; $('sess-next-sub').textContent = fmtSec(j.seconds_until_close);
      } else if (!open && j.seconds_until_next_open != null) {
        $('sess-next').textContent = 'Opens in'; $('sess-next-sub').textContent = fmtSec(j.seconds_until_next_open);
      } else {
        $('sess-next').textContent = 'â€”'; $('sess-next-sub').textContent = '';
      }
    } catch (e) { console.warn('session poll failed:', e); }
  }

  async function pollHealth() {
    try {
      const r = await fetch('/api/stats');
      if (!r.ok) return;
      const j = await r.json();
      const countEl = $('count');
      if (countEl) countEl.textContent = j.candles ?? 0;
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
      $('conn-status').textContent = 'disconnected â€” retryingâ€¦';
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
        const c = normalizeCandle(ev.data);
        if (tf === state.timeframe && c && isValidCandle(c)) {
          state.candles = dedupeCandles([...state.candles, c]);
          applyChartData();
        }
        addEvent('candle', tf + ' close=' + (c?.close ?? 'â€”'));
      } else if (ev.type === 'quality') {
        $('quality').textContent = ev.data?.status ?? 'â€”';
        addEvent('quality', ev.data?.status ?? '?');
      } else if (ev.type === 'fusion') {
        $('fusion').textContent = ev.data?.value != null ? fmtPrice(ev.data.value) : (ev.data?.conflict ?? 'â€”');
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

  // =========================
  // Diagnostic (Stage 12): verify canvas rendering
  // =========================
  function diagnose() {
    const container = $('main-chart');
    if (!container) { console.error('[falk] #main-chart missing'); return; }
    const rect = container.getBoundingClientRect();
    const canvases = container.querySelectorAll('canvas');
    const c0 = canvases[0];
    console.log('[falk] main-chart:', {
      containerW: rect.width,
      containerH: rect.height,
      canvasCount: canvases.length,
      canvasW: c0 ? c0.width : null,
      canvasH: c0 ? c0.height : null,
      candleCount: state.candles.length,
      timeframe: state.timeframe,
    });
    if (rect.width === 0 || rect.height === 0) {
      console.error('[falk] CHART CONTAINER HAS ZERO SIZE â€” CSS issue');
    }
    if (canvases.length === 0) {
      console.error('[falk] NO CANVAS â€” chart creation failed');
    }
    if (state.candles.length === 0) {
      console.warn('[falk] no candles loaded â€” waiting for data');
    }
  }

  // =========================
  // Reports polling ? data-driven stats (sources/fusion/quality/alerts)
  // =========================
  async function pollReports() {
    try {
      const r = await fetch('/api/reports/summary');
      if (!r.ok) return;
      const j = await r.json();
      const fusion = j.fusion?.report;
      const qualityVerdict = j.quality?.verdict;

      // Sources count
      const sEl = $('sources');
      if (sEl) {
        const counts = fusion?.source_counts;
        sEl.textContent = counts?.total ?? '?';
        sEl.title = counts
          ? 'total=' + (counts.total ?? 0) + ' comparable=' + (counts.comparable ?? 0) + ' blocked=' + (counts.blocked ?? 0) + ' dropped=' + (counts.dropped_by_policy ?? 0)
          : 'no fusion report';
      }

      // Fusion status
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

      // Quality: read from quality.verdict if available, else derive from fusion
      const qEl = $('quality');
      if (qEl) {
        if (qualityVerdict && qualityVerdict.overallStatus) {
          const st = qualityVerdict.overallStatus;
          qEl.textContent = st === 'PASS' ? 'OK'
                          : st === 'PASS_WITH_WARNINGS' ? 'WARN'
                          : 'FAIL';
          qEl.className = 'v ' + (st === 'PASS' ? 'ok' : st === 'PASS_WITH_WARNINGS' ? 'warn' : 'crit');
        } else if (fusion) {
          const blocked = typeof fusion.sensitive_use_blocked === 'boolean'
            ? fusion.sensitive_use_blocked
            : (fusion.conflict_status !== 'CONSISTENT' && fusion.conflict_status !== 'SKIPPED');
          qEl.textContent = blocked ? 'BLOCKED' : 'OK';
          qEl.className = 'v ' + (blocked ? 'crit' : 'ok');
        } else {
          qEl.textContent = '?';
          qEl.className = 'v';
        }
      }

      // Alerts (derived)
      const aEl = $('alerts');
      if (aEl) {
        if (fusion) {
          const blocked = typeof fusion.sensitive_use_blocked === 'boolean'
            ? fusion.sensitive_use_blocked
            : (fusion.conflict_status !== 'CONSISTENT' && fusion.conflict_status !== 'SKIPPED');
          aEl.textContent = blocked ? '1' : '0';
          aEl.className = 'v ' + (blocked ? 'warn' : 'ok');
        } else {
          aEl.textContent = '?';
          aEl.className = 'v';
        }
      }
    } catch (e) { /* retry next tick */ }
  }

  // =========================
  // Init
  // =========================
  (async () => {
    await loadAvailableTimeframes();
    await loadCandles();
    setTimeout(diagnose, 1000);
  })();
  pollSession();
  pollHealth();
  pollWeekHistory();
  pollReports();
  setInterval(pollSession, 30_000);
  setInterval(pollHealth, 10_000);
  setInterval(pollWeekHistory, 60_000);
  setInterval(pollReports, 5_000);
  connectWS();

  // expose for manual inspection: window.falkDiag()
  window.falkDiag = diagnose;
})();


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
    // If the report doesn't carry the flag, derive it from conflict_status (?8.1).
    const sens = typeof r.sensitive_use_blocked === 'boolean'
      ? r.sensitive_use_blocked
      : (r.conflict_status !== 'CONSISTENT' && r.conflict_status !== 'SKIPPED');
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
  // §11.4 — Quality panel
  function renderQuality(stored) {
    const emptyEl = $('q-empty');
    const wrapEl  = $('q-wrap');
    if (!wrapEl) return;

    if (!stored || !stored.verdict) {
      if (emptyEl) emptyEl.hidden = false;
      wrapEl.innerHTML = '';
      return;
    }

    const v = stored.verdict;
    if (emptyEl) emptyEl.hidden = true;

    const cls = v.overallStatus === 'PASS' ? 'ok'
              : v.overallStatus === 'PASS_WITH_WARNINGS' ? 'warn'
              : 'crit';

    const findings = (v.findings || []).map((f) => {
      const check = f.check || f.checkId || f.id || '?';
      const sev   = f.severity || f.level || f.status || '?';
      const msg   = f.message || f.detail || f.reason || '?';
      const fcls  = (sev === 'ERROR' || sev === 'FAIL') ? 'crit'
                  : (sev === 'WARN' || sev === 'WARNING') ? 'warn'
                  : 'ok';
      return '<tr><td>' + check + '</td><td><span class="v ' + fcls + '">' + sev + '</span></td><td>' + msg + '</td></tr>';
    }).join('');

    const findingsTable = findings
      ? '<table class="data-table"><thead><tr><th>Check</th><th>Severity</th><th>Message</th></tr></thead><tbody>' + findings + '</tbody></table>'
      : '<div class="panel-empty">No findings.</div>';

    wrapEl.innerHTML =
      '<div class="panel-body">' +
        '<div class="row">' +
          '<div class="cell"><span class="label">STATUS</span><span class="v ' + cls + '">' + (v.overallStatus || '?') + '</span></div>' +
          '<div class="cell"><span class="label">SUITABLE</span><span class="v">' + (v.suitableForTask ? 'YES' : 'NO') + '</span></div>' +
          '<div class="cell"><span class="label">FINDINGS</span><span class="v">' + (v.findings ? v.findings.length : 0) + '</span></div>' +
          '<div class="cell"><span class="label">TIMEFRAME</span><span class="v">' + (v.timeframe || '?') + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="panel-head"><h3>Findings</h3></div>' +
      findingsTable;
  }
  async function refresh() {
    try {
      const res = await fetch('/api/reports/summary');
      if (!res.ok) return;
      const data = await res.json();
      renderFusion(data.fusion);
      renderBacktest(data.backtest);
      renderSources(data.fusion);
      renderQuality(data.quality);
    } catch (e) {
      /* network blip ? retry on next tick */
    }
  }

  refresh();
  setInterval(refresh, 5000);
})();
