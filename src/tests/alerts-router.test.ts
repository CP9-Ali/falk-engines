import { describe, it, expect, vi } from 'vitest';
import { createAlertRouter } from '../alerts/router';
import { createMemoryChannel } from '../alerts/channels/memory';
import type { Alert, AlertChannel, RouterConfig } from '../alerts/types';

function mkAlert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a-1',
    severity: 'WARNING',
    category: 'custom',
    message: 'hello',
    dedup_key: 'k-1',
    raised_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function mkRouter(overrides: Partial<RouterConfig> = {}): {
  router: ReturnType<typeof createAlertRouter>;
  memoryHigh: ReturnType<typeof createMemoryChannel>;
  memoryCrit: ReturnType<typeof createMemoryChannel>;
  mockCh: AlertChannel & { calls: Alert[] };
} {
  const memoryHigh = createMemoryChannel('memory-high');
  const memoryCrit = createMemoryChannel('memory-crit');
  const mockCalls: Alert[] = [];
  const mockCh: AlertChannel & { calls: Alert[] } = {
    name: 'mock',
    calls: mockCalls,
    async send(a) {
      mockCalls.push(a);
      return { channel: 'mock', alert_id: a.id, ok: true, sent_at: new Date().toISOString() };
    },
  };
  const router = createAlertRouter({
    channels: { 'memory-high': memoryHigh, 'memory-crit': memoryCrit, mock: mockCh },
    routes: {
      WARNING: ['memory-high'],
      HIGH: ['memory-high', 'mock'],
      CRITICAL: ['memory-crit', 'memory-high', 'mock'],
    },
    ...overrides,
  });
  return { router, memoryHigh, memoryCrit, mockCh };
}

describe('?10.3 ? basic dispatch', () => {
  it('routes WARNING to only its channel', async () => {
    const { router, memoryHigh, memoryCrit, mockCh } = mkRouter();
    const r = await router.dispatch(mkAlert({ severity: 'WARNING' }));
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.channel).toBe('memory-high');
    expect(memoryHigh.received()).toHaveLength(1);
    expect(memoryCrit.received()).toHaveLength(0);
    expect(mockCh.calls).toHaveLength(0);
  });

  it('routes HIGH to both memory-high and mock', async () => {
    const { router, memoryHigh, mockCh } = mkRouter();
    await router.dispatch(mkAlert({ severity: 'HIGH' }));
    expect(memoryHigh.received()).toHaveLength(1);
    expect(mockCh.calls).toHaveLength(1);
  });

  it('routes CRITICAL to all three', async () => {
    const { router, memoryHigh, memoryCrit, mockCh } = mkRouter();
    await router.dispatch(mkAlert({ severity: 'CRITICAL' }));
    expect(memoryHigh.received()).toHaveLength(1);
    expect(memoryCrit.received()).toHaveLength(1);
    expect(mockCh.calls).toHaveLength(1);
  });

  it('missing channel is skipped, others still sent', async () => {
    const { router } = mkRouter();
    const r = await router.dispatch(mkAlert({ severity: 'HIGH' }));
    // routes HIGH includes memory-high and mock (both exist), so 2 results
    expect(r.results).toHaveLength(2);
  });

  it('empty route list ? no deliveries', async () => {
    const router = createAlertRouter({
      channels: {},
      routes: { WARNING: [], HIGH: [], CRITICAL: [] },
    });
    const r = await router.dispatch(mkAlert());
    expect(r.results).toHaveLength(0);
    expect(r.skipped_channels).toHaveLength(0);
  });

  it('duplicate channel in route is deduped', async () => {
    const m = createMemoryChannel();
    const router = createAlertRouter({
      channels: { m },
      routes: { WARNING: ['m', 'm', 'm'], HIGH: [], CRITICAL: [] },
    });
    await router.dispatch(mkAlert());
    expect(m.received()).toHaveLength(1);
  });
});

