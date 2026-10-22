import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { FeatureEngineeringEngine } from '../feature-engineering/engine';
import { FeatureRegistry } from '../feature-engineering/registry';
import { simpleReturn1h } from '../feature-engineering/examples';
import { LookaheadGuard } from '../core/time';
import type { RawDataPoint } from '../core/types';

const T = (h: number) => new Date(Date.UTC(2025, 0, 1, h)).toISOString();
const pt = (h: number, c: number, avail?: number): RawDataPoint<{ close: number }> => ({
  sourceId: 'p', value: { close: c }, eventTime: T(h), closedAt: T(h + 1),
  arrivalTime: T(h), availabilityTime: T(avail ?? h), version: 1, fingerprint: `f${h}`,
});

describe('LookaheadGuard', () => {
  it('rejects unavailable points', () => {
    expect(() => new LookaheadGuard(T(1)).assertNoLeak([pt(0, 100, 5)])).toThrow();
  });
  it('accepts available points', () => {
    expect(() => new LookaheadGuard(T(5)).assertNoLeak([pt(0, 100)])).not.toThrow();
  });
});

describe('FeatureEngineeringEngine', () => {
  it('computes simple return', () => {
    const reg = new FeatureRegistry(); reg.register(simpleReturn1h);
    const fe = new FeatureEngineeringEngine(reg,
      { engineVersion: '1.0', policyVersion: 'p', configVersion: 'c' }, new HashChainAuditLog());
    const res = fe.computeBatch({
      requestId: 'r', asOfCutoff: T(2),
      snapshotRef: { snapshotId: 's', contentFingerprint: 'c' },
      fusionPolicyVersion: 'p',
      targets: [{ featureId: 'simple_return_1h', definitionVersion: '1.0.0' }],
      inputs: new Map([['simple_return_1h', [pt(0, 100), pt(1, 105)]]]),
      actor: 'test',
    });
    const r = res.get('simple_return_1h')!;
    expect(r.status).toBe('VALID');
    expect(r.value).toBeCloseTo(0.05, 6);
  });

  it('returns INSUFFICIENT_INPUTS when data sparse', () => {
    const reg = new FeatureRegistry(); reg.register(simpleReturn1h);
    const fe = new FeatureEngineeringEngine(reg,
      { engineVersion: '1.0', policyVersion: 'p', configVersion: 'c' }, new HashChainAuditLog());
    const res = fe.computeBatch({
      requestId: 'r', asOfCutoff: T(1),
      snapshotRef: { snapshotId: 's', contentFingerprint: 'c' },
      fusionPolicyVersion: 'p',
      targets: [{ featureId: 'simple_return_1h', definitionVersion: '1.0.0' }],
      inputs: new Map([['simple_return_1h', [pt(0, 100)]]]),
      actor: 'test',
    });
    expect(res.get('simple_return_1h')!.status).toBe('INSUFFICIENT_INPUTS');
  });
});