import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { DataQualityEngine } from '../data-quality/engine';
import { DataFusionEngine } from '../data-fusion/engine';
import { FeatureRegistry } from '../feature-engineering/registry';
import { FeatureEngineeringEngine } from '../feature-engineering/engine';
import { makeSma20, makeRsi14, makeAtr14 } from '../feature-engineering/financial';
import { structuralCheck } from '../data-quality/checks/structural';
import { completenessCheck } from '../data-quality/checks/completeness';
import { schemaCheck } from '../data-quality/checks/schema';
import { duplicateCheck } from '../data-quality/checks/duplicate';
import { crossFieldCheck } from '../data-quality/checks/cross-field';
import { TF_MS } from '../multi-timeframe/aggregator';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const T0 = Date.UTC(2025, 0, 1, 0, 0, 0);

function genCandles(n: number, sourceId = 'load-test'): RawDataPoint<Candle>[] {
  const out: RawDataPoint<Candle>[] = [];
  let price = 4000;
  for (let i = 0; i < n; i++) {
    const drift = (Math.random() - 0.5) * 2;
    const open = price;
    const close = price + drift;
    const high = Math.max(open, close) + Math.random();
    const low = Math.min(open, close) - Math.random();
    const ts = T0 + i * 60_000;
    out.push({
      sourceId,
      value: { open, high, low, close, volume: 100 },
      eventTime: new Date(ts).toISOString(),
      closedAt: new Date(ts + 60_000).toISOString(),
      arrivalTime: new Date(ts + 60_000).toISOString(),
      availabilityTime: new Date(ts + 60_000).toISOString(),
      version: 1,
      fingerprint: sourceId + '-' + ts,
    });
    price = close;
  }
  return out;
}