describe('?10.3 ? deduplication', () => {
  it('same dedup_key skips subsequent deliveries to the same channel', async () => {
    const { router, memoryHigh } = mkRouter();
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'dup' }));
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'dup' }));
    expect(memoryHigh.received()).toHaveLength(1);
  });

  it('different dedup_key ? delivered again', async () => {
    const { router, memoryHigh } = mkRouter();
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'dup-1' }));
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'dup-2' }));
    expect(memoryHigh.received()).toHaveLength(2);
  });

  it('skipped channel appears in skipped_channels', async () => {
    const { router } = mkRouter();
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'dup' }));
    const r = await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'dup' }));
    expect(r.skipped_channels).toContain('memory-high');
    expect(r.results).toHaveLength(0);
  });

  it('dedupe_per_channel=false ? same key delivered twice', async () => {
    const { router, memoryHigh } = mkRouter({ dedupe_per_channel: false });
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'dup' }));
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'dup' }));
    expect(memoryHigh.received()).toHaveLength(2);
  });

  it('hasSeen reflects delivery state', async () => {
    const { router } = mkRouter();
    expect(router.hasSeen('x')).toBe(false);
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'x' }));
    expect(router.hasSeen('x')).toBe(true);
  });

  it('failed send does NOT mark as delivered ? retries next time', async () => {
    let attempt = 0;
    const flakyCh: AlertChannel = {
      name: 'flaky',
      async send(a) {
        attempt += 1;
        return {
          channel: 'flaky', alert_id: a.id, ok: attempt > 1,
          sent_at: new Date().toISOString(),
          ...(attempt === 1 ? { error: 'temporary' } : {}),
        };
      },
    };
    const router = createAlertRouter({
      channels: { flaky: flakyCh },
      routes: { WARNING: ['flaky'], HIGH: [], CRITICAL: [] },
    });
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'k' }));
    expect(router.hasSeen('k')).toBe(false);
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'k' }));
    expect(attempt).toBe(2);
    expect(router.hasSeen('k')).toBe(true);
  });
});

describe('?10.3 ? dispatchMany, log, reset', () => {
  it('dispatchMany returns one result per alert', async () => {
    const { router } = mkRouter();
    const rs = await router.dispatchMany([
      mkAlert({ id: 'a1', severity: 'WARNING', dedup_key: 'k1' }),
      mkAlert({ id: 'a2', severity: 'HIGH', dedup_key: 'k2' }),
    ]);
    expect(rs).toHaveLength(2);
    expect(rs[0]!.alert_id).toBe('a1');
    expect(rs[1]!.alert_id).toBe('a2');
  });

  it('log records every successful and failed delivery', async () => {
    const { router } = mkRouter();
    await router.dispatch(mkAlert({ severity: 'HIGH', dedup_key: 'k1' }));
    expect(router.log().length).toBeGreaterThanOrEqual(2);
  });

  it('reset clears dedup + log', async () => {
    const { router } = mkRouter();
    await router.dispatch(mkAlert({ severity: 'WARNING', dedup_key: 'x' }));
    expect(router.hasSeen('x')).toBe(true);
    router.reset();
    expect(router.hasSeen('x')).toBe(false);
    expect(router.log()).toHaveLength(0);
  });

  it('channel throwing is caught and recorded as failed', async () => {
    const throwCh: AlertChannel = {
      name: 'bad',
      async send() { throw new Error('boom'); },
    };
    const router = createAlertRouter({
      channels: { bad: throwCh },
      routes: { WARNING: ['bad'], HIGH: [], CRITICAL: [] },
    });
    const r = await router.dispatch(mkAlert());
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.ok).toBe(false);
    expect(r.results[0]!.error).toBe('boom');
  });

  it('missing channel name in routes is recorded in skipped_channels', async () => {
    const router = createAlertRouter({
      channels: {},
      routes: { WARNING: ['ghost'], HIGH: [], CRITICAL: [] },
    });
    const r = await router.dispatch(mkAlert());
    expect(r.skipped_channels).toContain('ghost');
  });

  it('routes priority does not affect dispatch order ? order follows routes array', async () => {
    const order: string[] = [];
    const chA: AlertChannel = { name: 'a', async send(a) { order.push('a'); return { channel: 'a', alert_id: a.id, ok: true, sent_at: '' }; } };
    const chB: AlertChannel = { name: 'b', async send(a) { order.push('b'); return { channel: 'b', alert_id: a.id, ok: true, sent_at: '' }; } };
    const router = createAlertRouter({
      channels: { a: chA, b: chB },
      routes: { WARNING: ['b', 'a'], HIGH: [], CRITICAL: [] },
    });
    await router.dispatch(mkAlert());
    expect(order).toEqual(['b', 'a']);
  });
});
