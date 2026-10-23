export interface RetryPolicy {
  readonly max_attempts: number;
  readonly initial_delay_ms: number;
  readonly max_delay_ms: number;
  readonly backoff_factor: number;
  readonly jitter: boolean;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  max_attempts: 5,
  initial_delay_ms: 1000,
  max_delay_ms: 60_000,
  backoff_factor: 2,
  jitter: true,
};

export interface RetryResult<T> {
  readonly success: boolean;
  readonly value?: T;
  readonly attempts: number;
  readonly errors: ReadonlyArray<string>;
  readonly total_delay_ms: number;
}

/** §5: Retry Manager — exponential backoff with cap + optional jitter */
export class RetryManager {
  constructor(private readonly policy: RetryPolicy = DEFAULT_RETRY_POLICY) {}

  async execute<T>(op: () => Promise<T>, label = 'op'): Promise<RetryResult<T>> {
    const errors: string[] = [];
    let totalDelay = 0;

    for (let attempt = 1; attempt <= this.policy.max_attempts; attempt++) {
      try {
        const value = await op();
        return {
          success: true,
          value,
          attempts: attempt,
          errors,
          total_delay_ms: totalDelay,
        };
      } catch (e) {
        errors.push((e as Error).message);
        if (attempt === this.policy.max_attempts) break;
        const delay = this.computeDelay(attempt);
        totalDelay += delay;
        console.warn('[' + label + '] attempt ' + attempt + '/' + this.policy.max_attempts +
          ' failed (' + (e as Error).message + '), retrying in ' + delay + 'ms');
        await new Promise(r => setTimeout(r, delay));
      }
    }
    console.error('[' + label + '] all ' + this.policy.max_attempts + ' attempts failed');
    return {
      success: false,
      attempts: this.policy.max_attempts,
      errors,
      total_delay_ms: totalDelay,
    };
  }

  private computeDelay(attempt: number): number {
    const base = this.policy.initial_delay_ms * Math.pow(this.policy.backoff_factor, attempt - 1);
    const capped = Math.min(base, this.policy.max_delay_ms);
    if (this.policy.jitter) {
      return Math.floor(capped * (0.5 + Math.random() * 0.5));
    }
    return capped;
  }
}