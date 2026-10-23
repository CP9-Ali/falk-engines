export type ConnectorState = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'FAILED' | 'STOPPED';

export interface ConnectorHealth {
  readonly state: ConnectorState;
  readonly last_success_at: string | null;
  readonly last_failure_at: string | null;
  readonly last_error: string | null;
  readonly consecutive_failures: number;
}

/** §5: عقد موحد لكل مصدر */
export interface Connector {
  readonly source_id: string;
  start(): Promise<void>;
  stop(): void;
}

export class ConnectorManager {
  private connectors = new Map<string, Connector>();
  private healths = new Map<string, ConnectorHealth>();

  register(conn: Connector): void {
    this.connectors.set(conn.source_id, conn);
    this.healths.set(conn.source_id, {
      state: 'DISCONNECTED',
      last_success_at: null,
      last_failure_at: null,
      last_error: null,
      consecutive_failures: 0,
    });
  }

  markConnected(sourceId: string): void {
    const prev = this.healths.get(sourceId);
    if (!prev) return;
    this.healths.set(sourceId, {
      state: 'CONNECTED',
      last_success_at: new Date().toISOString(),
      last_failure_at: prev.last_failure_at,
      last_error: null,
      consecutive_failures: 0,
    });
  }

  markFailed(sourceId: string, error: string): void {
    const prev = this.healths.get(sourceId);
    if (!prev) return;
    this.healths.set(sourceId, {
      state: 'FAILED',
      last_success_at: prev.last_success_at,
      last_failure_at: new Date().toISOString(),
      last_error: error,
      consecutive_failures: prev.consecutive_failures + 1,
    });
  }

  markDisconnected(sourceId: string): void {
    const prev = this.healths.get(sourceId);
    if (!prev) return;
    this.healths.set(sourceId, { ...prev, state: 'DISCONNECTED' });
  }

  async startAll(): Promise<void> {
    for (const [id, conn] of this.connectors) {
      try {
        await conn.start();
        this.markConnected(id);
        console.log('[Connector] ' + id + ' started');
      } catch (e) {
        this.markFailed(id, (e as Error).message);
        console.error('[Connector] ' + id + ' failed:', (e as Error).message);
      }
    }
  }

  stopAll(): void {
    for (const [id, conn] of this.connectors) {
      try { conn.stop(); this.markDisconnected(id); } catch { /* ignore */ }
    }
  }

  health(sourceId: string): ConnectorHealth | null {
    return this.healths.get(sourceId) ?? null;
  }

  allHealths(): Record<string, ConnectorHealth> {
    const out: Record<string, ConnectorHealth> = {};
    for (const [id, h] of this.healths) out[id] = h;
    return out;
  }

  isHealthy(sourceId: string, maxFailures = 5): boolean {
    const h = this.healths.get(sourceId);
    return !!h && h.state === 'CONNECTED' && h.consecutive_failures < maxFailures;
  }
}