import { describe, it, expect } from 'vitest';
import { Scheduler } from '../ingestion/scheduler';

describe('Scheduler (§5)', () => {
  const s = new Scheduler();
  const monday = new Date(Date.UTC(2025, 0, 6, 12, 0, 0)).toISOString();
  const saturday = new Date(Date.UTC(2025, 0, 4, 12, 0, 0)).toISOString();

  it('live-tick always runs', () => {
    expect(s.shouldRun('live-tick', saturday).should_run).toBe(true);
  });

  it('history-fetch blocked on weekend', () => {
    const r = s.shouldRun('history-fetch', saturday);
    expect(r.should_run).toBe(false);
    expect(r.reason).toContain('weekend');
  });

  it('history-fetch runs on Monday', () => {
    expect(s.shouldRun('history-fetch', monday).should_run).toBe(true);
  });

  it('news-fetch runs on weekend', () => {
    expect(s.shouldRun('news-fetch', saturday).should_run).toBe(true);
  });

  it('calendar-fetch runs on weekend', () => {
    expect(s.shouldRun('calendar-fetch', saturday).should_run).toBe(true);
  });
});