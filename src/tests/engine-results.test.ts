import { describe, it, expect, beforeEach } from 'vitest';
import { rmSync } from 'node:fs';
import { EngineResultsLog } from '../replay/engine-results';

const TEST_DIR = '.backup-engine-runs-test';

describe('EngineResultsLog (§13)', () => {
  beforeEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('appends and reads entries', () => {
    const log = new EngineResultsLog(TEST_DIR);
    log.append({
      analysis_run_id: 'run-1',
      timeframe: '1m',
      candle_fingerprint: 'fp1',
      candle_event_time_utc: '2025-01-01T00:00:00Z',
      engine: 'feature',
      engine_version: '1.0.0',
      status: 'VALID',
      value: { sma: 4000, rsi: 50, atr: 2 },
      created_at_utc: '2025-01-01T00:00:01Z',
    });
    expect(log.count('run-1')).toBe(1);
  });

  it('separates by run_id', () => {
    const log = new EngineResultsLog(TEST_DIR);
    log.append({ analysis_run_id: 'run-A', timeframe: '1m', candle_fingerprint: 'f1', candle_event_time_utc: 'x', engine: 'feature', engine_version: '1', status: 'VALID', value: {}, created_at_utc: 'x' });
    log.append({ analysis_run_id: 'run-B', timeframe: '1m', candle_fingerprint: 'f1', candle_event_time_utc: 'x', engine: 'feature', engine_version: '1', status: 'VALID', value: {}, created_at_utc: 'x' });
    expect(log.count('run-A')).toBe(1);
    expect(log.count('run-B')).toBe(1);
  });

  it('filters by timeframe', () => {
    const log = new EngineResultsLog(TEST_DIR);
    log.append({ analysis_run_id: 'r', timeframe: '1m', candle_fingerprint: 'f1', candle_event_time_utc: 'x', engine: 'feature', engine_version: '1', status: 'VALID', value: {}, created_at_utc: 'x' });
    log.append({ analysis_run_id: 'r', timeframe: '5m', candle_fingerprint: 'f2', candle_event_time_utc: 'x', engine: 'feature', engine_version: '1', status: 'VALID', value: {}, created_at_utc: 'x' });
    expect(log.byTimeframe('r', '1m').length).toBe(1);
    expect(log.byTimeframe('r', '5m').length).toBe(1);
  });

  it('filters by engine', () => {
    const log = new EngineResultsLog(TEST_DIR);
    log.append({ analysis_run_id: 'r', timeframe: '1m', candle_fingerprint: 'f', candle_event_time_utc: 'x', engine: 'quality', engine_version: '1', status: 'PASS', value: {}, created_at_utc: 'x' });
    log.append({ analysis_run_id: 'r', timeframe: '1m', candle_fingerprint: 'f', candle_event_time_utc: 'x', engine: 'fusion', engine_version: '1', status: 'RESOLVED', value: {}, created_at_utc: 'x' });
    expect(log.byEngine('r', 'quality').length).toBe(1);
    expect(log.byEngine('r', 'fusion').length).toBe(1);
  });
});