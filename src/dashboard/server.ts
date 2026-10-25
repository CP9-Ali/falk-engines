import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { currentSessionUtcBounds, classifySession } from '../calendar/session-calendar';

import type { AvailabilityReport } from '../multi-timeframe/availability';
import { reportsStore } from './reports-store';
export type DashboardEvent =
  | { type: 'tick'; data: { source: string; price: number; ts: string } }
  | { type: 'candle'; timeframe?: string; data: any; status?: string }
  | { type: 'feature'; timeframe?: string; data: { name: string; value: number | null } }
  | { type: 'quality'; timeframe?: string; data: { status: string; suitable: boolean; volume_semantics?: string } }
  | { type: 'fusion'; timeframe?: string; data: { value: number | null; conflict: string } }
  | { type: 'availability'; timeframe?: string; data: AvailabilityReport }
  | { type: 'task'; timeframe?: string; data: { state: string; exec: string } }
  | { type: 'worm'; data: { id: string; total: number; last: string } }
  | { type: 'error'; timeframe?: string; data: { message: string } };

export class DashboardServer {
  private app = express();
  private httpServer = createServer(this.app);
  private wss = new WebSocketServer({ server: this.httpServer });
  private clients = new Set<WebSocket>();
  private candleHistory = new Map<string, DashboardEvent>();
  private maxHistory = 500;
  private replayCount = 0;

  constructor(private port = 3000) {
    this.app.use(express.json({ limit: '2mb' }));
    this.app.use(express.static(join(__dirname, 'public')));
    this.app.get('/health', (_, res) => res.json({
      ok: true,
      clients: this.clients.size,
      candles: this.candleHistory.size,
      session: classifySession(new Date().toISOString()),
    }));

    // Stage 7A: session endpoints
    this.app.get('/session/now', (_, res) => {
      const now = new Date().toISOString();
      const bounds = currentSessionUtcBounds(now);
      res.json({ ...bounds, server_time_utc: now });
    });

    this.app.get('/session/at', (req, res) => {
      const t = req.query.t;
      if (typeof t !== 'string') {
        res.status(400).json({ error: 'query param t required (ISO string)' });
        return;
      }
      const d = new Date(t);
      if (!Number.isFinite(d.getTime())) {
        res.status(400).json({ error: 'invalid ISO timestamp' });
        return;
      }
      const info = classifySession(t);
      const bounds = currentSessionUtcBounds(t);
      res.json({ ...info, ...bounds, server_time_utc: new Date().toISOString() });
    });
    // Stage 9: session history for dashboard chart
    this.app.get('/api/session/history', (req, res) => {
      const daysRaw = req.query.days;
      const n = Number(daysRaw);
      const days = Number.isFinite(n) ? Math.min(Math.max(n, 1), 30) : 7;
      const history: Array<{
        day: string;
        session: string;
        is_market_open: boolean;
        open_utc: string;
        close_utc: string;
      }> = [];
      const nowMs = Date.now();
      for (let i = days - 1; i >= 0; i--) {
        const at = new Date(nowMs - i * 86_400_000).toISOString();
        const b = currentSessionUtcBounds(at);
        history.push({
          day: at.slice(0, 10),
          session: b.session,
          is_market_open: b.is_market_open,
          open_utc: b.open_utc,
          close_utc: b.close_utc,
        });
      }
      res.json({ days, history });
    });

    // Stage 12: /api/timeframes
    this.app.get('/api/timeframes', (_, res) => {
      const counts: Record<string, number> = {};
      for (const ev of this.candleHistory.values()) {
        if (ev.type === 'candle') {
          const tf = (ev as any).timeframe || '1m';
          counts[tf] = (counts[tf] || 0) + 1;
        }
      }
      const timeframes = Object.keys(counts).sort();
      res.json({ timeframes, counts });
    });

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




    // Stage 10.2: /api/candles/debug â€” inspect raw candle shape
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

    
    // ?11.1 ? Reports endpoints (fusion / backtest)
    this.app.get('/api/reports/summary', (_, res) => {
      res.json({
        fusion: reportsStore.getFusionLatest(),
        backtest: reportsStore.getBacktestLatest(),
        quality: reportsStore.getQualityLatest(),
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

    // §11.4 — Quality endpoints
    this.app.get('/api/quality/latest', (_, res) => {
      res.json(reportsStore.getQualityLatest());
    });

    this.app.get('/api/quality', (req, res) => {
      const n = Number(req.query.limit);
      const limit = Number.isFinite(n) ? Math.max(0, n) : undefined;
      res.json(reportsStore.getQualityAll(limit));
    });

    this.app.post('/api/quality', (req, res) => {
      const body = req.body;
      if (!body || typeof body !== 'object' || typeof body.overallStatus !== 'string') {
        res.status(400).json({ error: 'expected QualityVerdict body with overallStatus' });
        return;
      }
      reportsStore.pushQuality(body);
      res.json({ ok: true, size: reportsStore.size() });
    });
    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      for (const ev of this.candleHistory.values()) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev));
      }
      this.replayCount++;
      console.log('[Dashboard] Client connected, replayed ' + this.candleHistory.size + ' events (conns: ' + this.replayCount + ')');
      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
  }

  broadcast(event: DashboardEvent): void {
    if (event.type === 'candle') {
      const tf = (event as any).timeframe || '1m';
      const fp = (event.data.fingerprint || (event.data.symbol + '-' + event.data.eventTime)) + ':' + tf;
      if (!this.candleHistory.has(fp)) {
        this.candleHistory.set(fp, event);
        if (this.candleHistory.size > this.maxHistory) {
          const firstKey = this.candleHistory.keys().next().value;
          if (firstKey) this.candleHistory.delete(firstKey);
        }
      }
    }
    const msg = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  start(): void {
    this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error('\nPort ' + this.port + ' already in use.');
        console.error('Fix: Get-Process node | Stop-Process -Force\n');
        process.exit(1);
      } else {
        console.error('Server error:', err.message);
        process.exit(1);
      }
    });

    this.httpServer.listen(this.port, () => {
      console.log('[Dashboard] Open: http://localhost:' + this.port);
    });
  }

  stop(): void {
    this.wss.close();
    this.httpServer.close();
  }
}