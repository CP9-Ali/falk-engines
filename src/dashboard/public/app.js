(() => {
  'use strict';

  // =========================
  // Utilities
  // =========================
  const $ = (id) => document.getElementById(id);
  const fmtPrice = (v) => { if (v == null) return '—'; const n = Number(v); return Number.isFinite(n) ? n.toFixed(2) : '—'; };
  const fmtVol = (v) => { if (v == null) return '—'; const n = Number(v); return Number.isFinite(n) ? n.toLocaleString() : '—'; };
  const fmtUtc = (iso) => iso ? iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '—';
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
  }

  // =========================
  // Data fetching
  // =========================
  async function loadCandles() {
    try {
      const r = await fetch('/api/candles?timeframe=' + state.timeframe + '&limit=500');
      if (!r.ok) throw new Error('status ' + r.status);
      const j = await r.json();
      if (state.debug) console.log('[falk] loaded', (j.candles || []).length, 'raw candles, sample:', (j.candles || [])[0]);
      state.candles = (j.candles || []).map(normalizeCandle).filter(isValidCandle).sort((a, b) => a.time - b.time);
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
        const c = normalizeCandle(ev.data);
        if (tf === state.timeframe && c && isValidCandle(c)) {
          const idx = state.candles.findIndex(x => x.time === c.time);
          if (idx >= 0) state.candles[idx] = c;
          else state.candles.push(c);
          state.candles.sort((a, b) => a.time - b.time);
          applyChartData();
        }
        addEvent('candle', tf + ' close=' + (c?.close ?? '—'));
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
