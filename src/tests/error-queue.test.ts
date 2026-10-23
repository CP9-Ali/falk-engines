import { describe, it, expect, beforeEach } from 'vitest';
import { rmSync } from 'node:fs';
import { ErrorQueue } from '../ingestion/error-queue';

const TEST_DIR = '.backup-errors-test';

describe('ErrorQueue (§5)', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('starts empty', () => {
    const eq = new ErrorQueue(TEST_DIR);
    expect(eq.count()).toBe(0);
    expect(eq.list()).toEqual([]);
  });

  it('pushes failure', () => {
    const eq = new ErrorQueue(TEST_DIR);
    const op = eq.push({ source_id: 'twelvedata-ws', operation: 'history-fetch', reason: 'HTTP 429' });
    expect(op.id).toMatch(/^err-/);
    expect(eq.count()).toBe(1);
  });

  it('persists across instances', () => {
    const eq1 = new ErrorQueue(TEST_DIR);
    eq1.push({ source_id: 'twelvedata-ws', operation: 'fetch', reason: 'timeout' });
    const eq2 = new ErrorQueue(TEST_DIR);
    expect(eq2.count()).toBe(1);
    expect(eq2.list()[0]!.reason).toBe('timeout');
  });

  it('lists multiple failures', () => {
    const eq = new ErrorQueue(TEST_DIR);
    eq.push({ source_id: 'a', operation: 'op1', reason: 'r1' });
    eq.push({ source_id: 'b', operation: 'op2', reason: 'r2' });
    expect(eq.count()).toBe(2);
  });

  it('reports on startup', () => {
    const eq = new ErrorQueue(TEST_DIR);
    eq.push({ source_id: 'twelvedata-ws', operation: 'op', reason: 'r' });
    const report = eq.reportOnStartup();
    expect(report.length).toBe(1);
  });
});