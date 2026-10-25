import { describe, it, expect, beforeEach } from 'vitest';
import { reportsStore } from '../dashboard/reports-store';
import { createReportsStore } from '../dashboard/reports-store';
import { computeAvailability } from '../multi-timeframe/availability';

// Simulates what live-gold's processCandle does after feature extraction + availability broadcast
function simulateProcessCandle(tfLabel: string, featureResults: any[], nowIso: string) {
  const store = createReportsStore(); // isolated
  // Mirrors B3c logic
  for (const f of featureResults) {
    if (f) store.pushFeature(f);
  }
  const availReport = computeAvailability({
    timeframe: tfLabel,
    open_utc: nowIso,
    now_utc: new Date(Date.parse(nowIso) + 60_000).toISOString(),
    source: tfLabel === 'H3' ? 'derived' : 'source',
  });
  store.pushAvailability(availReport);
  return store;
}

describe('B3c — live-gold push logic mirror', () => {
  it('pushFeature stores 3 features and getFeatureLatest returns last', () => {
    const now = '2026-01-02T10:00:00Z'; // trading day (Thu)
    const features = [
      { featureId: 'sma_20_1m', definitionVersion: '1.0.0', status: 'VALID', value: 4003.5, metadata: { status: 'final' } },
      { featureId: 'rsi_14_1m', definitionVersion: '1.0.0', status: 'VALID', value: 62.3, metadata: { status: 'final' } },
      { featureId: 'atr_14_1m', definitionVersion: '1.0.0', status: 'VALID', value: 1.4, metadata: { status: 'final' } },
    ];
    const store = simulateProcessCandle('1m', features, now);
    expect(store.getFeatureAll().length).toBe(3);
    expect(store.getFeatureLatest()!.result.featureId).toBe('atr_14_1m');
  });

  it('null features are skipped (if guard is missing)', () => {
    const now = '2026-01-02T10:00:00Z';
    const features = [
      { featureId: 'sma_20_1m', definitionVersion: '1.0.0', status: 'VALID', value: 4003.5 },
      null,
      undefined,
    ];
    const store = createReportsStore();
    for (const f of features) {
      if (f) store.pushFeature(f as any);
    }
    expect(store.getFeatureAll().length).toBe(1);
  });

  it('pushAvailability marks 1m as final at close', () => {
    const now = '2026-01-02T10:00:00Z';
    const store = simulateProcessCandle('1m', [], now);
    const a = store.getAvailabilityLatest();
    expect(a).not.toBeNull();
    expect(a!.report.timeframe).toBe('1m');
    expect(a!.report.is_final).toBe(true);       // now_utc = open + 60s = at close
    expect(a!.report.source).toBe('source');
  });

  it('H3 source tagged derived', () => {
    const now = '2026-01-02T09:00:00Z';
    const store = simulateProcessCandle('H3', [], now);
    expect(store.getAvailabilityLatest()!.report.source).toBe('derived');
    expect(store.getAvailabilityLatest()!.report.is_final).toBe(false); // now_utc = +60s, not 3h
  });
});
