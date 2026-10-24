import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DashboardServer } from '../dashboard/server';

const PORT = 42000 + Math.floor(Math.random() * 5000);

describe('Stage 9 — dashboard history endpoint', () => {
  let server: DashboardServer;

  beforeAll(async () => {
    server = new DashboardServer(PORT);
    server.start();
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://localhost:${PORT}/health`);
        if (r.ok) return;
      } catch {}
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error('server did not start within 3s');
  }, 10_000);

  afterAll(() => server.stop());

  it('GET /api/session/history default returns 7 days', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/session/history`);
    expect(res.status).toBe(200);
    const j = await res.json() as { days: number; history: unknown[] };
    expect(j.days).toBe(7);
    expect(j.history).toHaveLength(7);
  });

  it('GET /api/session/history?days=3 returns 3 entries', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/session/history?days=3`);
    const j = await res.json() as { days: number; history: unknown[] };
    expect(j.history).toHaveLength(3);
  });

  it('days clamps to [1, 30]', async () => {
    const lo = await fetch(`http://localhost:${PORT}/api/session/history?days=0`).then(r => r.json()) as { days: number };
    const hi = await fetch(`http://localhost:${PORT}/api/session/history?days=999`).then(r => r.json()) as { days: number };
    expect(lo.days).toBe(1);
    expect(hi.days).toBe(30);
  });

  it('each entry has day + bounds', async () => {
    const res = await fetch(`http://localhost:${PORT}/api/session/history?days=2`);
    const j = await res.json() as { history: Array<Record<string, unknown>> };
    for (const e of j.history) {
      expect(e.day).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
      expect(typeof e.open_utc).toBe('string');
      expect(typeof e.close_utc).toBe('string');
      expect(typeof e.is_market_open).toBe('boolean');
    }
  });

  it('GET /session/now returns bounds + server_time_utc', async () => {
    const res = await fetch(`http://localhost:${PORT}/session/now`);
    const j = await res.json() as Record<string, unknown>;
    expect(j.session).toBeDefined();
    expect(j.is_market_open).toBeDefined();
    expect(j.open_utc).toBeDefined();
    expect(j.close_utc).toBeDefined();
    expect(j.server_time_utc).toBeDefined();
  });
});
