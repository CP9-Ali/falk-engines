import { describe, it, expect } from 'vitest';
import { FeatureEngineeringEngine } from '../feature-engineering/engine';
import { makeSma20 } from '../feature-engineering/financial';
import type { FeatureRegistry } from '../feature-engineering/registry';
import type { AuditLog } from '../audit/audit-log';
import type { Candle } from '../data-quality/checks/base';
import type { RawDataPoint } from '../core/types';

function mockRegistry(defs: any[]): FeatureRegistry {
  const map = new Map(defs.map((d) => [d.featureId + '@' + d.definitionVersion, d]));
  return {
    get: (id: string, ver: string) => map.get(id + '@' + ver)!,
    all: () => defs,
    has: (id: string, ver: string) => map.has(id + '@' + ver),
    register: () => {},
    size: () => defs.length,
  } as unknown as FeatureRegistry;
}

function mockAudit(): AuditLog {
  return { append: () => {}, readAll: () => [] } as unknown as AuditLog;
}

// 30 x 1m candles from 00:00 to 00:29, each closes at eventTime + 1min
const points: RawDataPoint<Candle>[] = Array.from({ length: 30 }, (_, i) => {
  const eventTime = new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
  const closeTime = new Date(Date.UTC(2026, 0, 1, 0, i + 1)).toISOString();
  return {
    sourceId: 'test-src',
    value: { open: 2000 + i, high: 2001 + i, low: 1999 + i, close: 2000 + i, volume: 100 },
    eventTime,
    closedAt: closeTime,
    arrivalTime: closeTime,
    availabilityTime: closeTime,
    version: 1,
    fingerprint: 'fp-' + i,
  };
});

const CUTOFF = '2026-01-01T00:30:00Z';

describe('B1 — FeatureMetadata attached to computeBatch results', () => {
  it('VALID feature carries metadata with all §9.1 fields', () => {
    const def = makeSma20('1m', 60_000);
    const engine = new FeatureEngineeringEngine(
      mockRegistry([def]),
      { engineVersion: '1.0', policyVersion: 'p1', configVersion: 'c1' },
      mockAudit(),
    );

    const results = engine.computeBatch({
      requestId: 'req-1',
      asOfCutoff: CUTOFF,
      snapshotRef: { snapshotId: 'snap-1', contentFingerprint: 'fp-1' },
      fusionPolicyVersion: 'p1',
      targets: [{ featureId: def.featureId, definitionVersion: def.definitionVersion }],
      inputs: new Map([[def.featureId, points as any]]),
      actor: 'test',
    });

    const r = results.get(def.featureId)!;
    expect(r.metadata).toBeDefined();
    expect(r.metadata!.feature_id).toBe(def.featureId);
    expect(r.metadata!.feature_version).toBe(def.definitionVersion);
    expect(r.metadata!.timeframe).toBe('1m');
    expect(r.metadata!.unit).toBe('price');
    expect(r.metadata!.data_snapshot_id).toBe('snap-1');
    expect(r.metadata!.parameters_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(r.metadata!.status).toBe('final');
    expect(r.metadata!.lineage.sources).toContain(def.featureId);
    expect(r.metadata!.valid_at_utc).toBe(CUTOFF);
  });

  it('INSUFFICIENT_INPUTS carries status=missing + warning', () => {
    const def = makeSma20('1m', 60_000);
    const engine = new FeatureEngineeringEngine(
      mockRegistry([def]),
      { engineVersion: '1.0', policyVersion: 'p1', configVersion: 'c1' },
      mockAudit(),
    );
    const results = engine.computeBatch({
      requestId: 'req-2',
      asOfCutoff: CUTOFF,
      snapshotRef: { snapshotId: 'snap-2', contentFingerprint: 'fp-2' },
      fusionPolicyVersion: 'p1',
      targets: [{ featureId: def.featureId, definitionVersion: def.definitionVersion }],
      inputs: new Map(),
      actor: 'test',
    });
    const r = results.get(def.featureId)!;
    expect(r.metadata).toBeDefined();
    expect(r.metadata!.status).toBe('missing');
    expect(r.metadata!.value).toBeNull();
    expect(r.metadata!.warnings.length).toBeGreaterThan(0);
  });

  it('reproducibility: same inputs → same metadata hashes', () => {
    const def = makeSma20('1m', 60_000);
    const engine = new FeatureEngineeringEngine(
      mockRegistry([def]),
      { engineVersion: '1.0', policyVersion: 'p1', configVersion: 'c1' },
      mockAudit(),
    );
    const run = () => engine.computeBatch({
      requestId: 'req-r',
      asOfCutoff: CUTOFF,
      snapshotRef: { snapshotId: 'snap-r', contentFingerprint: 'fp-r' },
      fusionPolicyVersion: 'p1',
      targets: [{ featureId: def.featureId, definitionVersion: def.definitionVersion }],
      inputs: new Map([[def.featureId, points as any]]),
      actor: 'test',
    }).get(def.featureId)!;
    expect(run().metadata!.parameters_hash).toBe(run().metadata!.parameters_hash);
  });
});
