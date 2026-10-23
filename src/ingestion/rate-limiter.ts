export interface RateLimitPolicy {
  readonly max_per_minute: number;
  readonly max_per_day: number;
  readonly min_interval_ms: number;
}

/** حقول mutable — نحتاج لتعديلها أثناء العمل */
export interface RateLimitState {
  source_id: string;
  minute_window: number[];
  day_window: number[];
  last_request_at: number;
  backoff_until: number;
  consecutive_429: number;
}

export interface AcquireResult {
  readonly allowed: boolean;
  readonly wait_ms: number;
  readonly reason: string;
}

const DEFAULT_POLICIES: Record<string, RateLimitPolicy> = {
  'twelvedata-ws': { max_per_minute: 8, max_per_day: 800, min_interval_ms: 7500 },
  'binance-paxg': { max_per_minute: 1200, max_per_day: 100000, min_interval_ms: 0 },
  'xaus-api': { max_per_minute: 30, max_per_day: 10000, min_interval_ms: 2000 },
  'finnhub': { max_per_minute: 60, max_per_day: 1440, min_interval_ms: 1000 },
  'forexfactory': { max_per_minute: 10, max_per_day: 100, min_interval_ms: 6000 },
  'default': { max_per_minute: 30, max_per_day: 10000, min_interval_ms: 1000 },
};

export class RateLimitManager {
  private states = new Map<string, RateLimitState>();
  private policies: Record<string, RateLimitPolicy> = { ...DEFAULT_POLICIES };

  registerPolicy(sourceId: string, policy: RateLimitPolicy): void {
    this.policies[sourceId] = policy;
  }

  private getState(sourceId: string): RateLimitState {
    let s = this.states.get(sourceId);
    if (!s) {
      s = { source_id: sourceId, minute_window: [], day_window: [], last_request_at: 0, backoff_until: 0, consecutive_429: 0 };
      this.states.set(sourceId, s);
    }
    return s;
  }

  private getPolicy(sourceId: string): RateLimitPolicy {
    return this.policies[sourceId] ?? this.policies['default']!;
  }

  private prune(s: RateLimitState, now: number): void {
    const minAgo = now - 60_000;
    const dayAgo = now - 86_400_000;
    s.minute_window = s.minute_window.filter(t => t > minAgo);
    s.day_window = s.day_window.filter(t => t > dayAgo);
  }

  acquire(sourceId: string): AcquireResult {
    const now = Date.now();
    const s = this.getState(sourceId);
    const p = this.getPolicy(sourceId);
    this.prune(s, now);

    if (now < s.backoff_until) {
      return { allowed: false, wait_ms: s.backoff_until - now, reason: 'backoff_active' };
    }

    if (s.minute_window.length >= p.max_per_minute) {
      const oldest = s.minute_window[0]!;
      const wait = oldest + 60_000 - now;
      return { allowed: false, wait_ms: wait, reason: 'per_minute_exceeded' };
    }

    if (s.day_window.length >= p.max_per_day) {
      const oldest = s.day_window[0]!;
      const wait = oldest + 86_400_000 - now;
      return { allowed: false, wait_ms: wait, reason: 'per_day_exceeded' };
    }

    if (s.last_request_at > 0) {
      const since = now - s.last_request_at;
      if (since < p.min_interval_ms) {
        return { allowed: false, wait_ms: p.min_interval_ms - since, reason: 'min_interval' };
      }
    }

    s.minute_window.push(now);
    s.day_window.push(now);
    s.last_request_at = now;
    return { allowed: true, wait_ms: 0, reason: 'ok' };
  }

  async waitUntilAllowed(sourceId: string, maxWaitMs = 90_000): Promise<AcquireResult> {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      const r = this.acquire(sourceId);
      if (r.allowed) return r;
      if (r.wait_ms > maxWaitMs) return r;
      await new Promise(res => setTimeout(res, Math.min(r.wait_ms, 2000)));
    }
    return { allowed: false, wait_ms: maxWaitMs, reason: 'max_wait_exceeded' };
  }

  reportRateLimit(sourceId: string): number {
    const s = this.getState(sourceId);
    s.consecutive_429++;
    const backoffMs = Math.min(60_000 * Math.pow(2, s.consecutive_429 - 1), 15 * 60_000);
    s.backoff_until = Date.now() + backoffMs;
    return backoffMs;
  }

  reportSuccess(sourceId: string): void {
    const s = this.getState(sourceId);
    s.consecutive_429 = 0;
    s.backoff_until = 0;
  }

  snapshot(sourceId: string): RateLimitState & { policy: RateLimitPolicy } {
    const s = this.getState(sourceId);
    this.prune(s, Date.now());
    return { ...s, policy: this.getPolicy(sourceId) };
  }
}