describe('Load Tests (§18)', () => {
  it('DataQuality: processes 1000 candles in < 5s', () => {
    const dq = new DataQualityEngine(
      { engineVersion: '1.0', policyVersion: 'p', configVersion: 'c' },
      [structuralCheck, completenessCheck, schemaCheck, duplicateCheck, crossFieldCheck],
      new HashChainAuditLog(),
    );
    const candles = genCandles(1000);
    const start = Date.now();
    const r = dq.assess({
      dataReference: { snapshotId: 's', contentFingerprint: 'cf', sourceId: 'load-test', range: { from: candles[0]!.eventTime, to: candles[999]!.eventTime } },
      points: candles,
      range: { from: candles[0]!.eventTime, to: candles[999]!.eventTime },
      asOfCutoff: candles[999]!.availabilityTime,
      expectedCadenceMs: 60_000,
      actor: 'load-test',
    });
    const elapsed = Date.now() - start;
    const rate = Math.round(1000 / (elapsed / 1000));
    console.log('[LOAD] DataQuality: ' + elapsed + 'ms for 1000 candles = ' + rate + ' candles/sec');
    expect(elapsed).toBeLessThan(5000);
    expect(r.verdict.overallStatus).toBeDefined();
  }, 10_000);

  it('Fusion: processes 1000 fusions in < 2s', () => {
    const fusion = new DataFusionEngine(new HashChainAuditLog(), '1.0');
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      fusion.fuse(
        [
          { sourceId: 'A', value: { close: 4000 + i }, eventTime: '2025-01-01T00:00:00Z', availabilityTime: '2025-01-01T00:00:00Z', sourceVersion: 1, qualityStatus: 'PASS' },
          { sourceId: 'B', value: { close: 4001 + i }, eventTime: '2025-01-01T00:00:00Z', availabilityTime: '2025-01-01T00:00:00Z', sourceVersion: 1, qualityStatus: 'PASS' },
        ],
        { policyVersion: 'p', priorityOrder: ['A', 'B'], conflictStrategy: 'STRICT_PRIORITY', toleranceBps: 100, allowSourceSwitching: false },
        '2025-01-01T00:00:00Z',
        'load-test',
      );
    }
    const elapsed = Date.now() - start;
    const rate = Math.round(1000 / (elapsed / 1000));
    console.log('[LOAD] Fusion: ' + elapsed + 'ms for 1000 fusions = ' + rate + ' fusions/sec');
    expect(elapsed).toBeLessThan(2000);
  }, 10_000);

  it('Features: computes 1000 SMA/RSI/ATR in < 10s', () => {
    const reg = new FeatureRegistry();
    reg.register(makeSma20('1m', TF_MS['1m']));
    reg.register(makeRsi14('1m', TF_MS['1m']));
    reg.register(makeAtr14('1m', TF_MS['1m']));
    const fe = new FeatureEngineeringEngine(
      reg,
      { engineVersion: '1.0', policyVersion: 'p', configVersion: 'c' },
      new HashChainAuditLog(),
    );
    const candles = genCandles(1100);
    const start = Date.now();
    let computed = 0;
    // كل 20 شمعة → حساب batch صغير
    for (let i = 20; i < 1020; i++) {
      const window = candles.slice(0, i + 1);
      const result = fe.computeBatch({
        requestId: 'r' + i,
        asOfCutoff: window[window.length - 1]!.availabilityTime,
        snapshotRef: { snapshotId: 's', contentFingerprint: 'cf' },
        fusionPolicyVersion: 'p',
        targets: [
          { featureId: 'sma_20_1m', definitionVersion: '1.0.0' },
          { featureId: 'rsi_14_1m', definitionVersion: '1.0.0' },
          { featureId: 'atr_14_1m', definitionVersion: '1.0.0' },
        ],
        inputs: new Map([
          ['sma_20_1m', window],
          ['rsi_14_1m', window],
          ['atr_14_1m', window],
        ]),
        actor: 'load-test',
      });
      if (result.get('sma_20_1m')!.status === 'VALID') computed++;
    }
    const elapsed = Date.now() - start;
    const rate = Math.round(1000 / (elapsed / 1000));
    console.log('[LOAD] Features: ' + elapsed + 'ms for 1000 batches = ' + rate + ' batches/sec, computed=' + computed);
    expect(elapsed).toBeLessThan(10_000);
    expect(computed).toBe(1000);
  }, 15_000);

  it('Full pipeline: 500 candles end-to-end in < 15s', () => {
    const reg = new FeatureRegistry();
    reg.register(makeSma20('1m', TF_MS['1m']));
    reg.register(makeRsi14('1m', TF_MS['1m']));
    reg.register(makeAtr14('1m', TF_MS['1m']));
    const audit = new HashChainAuditLog();
    const dq = new DataQualityEngine(
      { engineVersion: '1.0', policyVersion: 'p', configVersion: 'c' },
      [structuralCheck, completenessCheck, schemaCheck, duplicateCheck, crossFieldCheck],
      audit,
    );
    const fusion = new DataFusionEngine(audit, '1.0');
    const fe = new FeatureEngineeringEngine(reg, { engineVersion: '1.0', policyVersion: 'p', configVersion: 'c' }, audit);

    const candles = genCandles(500);
    const start = Date.now();
    let completed = 0;
    for (let i = 20; i < candles.length; i++) {
      const window = candles.slice(0, i + 1);
      const cutoff = window[window.length - 1]!.availabilityTime;
      dq.assess({
        dataReference: { snapshotId: 's' + i, contentFingerprint: 'cf', sourceId: 'load-test', range: { from: window[0]!.eventTime, to: cutoff } },
        points: window,
        range: { from: window[0]!.eventTime, to: cutoff },
        asOfCutoff: cutoff,
        expectedCadenceMs: 60_000,
        actor: 'load-test',
      });
      const last = window[window.length - 1]!;
      fusion.fuse(
        [{ sourceId: 'load-test', value: { close: last.value.close }, eventTime: last.eventTime, availabilityTime: cutoff, sourceVersion: 1, qualityStatus: 'PASS' }],
        { policyVersion: 'p', priorityOrder: ['load-test'], conflictStrategy: 'STRICT_PRIORITY', toleranceBps: 100, allowSourceSwitching: false },
        cutoff,
        'load-test',
      );
      const r = fe.computeBatch({
        requestId: 'r' + i,
        asOfCutoff: cutoff,
        snapshotRef: { snapshotId: 's' + i, contentFingerprint: 'cf' },
        fusionPolicyVersion: 'p',
        targets: [
          { featureId: 'sma_20_1m', definitionVersion: '1.0.0' },
          { featureId: 'rsi_14_1m', definitionVersion: '1.0.0' },
          { featureId: 'atr_14_1m', definitionVersion: '1.0.0' },
        ],
        inputs: new Map([
          ['sma_20_1m', window],
          ['rsi_14_1m', window],
          ['atr_14_1m', window],
        ]),
        actor: 'load-test',
      });
      if (r.get('sma_20_1m')!.status === 'VALID') completed++;
    }
    const elapsed = Date.now() - start;
    const rate = Math.round(480 / (elapsed / 1000));
    console.log('[LOAD] Full pipeline: ' + elapsed + 'ms for 480 iterations = ' + rate + ' cand/sec, completed=' + completed);
    expect(elapsed).toBeLessThan(15_000);
    expect(completed).toBe(480);
  }, 20_000);
});