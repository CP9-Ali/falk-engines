import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DashboardEvent =
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

  constructor(private port = 3000) {
    this.app.use(express.static(join(__dirname, 'public')));
    this.app.get('/health', (_, res) => res.json({ ok: true, clients: this.clients.size }));

    this.wss.on('connection', (ws) => {
      this.clients.add(ws);
      ws.on('close', () => this.clients.delete(ws));
    });
  }

  broadcast(event: DashboardEvent): void {
    const msg = JSON.stringify(event);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  start(): void {
    this.httpServer.listen(this.port, () => {
      console.log(`\n[Dashboard] Open: http://localhost:${this.port}\n`);
    });
  }

  stop(): void {
    this.wss.close();
    this.httpServer.close();
  }
}
