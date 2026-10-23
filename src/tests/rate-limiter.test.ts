import { describe, it, expect } from 'vitest';
import { RateLimitManager } from '../ingestion/rate-limiter';

describe('RateLimitManager (§5)', () => {
  it('allows within limits', () => {
    const rl = new RateLimitManager();
    rl.registerPolicy('test', { max_per_minute: 3, max_per_day: 100, min_interval_ms: 0 });
    expect(rl.acquire('test').allowed).toBe(true);
    expect(rl.acquire('test').allowed).toBe(true);
    expect(rl.acquire('test').allowed).toBe(true);
  });

  it('blocks per-minute overflow', () => {
    const rl = new RateLimitManager();
    rl.registerPolicy('test', { max_per_minute: 2, max_per_day: 100, min_interval_ms: 0 });
    rl.acquire('test'); rl.acquire('test');
    const r = rl.acquire('test');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('per_minute_exceeded');
  });

  it('respects min_interval', () => {
    const rl = new RateLimitManager();
    rl.registerPolicy('test', { max_per_minute: 10, max_per_day: 100, min_interval_ms: 1000 });
    rl.acquire('test');
    const r = rl.acquire('test');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('min_interval');
  });

  it('429 triggers exponential backoff', () => {
    const rl = new RateLimitManager();
    rl.registerPolicy('test', { max_per_minute: 10, max_per_day: 100, min_interval_ms: 0 });
    const backoff1 = rl.reportRateLimit('test');
    expect(backoff1).toBe(60_000);
    const r = rl.acquire('test');
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('backoff_active');
  });

  it('success resets backoff', () => {
    const rl = new RateLimitManager();
    rl.registerPolicy('test', { max_per_minute: 10, max_per_day: 100, min_interval_ms: 0 });
    rl.reportRateLimit('test');
    rl.reportSuccess('test');
    const r = rl.acquire('test');
    expect(r.allowed).toBe(true);
  });
});