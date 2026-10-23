import type { RateLimitManager } from '../ingestion/rate-limiter';
import type { ErrorQueue } from '../ingestion/error-queue';

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface HealthSnapshot {
  readonly state: HealthState;
  readonly checked_at_utc: string;
  readonly reasons: ReadonlyArray<string>;
  readonly metrics: {
    readonly unresolved_errors: number;
    readonly rate_limited_sources: number;
    readonly backoff_sources: number;
  };
}

const V = { schemaVersion: '1.0', policyVersion: 'monitor-v1', configVersion: '1.0', engineVersion: '1.0' };

export class HealthMonitor {
  constructor(
    private readonly rateLimit: RateLimitManager,
    private readonly errors: ErrorQueue,
    private readonly sources: ReadonlyArray<string>,
  ) {}

  check(): HealthSnapshot {
    const now = new Date().toISOString();
    const reasons: string[] = [];
    let rateLimited = 0;
    let backedOff = 0;

    for (const src of this.sources) {
      const s = this.rateLimit.snapshot(src);
      if (s.consecutive_429 > 0) backedOff++;
      if (s.backoff_until > Date.now()) rateLimited++;
    }

    const errCount = this.errors.count();

    if (errCount === 0 && rateLimited === 0 && backedOff === 0) {
      return { state: 'HEALTHY', checked_at_utc: now, reasons: ['all systems nominal'], metrics: { unresolved_errors: 0, rate_limited_sources: 0, backoff_sources: 0 } };
    }

    if (rateLimited > 0) reasons.push(rateLimited + ' source(s) in backoff');
    if (backedOff > 0) reasons.push(backedOff + ' source(s) had 429');
    if (errCount > 0) reasons.push(errCount + ' unresolved errors');

    const state: HealthState = rateLimited >= 2 || errCount > 50 ? 'UNHEALTHY' : 'DEGRADED';

    return { state, checked_at_utc: now, reasons, metrics: { unresolved_errors: errCount, rate_limited_sources: rateLimited, backoff_sources: backedOff } };
  }
}