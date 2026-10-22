import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { DataQualityEngine } from '../data-quality/engine';
import { structuralCheck } from '../data-quality/checks/structural';
import { completenessCheck } from '../data-quality/checks/completeness';
import { makeFreshnessCheck } from '../data-quality/checks/freshness';
import { makeSuitabilityCheck } from '../data-quality/checks/suitability';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const T = (h: number) => new Date(Date.UTC(2025, 0, 1, h)).toISOString();
const mk = (h: number, c: number): RawDataPoint<Candle> => ({
  sourceId: 'p', value: { open: c, high: c + 1, low: c - 1, close: c, volume: 1 },
  eventTime: T(h), closedAt: T(h), arrivalTime: T(h), availabilityTime: T(h),
  version: 1, fingerprint: `f${h}`,
});

describe('DataQualityEngine', () => {
  it('passes clean data', () => {
    const dq = new DataQualityEngine(
      { engineVersion: '1.0', policyVersion: 'p', configVersion: 'c' },
      [structuralCheck, completenessCheck, makeFreshnessCheck({ maxLagMs: 3600_000 }),
       makeSuitabilityCheck({ minLookbackMs: 0, maxGapMs: 3600_000 })],
      new HashChainAuditLog(),
    );
    const { verdict } = dq.assess({
      dataReference: { snapshotId: 's', contentFingerprint: 'c', sourceId: 'p', range: { from: T(0), to: T(2) } },
      points: [mk(0, 100), mk(1, 101), mk(2, 102)],
      range: { from: T(0), to: T(2) }, asOfCutoff: T(2),
      expectedCadenceMs: 3600_000, actor: 'test',
    });
    expect(verdict.overallStatus).toBe('PASS');
    expect(verdict.suitableForTask).toBe(true);
  });

  it('flags structural violation', () => {
    const dq = new DataQualityEngine(
      { engineVersion: '1.0', policyVersion: 'p', configVersion: 'c' },
      [structuralCheck], new HashChainAuditLog(),
    );
    const bad: RawDataPoint<Candle> = { ...mk(0, 100), value: { open: 100, high: 90, low: 110, close: 100, volume: 1 } };
    const { verdict } = dq.assess({
      dataReference: { snapshotId: 's', contentFingerprint: 'c', sourceId: 'p', range: { from: T(0), to: T(0) } },
      points: [bad], range: { from: T(0), to: T(0) }, asOfCutoff: T(0),
      expectedCadenceMs: 3600_000, actor: 'test',
    });
    expect(verdict.overallStatus).toBe('FAIL');
    expect(verdict.suitableForTask).toBe(false);
  });

  it('emits refresh requests for gaps', () => {
    const dq = new DataQualityEngine(
      { engineVersion: '1.0', policyVersion: 'p', configVersion: 'c' },
      [completenessCheck], new HashChainAuditLog(),
    );
    const { refreshRequests } = dq.assess({
      dataReference: { snapshotId: 's', contentFingerprint: 'c', sourceId: 'p', range: { from: T(0), to: T(4) } },
      points: [mk(0, 100), mk(4, 104)],
      range: { from: T(0), to: T(4) }, asOfCutoff: T(4),
      expectedCadenceMs: 3600_000, actor: 'test',
    });
    expect(refreshRequests.length).toBeGreaterThan(0);
  });
});