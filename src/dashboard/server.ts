import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

import { currentSessionUtcBounds, classifySession } from '../calendar/session-calendar';

export type DashboardEvent =
  | { type: 'tick'; data: { source: string; price: number; ts: string } }
  | { type: 'candle'; timeframe?: string; data: any; status?: string }
  | { type: 'feature'; timeframe?: string; data: { name: string; value: number | null } }
  | { type: 'quality'; timeframe?: string; data: { status: string; suitable: boolean; volume_semantics?: string } }
  | { type: 'fusion'; timeframe?: string; data: { value: number | null; conflict: string } }
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