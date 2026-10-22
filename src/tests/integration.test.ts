import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { AuthorizationService } from '../security/permissions';
import { FeatureRegistry } from '../feature-engineering/registry';
import { simpleReturn1h } from '../feature-engineering/examples';
import { structuralCheck } from '../data-quality/checks/structural';
import { completenessCheck } from '../data-quality/checks/completeness';
import { runPipeline } from '../integration/pipeline';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const T = (h: number) => new Date(Date.UTC(2025, 0, 1, h)).toISOString();
const candle = (h: number, c: number): RawDataPoint<Candle> => ({
  sourceId: 'p', value: { open: c, high: c + 1, low: c - 1, close: c, volume: 1 },
  eventTime: T(h), closedAt: T(h + 1), arrivalTime: T(h), availabilityTime: T(h),
  version: 1, fingerprint: `f${h}`,
});

describe('§15 Integration — full pipeline', () => {
  it('runs RECEIVED→COMPLETED with all engines', () => {
    const audit = new HashChainAuditLog();
    const auth = new AuthorizationService(audit);
    const reg = new FeatureRegistry(); reg.register(simpleReturn1h);
    const points = [candle(0, 100), candle(1, 105)];
    const result = runPipeline(
      {
        taskId: 't1', requestId: 'r1',
        actor: { principalId: 'analyst1', roles: ['ANALYST'] },
        asOfCutoff: T(2),
        snapshotRef: { snapshotId: 's1', contentFingerprint: 'cf1' },
        sources: [
          { sourceId: 'primary', points },
          { sourceId: 'secondary', points },
        ],
        fusionPolicy: { policyVersion: 'p1', priorityOrder: ['primary','secondary'],
                        conflictStrategy: 'STRICT_PRIORITY', toleranceBps: 50, allowSourceSwitching: true },
        featureTargets: [{ featureId: 'simple_return_1h', definitionVersion: '1.0.0' }],
        featureInputs: new Map([['simple_return_1h', points]]),
      },
      { qualityChecks: [structuralCheck, completenessCheck], featureRegistry: reg, audit, auth },
    );
    expect(result.finalState).toBe('COMPLETED');
    expect(result.fused?.value).toBe(105);
    expect(result.features.get('simple_return_1h')!.status).toBe('VALID');
    expect(result.executionStatus).toBe('SUCCESS');
  });

  it('blocks unauthorized actor', () => {
    const audit = new HashChainAuditLog();
    const auth = new AuthorizationService(audit);
    const reg = new FeatureRegistry(); reg.register(simpleReturn1h);
    const result = runPipeline(
      {
        taskId: 't2', requestId: 'r2',
        actor: { principalId: 'viewer1', roles: ['VIEWER'] },
        asOfCutoff: T(2),
        snapshotRef: { snapshotId: 's1', contentFingerprint: 'cf1' },
        sources: [],
        fusionPolicy: { policyVersion: 'p1', priorityOrder: [], conflictStrategy: 'STRICT_PRIORITY',
                        toleranceBps: 50, allowSourceSwitching: true },
        featureTargets: [], featureInputs: new Map(),
      },
      { qualityChecks: [], featureRegistry: reg, audit, auth },
    );
    expect(result.finalState).toBe('FAILED');
    expect(result.errorMessage).toContain('denied');
  });
});