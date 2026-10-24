import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DashboardServer } from '../dashboard/server';

const PORT = 41000 + Math.floor(Math.random() * 5000);

describe('Stage 7A — dashboard /session endpoints', () => {
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

  it('GET /health includes session info', async () => {
    const res = await fetch(`http://localhost:${PORT}/health`);
    const j = await res.json() as Record<string, unknown>;
    expect(j.ok).toBe(true);
    expect(j.session).toBeDefined();
    expect((j.session as Record<string, unknown>).session).toBeDefined();
    expect((j.session as Record<string, unknown>).is_market_open).toBeDefined();
  });

  it('GET /session/now returns bounds', async () => {
    const res = await fetch(`http://localhost:${PORT}/session/now`);
    const j = await res.json() as Record<string, unknown>;
    expect(j.is_market_open).toBeDefined();
    expect(j.open_utc).toBeDefined();
    expect(j.close_utc).toBeDefined();
    expect(j.server_time_utc).toBeDefined();
  });

  it('GET /session/at?t=valid returns bounds for that time', async () => {
    const res = await fetch(`http://localhost:${PORT}/session/at?t=2025-01-06T10:00:00.000Z`);
    expect(res.status).toBe(200);
    const j = await res.json() as Record<string, unknown>;
    expect(j.session).toBe('LONDON');
    expect(j.is_market_open).toBe(true);
    expect(j.open_utc).toBe('2025-01-05T22:00:00.000Z');
    expect(j.close_utc).toBe('2025-01-10T22:00:00.000Z');
  });

  it('GET /session/at?t=invalid returns 400', async () => {
    const res = await fetch(`http://localhost:${PORT}/session/at?t=not-a-date`);
    expect(res.status).toBe(400);
  });

  it('GET /session/at without t returns 400', async () => {
    const res = await fetch(`http://localhost:${PORT}/session/at`);
    expect(res.status).toBe(400);
  });
});
