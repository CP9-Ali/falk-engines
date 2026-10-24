(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fmtUtc = (iso) => iso ? iso.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '—';
  const fmtSec = (s) => {
    if (s == null || s < 0) return '—';
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = [];
    if (d) parts.push(d + 'd');
    if (h) parts.push(h + 'h');
    if (m || parts.length === 0) parts.push(m + 'm');
    return parts.join(' ');
  };

  async function pollSession() {
    try {
      const r = await fetch('/session/now');
      if (!r.ok) throw new Error('status ' + r.status);
      const j = await r.json();
      $('session-name').textContent = j.session || '—';
      const open = !!j.is_market_open;
      $('session-status').textContent = open ? '● market open' : '○ market closed';
      $('session-status').style.color = open ? 'var(--green)' : 'var(--muted)';
      $('open-utc').textContent = fmtUtc(j.open_utc);
      $('close-utc').textContent = fmtUtc(j.close_utc);

      if (open && j.seconds_until_close != null) {
        $('next-event').textContent = 'Closes in';
        $('next-event-sub').textContent = fmtSec(j.seconds_until_close);
      } else if (!open && j.seconds_until_next_open != null) {
        $('next-event').textContent = 'Opens in';
        $('next-event-sub').textContent = fmtSec(j.seconds_until_next_open);
      } else {
        $('next-event').textContent = '—';
        $('next-event-sub').textContent = '—';
      }
    } catch (e) {
      console.warn('session poll failed:', e);
    }
  }

  async function pollHealth() {
    try {
      const r = await fetch('/health');
      if (!r.ok) return;
      const j = await r.json();
      $('client-count').textContent = j.clients ?? 0;
    } catch {}
  }

  let candleCount = 0;
  const events = [];
  const MAX_EVENTS = 100;

  function addEvent(type, text) {
    events.unshift({ time: new Date().toISOString().slice(11, 19), type, text });
    if (events.length > MAX_EVENTS) events.pop();
    const ul = $('events');
    ul.innerHTML = events.slice(0, 40).map(e =>
      '<li><span class="time">' + e.time + '</span>' +
      '<span class="type type-' + e.type + '">' + e.type + '</span>' +
      '<span>' + e.text + '</span></li>'
    ).join('');
  }

  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(proto + '//' + location.host);

    ws.onopen = () => {
      $('conn-dot').className = 'dot online';
      $('conn-status').textContent = 'live';
    };
    ws.onclose = () => {
      $('conn-dot').className = 'dot offline';
      $('conn-status').textContent = 'disconnected — retrying…';
      setTimeout(connectWS, 3000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (msg) => {
      try {
        const ev = JSON.parse(msg.data);
        if (ev.type === 'tick') {
          const d = ev.data || {};
          $('last-tick').textContent = d.price ?? '—';
          $('last-tick-source').textContent = (d.source || '?') + ' @ ' + String(d.ts || '').slice(11, 19);
          addEvent('tick', (d.source || '?') + ' ' + (d.price ?? '?'));
        } else if (ev.type === 'candle') {
          candleCount++;
          $('candle-count').textContent = candleCount;
          const close = ev.data?.close;
          addEvent('candle', (ev.timeframe || '1m') + ' close=' + (close ?? '—'));
        } else if (ev.type === 'quality') {
          $('quality-status').textContent = ev.data?.status ?? '—';
          addEvent('quality', ev.data?.status ?? '?');
        } else if (ev.type === 'error') {
          addEvent('error', ev.data?.message ?? '?');
        }
      } catch {}
    };
  }

  pollSession();
  pollHealth();
  setInterval(pollSession, 30_000);
  setInterval(pollHealth, 10_000);
  connectWS();
})();
