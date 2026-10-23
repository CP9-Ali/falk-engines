import { describe, it, expect, beforeEach } from 'vitest';
import { rmSync } from 'node:fs';
import { RateLimitManager } from '../ingestion/rate-limiter';
import { ErrorQueue } from '../ingestion/error-queue';
import { HealthMonitor } from '../monitoring/health-monitor';

const TEST_DIR = '.backup-health-test';

describe('HealthMonitor (§9)', () => {
  beforeEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('HEALTHY when no issues', () => {
    const rl = new RateLimitManager();
    const eq = new ErrorQueue(TEST_DIR);
    const hm = new HealthMonitor(rl, eq, ['test']);
    expect(hm.check().state).toBe('HEALTHY');
  });

  it('DEGRADED when rate limited', () => {
    const rl = new RateLimitManager();
    rl.registerPolicy('test', { max_per_minute: 10, max_per_day: 100, min_interval_ms: 0 });
    rl.reportRateLimit('test');
    const eq = new ErrorQueue(TEST_DIR);
    const hm = new HealthMonitor(rl, eq, ['test']);
    const s = hm.check();
    expect(s.state).toBe('DEGRADED');
    expect(s.metrics.backoff_sources).toBe(1);
  });

  it('DEGRADED when errors present', () => {
    const rl = new RateLimitManager();
    const eq = new ErrorQueue(TEST_DIR);
    eq.push({ source_id: 'test', operation: 'op', reason: 'r' });
    const hm = new HealthMonitor(rl, eq, ['test']);
    expect(hm.check().state).toBe('DEGRADED');
  });

  it('UNHEALTHY when >50 errors', () => {
    const rl = new RateLimitManager();
    const eq = new ErrorQueue(TEST_DIR);
    for (let i = 0; i < 60; i++) eq.push({ source_id: 'test', operation: 'op', reason: 'r' + i });
    const hm = new HealthMonitor(rl, eq, ['test']);
    expect(hm.check().state).toBe('UNHEALTHY');
  });

  it('snapshot has metrics', () => {
    const rl = new RateLimitManager();
    const eq = new ErrorQueue(TEST_DIR);
    const hm = new HealthMonitor(rl, eq, ['a', 'b']);
    const s = hm.check();
    expect(s.metrics).toBeDefined();
    expect(s.checked_at_utc).toBeDefined();
  });
});