import { describe, it, expect } from 'vitest';
import { compareEngineResults } from '../replay/comparator';
import type { EngineResultEntry } from '../replay/engine-results';

function mk(id: string, tf: string, fp: string, engine: 'feature' | 'quality' | 'fusion' | 'multi_tf', status: string, value: Record<string, unknown>): EngineResultEntry {
  return {
    analysis_run_id: id,
    timeframe: tf,
    candle_fingerprint: fp,
    candle_event_time_utc: '2025-01-01T00:00:00Z',
    engine,
    engine_version: '1.0.0',
    status,
    value,
    created_at_utc: '2025-01-01T00:00:01Z',
  };
}

describe('Replay Comparator (§13)', () => {
  it('identical runs match 100%', () => {
    const old = [mk('old', '1m', 'f1', 'feature', 'VALID', { sma: 4000, rsi: 50 })];
    const neu = [mk('new', '1m', 'f1', 'feature', 'VALID', { sma: 4000, rsi: 50 })];
    const r = compareEngineResults('old', old, 'new', neu);
    expect(r.match_rate).toBe(1);
    expect(r.divergences).toBe(0);
  });

  it('detects value drift', () => {
    const old = [mk('old', '1m', 'f1', 'feature', 'VALID', { sma: 4000, rsi: 50 })];
    const neu = [mk('new', '1m', 'f1', 'feature', 'VALID', { sma: 4005, rsi: 55 })];
    const r = compareEngineResults('old', old, 'new', neu);
    expect(r.divergences).toBe(1);
    expect(r.match_rate).toBe(0);
    expect(r.rows[0]!.drift_reason).toBe('value drift');
  });

  it('detects status change', () => {
    const old = [mk('old', '1m', 'f1', 'feature', 'VALID', { sma: 4000 })];
    const neu = [mk('new', '1m', 'f1', 'feature', 'INSUFFICIENT_INPUTS', {})];
    const r = compareEngineResults('old', old, 'new', neu);
    expect(r.rows[0]!.drift_reason).toBe('status changed');
  });

  it('empty old returns 0 entries', () => {
    const r = compareEngineResults('old', [], 'new', [mk('new', '1m', 'f1', 'feature', 'VALID', {})]);
    expect(r.total_entries).toBe(0);
    expect(r.match_rate).toBe(0);
  });
});