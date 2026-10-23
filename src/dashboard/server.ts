import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
    this.app.get('/health', (_, res) => res.json({ ok: true, clients: this.clients.size, candles: this.candleHistory.size }));

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
        console.error('\n? Port ' + this.port + ' already in use.');
        console.error('   Fix: Get-Process node | Stop-Process -Force\n');
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