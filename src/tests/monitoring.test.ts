import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { AlertManager } from '../monitoring/alerts';
import { MetricsRegistry } from '../monitoring/metrics';

describe('§9 Monitoring & Alerts', () => {
  it('distinguishes alert levels', () => {
    const am = new AlertManager(new HashChainAuditLog());
    am.raise('INFO', 'cat', 'msg', 'k1', 'test');
    am.raise('CRITICAL', 'cat', 'msg', 'k2', 'test');
    expect(am.byLevel('INFO').length).toBe(1);
    expect(am.byLevel('CRITICAL').length).toBe(1);
  });

  it('deduplicates by key within window', () => {
    const am = new AlertManager(new HashChainAuditLog());
    am.raise('HIGH', 'dq', 'gap', 'gap:2025', 'test');
    const a2 = am.raise('HIGH', 'dq', 'gap again', 'gap:2025', 'test');
    expect(a2.count).toBe(2);
    expect(am.active().length).toBe(1);
  });

  it('resolves alerts', () => {
    const am = new AlertManager(new HashChainAuditLog());
    am.raise('HIGH', 'cat', 'm', 'k', 'test');
    am.resolve('k');
    expect(am.active().length).toBe(0);
  });

  it('metrics counters and histograms', () => {
    const m = new MetricsRegistry();
    m.increment('a'); m.increment('a', 3);
    m.observe('h', 10); m.observe('h', 20); m.observe('h', 30);
    const snap = m.snapshot();
    expect(snap.counters.a).toBe(4);
    expect(snap.histograms.h!.count).toBe(3);
    expect(snap.histograms.h!.min).toBe(10);
    expect(snap.histograms.h!.max).toBe(30);
    expect(snap.histograms.h!.mean).toBe(20);
  });
});