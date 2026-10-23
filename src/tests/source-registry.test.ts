import { describe, it, expect } from 'vitest';
import { SourceRegistry } from '../ingestion/source-registry';

describe('SourceRegistry (§4)', () => {
  it('loads three default sources', () => {
    const reg = new SourceRegistry();
    const ids = reg.all().map(s => s.source_id);
    expect(ids).toContain('twelvedata-ws');
    expect(ids).toContain('binance-paxg');
    expect(ids).toContain('xaus-api');
  });

  it('TwelveData is verified for RSI/ATR', () => {
    const reg = new SourceRegistry();
    const r = reg.validateUse('twelvedata-ws', 'rsi_atr');
    expect(r.allowed).toBe(true);
  });

  it('TwelveData is rejected for volume_profile', () => {
    const reg = new SourceRegistry();
    const r = reg.validateUse('twelvedata-ws', 'volume_profile');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('volume');
  });

  it('Binance PAXG is verified for volume_profile (TICK)', () => {
    const reg = new SourceRegistry();
    const r = reg.validateUse('binance-paxg', 'volume_profile');
    expect(r.allowed).toBe(true);
    expect(r.reason).toContain('TICK');
  });

  it('all sources rejected for delta_cvd (no bid/ask)', () => {
    const reg = new SourceRegistry();
    expect(reg.validateUse('twelvedata-ws', 'delta_cvd').allowed).toBe(false);
    expect(reg.validateUse('binance-paxg', 'delta_cvd').allowed).toBe(false);
  });

  it('unknown source rejected', () => {
    const reg = new SourceRegistry();
    const r = reg.validateUse('nonexistent', 'rsi_atr');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('unknown source');
  });

  it('tracks success resets consecutive_failures', () => {
    const reg = new SourceRegistry();
    reg.markFailure('twelvedata-ws');
    reg.markFailure('twelvedata-ws');
    expect(reg.runtimeStatus('twelvedata-ws').consecutive_failures).toBe(2);
    reg.markSuccess('twelvedata-ws');
    expect(reg.runtimeStatus('twelvedata-ws').consecutive_failures).toBe(0);
    expect(reg.runtimeStatus('twelvedata-ws').last_success_at).not.toBeNull();
  });

  it('5 consecutive failures block the source', () => {
    const reg = new SourceRegistry();
    for (let i = 0; i < 5; i++) reg.markFailure('twelvedata-ws');
    const r = reg.validateUse('twelvedata-ws', 'rsi_atr');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('consecutive failures');
  });

  it('snapshot contains version + runtime', () => {
    const reg = new SourceRegistry();
    const snap = reg.snapshot() as any;
    expect(snap.registry_version).toBe('1.0.0');
    expect(snap.sources.length).toBeGreaterThanOrEqual(3);
    expect(snap.sources[0].runtime).toBeDefined();
  });
});