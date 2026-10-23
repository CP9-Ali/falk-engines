import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { AggregationSource } from '../multi-timeframe/aggregation-source';
import { TF_MS } from '../multi-timeframe/aggregator';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const M = (s: number) => new Date(s).toISOString();
const c = (s: number, close: number, src = 'twelvedata-ws'): RawDataPoint<Candle> => ({
  sourceId: src,
  value: { open: close, high: close + 1, low: close - 1, close, volume: 0 },
  eventTime: M(s), closedAt: M(s + 60_000),
  arrivalTime: M(s), availabilityTime: M(s),
  version: 1, fingerprint: 'f' + s,
});

describe('AggregationSource (§10)', () => {
  const T0 = Date.UTC(2025, 0, 6, 0, 0, 0);
  const src1m = Array.from({ length: 60 }, (_, i) => c(T0 + i * 60_000, 4015 + Math.sin(i / 10) * 2));

  it('builds 5m from 1m', () => {
    const audit = new HashChainAuditLog();
    const src = new AggregationSource(audit);
    const agg = src.buildAndCompare(src1m, '5m', null, 'test');
    expect(agg.length).toBe(12);
    expect(agg.every(a => a.source_origin === 'aggregated')).toBe(true);
    expect(agg.every(a => a.complete)).toBe(true);
  });

  it('compares with direct source when available', () => {
    const audit = new HashChainAuditLog();
    const src = new AggregationSource(audit);
    // آخر شمعة = أول bucket 5m (T0..T0+5m) — انظر bucket الأول
    const direct = c(T0, 4015); // close قريب من الأول
    const agg = src.buildAndCompare(src1m, '5m', direct, 'test');
    expect(agg[0]!.comparison).toBeDefined();
  });

  it('logs divergence when values differ significantly', () => {
    const audit = new HashChainAuditLog();
    const src = new AggregationSource(audit);
    const direct = c(T0, 9999); // far from aggregated
    src.buildAndCompare(src1m, '5m', direct, 'test');
    const events = audit.readAll().filter(e => e.eventType === 'TF_DIVERGENCE');
    expect(events.length).toBeGreaterThan(0);
  });

  it('mergeWithDirect pairs by timestamp', () => {
    const audit = new HashChainAuditLog();
    const src = new AggregationSource(audit);
    const agg = src.buildAndCompare(src1m, '5m', null, 'test');
    const direct = [c(T0, 4015), c(T0 + 5 * 60_000, 4016)];
    const merged = src.mergeWithDirect(agg, direct);
    expect(merged.length).toBe(12);
    expect(merged[0]!.direct).not.toBeNull();
    expect(merged[1]!.direct).not.toBeNull();
    expect(merged[2]!.direct).toBeNull();
  });
});