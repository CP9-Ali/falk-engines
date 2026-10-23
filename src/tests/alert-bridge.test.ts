import { describe, it, expect, beforeEach } from 'vitest';
import { rmSync } from 'node:fs';
import { AlertBridge } from '../monitoring/alert-bridge';
import { AlertManager } from '../monitoring/alerts';
import { HealthMonitor } from '../monitoring/health-monitor';
import { RateLimitManager } from '../ingestion/rate-limiter';
import { ErrorQueue } from '../ingestion/error-queue';
import { HashChainAuditLog } from '../audit/audit-log';

const TEST_DIR = '.backup-alert-test';

function mkBridge() {
  const audit = new HashChainAuditLog();
  const rl = new RateLimitManager();
  const eq = new ErrorQueue(TEST_DIR);
  const am = new AlertManager(audit);
  const hm = new HealthMonitor(rl, eq, ['test']);
  const bridge = new AlertBridge(hm, am, 'test-actor');
  return { rl, eq, am, hm, bridge };
}

describe('AlertBridge (§17)', () => {
  beforeEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('no alerts when healthy', () => {
    const { bridge, am } = mkBridge();
    const snap = bridge.check();
    expect(snap.state).toBe('HEALTHY');
    expect(am.active().length).toBe(0);
  });

  it('raises HIGH on DEGRADED', () => {
    const { rl, bridge, am } = mkBridge();
    rl.registerPolicy('test', { max_per_minute: 10, max_per_day: 100, min_interval_ms: 0 });
    rl.reportRateLimit('test');
    const snap = bridge.check();
    expect(snap.state).toBe('DEGRADED');
    expect(am.byLevel('HIGH').length).toBeGreaterThan(0);
  });

  it('raises CRITICAL on UNHEALTHY', () => {
    const { eq, bridge, am } = mkBridge();
    for (let i = 0; i < 60; i++) {
      eq.push({ source_id: 'test', operation: 'op', reason: 'r' + i });
    }
    const snap = bridge.check();
    expect(snap.state).toBe('UNHEALTHY');
    expect(am.byLevel('CRITICAL').length).toBeGreaterThan(0);
  });

  it('deduplicates repeated alerts', () => {
    const { eq, bridge, am } = mkBridge();
    for (let i = 0; i < 60; i++) eq.push({ source_id: 'test', operation: 'op', reason: 'r' + i });
    bridge.check();
    const c1 = am.active().length;
    bridge.check();
    const c2 = am.active().length;
    expect(c1).toBe(c2); // no new alerts on second check
  });
});