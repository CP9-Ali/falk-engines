import { describe, it, expect } from 'vitest';
import { RetryManager } from '../ingestion/retry-manager';

describe('RetryManager (§5)', () => {
  it('succeeds on first attempt', async () => {
    const rm = new RetryManager({ max_attempts: 3, initial_delay_ms: 10, max_delay_ms: 100, backoff_factor: 2, jitter: false });
    const r = await rm.execute(async () => 42);
    expect(r.success).toBe(true);
    expect(r.value).toBe(42);
    expect(r.attempts).toBe(1);
  });

  it('retries until success', async () => {
    const rm = new RetryManager({ max_attempts: 5, initial_delay_ms: 5, max_delay_ms: 50, backoff_factor: 2, jitter: false });
    let calls = 0;
    const r = await rm.execute(async () => {
      calls++;
      if (calls < 3) throw new Error('not yet');
      return 'ok';
    });
    expect(r.success).toBe(true);
    expect(r.value).toBe('ok');
    expect(r.attempts).toBe(3);
    expect(r.errors.length).toBe(2);
  });

  it('fails after max_attempts', async () => {
    const rm = new RetryManager({ max_attempts: 3, initial_delay_ms: 5, max_delay_ms: 50, backoff_factor: 2, jitter: false });
    const r = await rm.execute(async () => { throw new Error('always fails'); });
    expect(r.success).toBe(false);
    expect(r.attempts).toBe(3);
    expect(r.errors.length).toBe(3);
  });

  it('respects max_delay_ms cap', async () => {
    const rm = new RetryManager({ max_attempts: 3, initial_delay_ms: 10, max_delay_ms: 20, backoff_factor: 10, jitter: false });
    const r = await rm.execute(async () => { throw new Error('x'); });
    // delays: 10, min(100, 20)=20 → total 30
    expect(r.total_delay_ms).toBeLessThanOrEqual(30);
  });
});