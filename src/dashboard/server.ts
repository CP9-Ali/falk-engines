import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DashboardEvent =
  | { type: 'tick'; data: { source: string; price: number; ts: string } }
  | { type: 'candle'; data: any; status?: string }
  | { type: 'feature'; data: { name: string; value: number | null } }
  | { type: 'quality'; data: { status: string; suitable: boolean } }
  | { type: 'fusion'; data: { value: number | null; conflict: string } }
  | { type: 'task'; data: { state: string; exec: string } }
  | { type: 'worm'; data: { id: string; total: number; last: string } }
  | { type: 'error'; data: { message: string } };

export class DashboardServer {
  private app = express();
  private httpServer = createServer(this.app);
  private wss = new WebSocketServer({ server: this.httpServer });
  private clients = new Set<WebSocket>();
  private candleHistory = new Map<string, DashboardEvent>();
  private maxHistory = 200;
  private replayCount = 0;

  constructor(private port = 3000) {
    this.app.use(express.static(join(__dirname, 'public')));
    this.app.get('/health', (_, res) => res.json({
      ok: true, clients: this.clients.size, candles: this.candleHistory.size
    }));

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      const events = Array.from(this.candleHistory.values());
      for (const ev of events) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev));
      }
      this.replayCount++;
      console.log('[Dashboard] Client connected, replayed ' + events.length + ' events (total conns: ' + this.replayCount + ')');

      ws.on('close', () => this.clients.delete(ws));
      ws.on('error', () => this.clients.delete(ws));
    });
  }

  broadcast(event: DashboardEvent): void {
    if (event.type === 'candle') {
      const fp = event.data.fingerprint || (event.data.symbol + '-' + event.data.eventTime);
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
    this.httpServer.listen(this.port, () => {
      console.log('[Dashboard] Open: http://localhost:' + this.port);
    });
  }

  stop(): void {
    this.wss.close();
    this.httpServer.close();
  }
}