import { describe, it, expect, beforeEach } from 'vitest';
import { rmSync } from 'node:fs';
import { RequestTracker } from '../ingestion/request-tracker';

const TEST_DIR = '.backup-req-test';

describe('RequestTracker (§5.2)', () => {
  beforeEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('begin returns unique request_id', () => {
    const rt = new RequestTracker(TEST_DIR);
    const a = rt.begin('twelvedata-ws', 'fetch');
    const b = rt.begin('twelvedata-ws', 'fetch');
    expect(a.request_id).not.toBe(b.request_id);
    expect(a.request_id).toMatch(/^req-/);
  });

  it('complete persists to log', () => {
    const rt = new RequestTracker(TEST_DIR);
    const r = rt.begin('twelvedata-ws', 'fetch');
    rt.complete(r.log, 'SUCCESS', { payload_size: 100 });
    expect(rt.count()).toBe(1);
    const logs = rt.list();
    expect(logs[0]!.status).toBe('SUCCESS');
    expect(logs[0]!.payload_size).toBe(100);
    expect(logs[0]!.completed_at_utc).not.toBeNull();
  });

  it('summary counts statuses', () => {
    const rt = new RequestTracker(TEST_DIR);
    rt.complete(rt.begin('a', 'op1').log, 'SUCCESS');
    rt.complete(rt.begin('a', 'op2').log, 'SUCCESS');
    rt.complete(rt.begin('a', 'op3').log, 'FAILED', { reason: 'timeout' });
    rt.complete(rt.begin('a', 'op4').log, 'SKIPPED', { reason: 'rate_limit' });
    const s = rt.summary();
    expect(s.total).toBe(4);
    expect(s.success).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.skipped).toBe(1);
  });

  it('list is empty initially', () => {
    const rt = new RequestTracker(TEST_DIR);
    expect(rt.list()).toEqual([]);
  });
});