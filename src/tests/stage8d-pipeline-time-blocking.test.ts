import { describe, it, expect } from 'vitest';
import { runPipeline } from '../integration/pipeline';
import { HashChainAuditLog } from '../audit/audit-log';
import { AuthorizationService } from '../security/permissions';
import { FeatureRegistry } from '../feature-engineering/registry';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const CUTOFF = '2025-01-06T10:00:00.000Z';
const ACTOR = { principalId: 'admin', roles: ['ANALYST'] as const };

function mkPoints(sourceId: string): RawDataPoint<Candle>[] {
  return [
    {
      sourceId,
      value: { open: 100, high: 101, low: 99, close: 100, volume: 10 },
      eventTime: '2025-01-06T09:59:00.000Z',
      closedAt: CUTOFF,
      arrivalTime: '2025-01-06T09:59:00.000Z',
      availabilityTime: CUTOFF,
      version: 1,
      fingerprint: 'fp-' + sourceId,
    },
  ];
}

const fusionPolicy = {
  policyVersion: 'p',
  priorityOrder: [],
  conflictStrategy: 'STRICT_PRIORITY' as const,
  toleranceBps: 50,
  allowSourceSwitching: false,
};

function setup() {
  const audit = new HashChainAuditLog();
  const auth = new AuthorizationService(audit);
  return { audit, auth, featureRegistry: new FeatureRegistry() };
}

function runOne(
  sourceId: string,
  deps: ReturnType<typeof setup>,
  enforceTimeBlocking?: boolean,
) {
  return runPipeline(
    {
      taskId: 'T-' + sourceId, requestId: 'R-' + sourceId,
      actor: ACTOR,
      asOfCutoff: CUTOFF,
      snapshotRef: { snapshotId: 'S-' + sourceId, contentFingerprint: 'CF-' + sourceId },
      sources: [{ sourceId, points: mkPoints(sourceId) }],
      fusionPolicy,
      featureTargets: [],
      featureInputs: new Map(),
    },
    enforceTimeBlocking === undefined
      ? { qualityChecks: [], featureRegistry: deps.featureRegistry, audit: deps.audit, auth: deps.auth }
      : { qualityChecks: [], featureRegistry: deps.featureRegistry, audit: deps.audit, auth: deps.auth, enforceTimeBlocking },
  );
}

function hasTimeBlockedEvent(audit: HashChainAuditLog): boolean {
  return audit.readAll().some(e => e.eventType === 'FUSION_TIME_BLOCKED');
}

describe('Stage 8D — pipeline enforceTimeBlocking flag', () => {
  it('flag off (default): unknown sourceId → no FUSION_TIME_BLOCKED event', () => {
    const deps = setup();
    runOne('some-unknown-source', deps);
    expect(hasTimeBlockedEvent(deps.audit)).toBe(false);
  });

  it('flag on: unknown sourceId → FUSION_TIME_BLOCKED event emitted', () => {
    const deps = setup();
    runOne('some-unknown-source', deps, true);
    expect(hasTimeBlockedEvent(deps.audit)).toBe(true);
  });

  it('flag on: known sourceId (binance-paxg) → no FUSION_TIME_BLOCKED event', () => {
    const deps = setup();
    runOne('binance-paxg', deps, true);
    expect(hasTimeBlockedEvent(deps.audit)).toBe(false);
  });

  it('FUSION_TIME_BLOCKED event names the blocked source', () => {
    const deps = setup();
    runOne('some-unknown-source', deps, true);
    const ev = deps.audit.readAll().find(e => e.eventType === 'FUSION_TIME_BLOCKED');
    expect(ev).toBeDefined();
    const payload = ev!.payload as { blockedSources?: string[] };
    expect(payload.blockedSources).toEqual(['some-unknown-source']);
  });
});
