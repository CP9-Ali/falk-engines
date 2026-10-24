import { HashChainAuditLog } from '../audit/audit-log';
import { DataFusionEngine } from '../data-fusion/engine';
import type { FusionPolicy } from '../data-fusion/types';
import { DataQualityEngine } from '../data-quality/engine';
import { structuralCheck } from '../data-quality/checks/structural';
import { completenessCheck } from '../data-quality/checks/completeness';
import { FeatureEngineeringEngine } from '../feature-engineering/engine';
import { FeatureRegistry } from '../feature-engineering/registry';
import { simpleReturn1h } from '../feature-engineering/examples';
import { Task } from '../orchestration/task';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

export interface ScenarioResult {
  readonly name: string;
  readonly passed: boolean;
  readonly details: string;
}

const policy: FusionPolicy = {
  policyVersion: 'p1',
  priorityOrder: ['primary', 'secondary', 'tertiary'],
  conflictStrategy: 'STRICT_PRIORITY',
  toleranceBps: 50,
  allowSourceSwitching: true,
};

const T = (h: number) => new Date(Date.UTC(2025, 0, 1, h, 0, 0)).toISOString();
const ACTOR = 'scenario-runner';

export function scenario1_outlier(): ScenarioResult {
  const audit = new HashChainAuditLog();
  const fusion = new DataFusionEngine(audit, '1.0');
  const t = T(0);
  const r = fusion.fuse(
    [
      { sourceId: 'primary',   value: { close: 100 },   eventTime: t, availabilityTime: t, sourceVersion: 1, qualityStatus: 'PASS' },
      { sourceId: 'secondary', value: { close: 100.2 }, eventTime: t, availabilityTime: t, sourceVersion: 1, qualityStatus: 'PASS' },
      { sourceId: 'tertiary',  value: { close: 500 },   eventTime: t, availabilityTime: t, sourceVersion: 1, qualityStatus: 'FAIL' },
    ], policy, t, ACTOR,
  );
  const passed = r.fusedValue?.close === 100 && r.droppedSources.length === 1;
  return { name: '1. outlier isolated', passed, details: `fused=${r.fusedValue?.close}, dropped=${r.droppedSources.length}` };
}

export function scenario2_trueJump(): ScenarioResult {
  const audit = new HashChainAuditLog();
  const fusion = new DataFusionEngine(audit, '1.0');
  const t = T(0);
  const r = fusion.fuse(
    [
      { sourceId: 'primary',   value: { close: 120 },   eventTime: t, availabilityTime: t, sourceVersion: 1, qualityStatus: 'PASS' },
      { sourceId: 'secondary', value: { close: 120.1 }, eventTime: t, availabilityTime: t, sourceVersion: 1, qualityStatus: 'PASS' },
      { sourceId: 'tertiary',  value: { close: 119.9 }, eventTime: t, availabilityTime: t, sourceVersion: 1, qualityStatus: 'PASS' },
    ], policy, t, ACTOR,
  );
  const passed = r.fusedValue?.close === 120 && r.conflictStatus !== 'UNRESOLVED_CONFLICT';
  return { name: '2. true price jump', passed, details: `fused=${r.fusedValue?.close}` };
}

export function scenario3_missingCandle(): ScenarioResult {
  const audit = new HashChainAuditLog();
  const dq = new DataQualityEngine(
    { engineVersion: '1.0', policyVersion: 'p1', configVersion: 'c1' },
    [structuralCheck, completenessCheck], audit,
  );
  const pts: RawDataPoint<Candle>[] = [mkCandle(T(0), 100), mkCandle(T(1), 101), mkCandle(T(4), 104)];
  const { verdict, refreshRequests } = dq.assess({
    dataReference: { snapshotId: 's1', contentFingerprint: 'cf1', sourceId: 'primary', range: { from: T(0), to: T(4) } },
    points: pts, range: { from: T(0), to: T(4) }, asOfCutoff: T(4),
    expectedCadenceMs: 60 * 60 * 1000, actor: ACTOR,
  });
  const passed = verdict.overallStatus !== 'PASS' && refreshRequests.length > 0;
  return { name: '3. missing candles', passed, details: `status=${verdict.overallStatus}, refresh=${refreshRequests.length}` };
}

export function scenario4_lateData(): ScenarioResult {
  const audit = new HashChainAuditLog();
  const registry = new FeatureRegistry();
  registry.register(simpleReturn1h);
  const fe = new FeatureEngineeringEngine(
    registry, { engineVersion: '1.0', policyVersion: 'p1', configVersion: 'c1' }, audit,
  );
  const base: RawDataPoint<{ close: number }>[] = [
    { sourceId: 'primary', value: { close: 100 }, eventTime: T(0), closedAt: T(1), arrivalTime: T(1), availabilityTime: T(1), version: 1, fingerprint: 'f1' },
    { sourceId: 'primary', value: { close: 105 }, eventTime: T(1), closedAt: T(2), arrivalTime: T(2), availabilityTime: T(2), version: 1, fingerprint: 'f2' },
  ];
  const v1 = fe.computeBatch({
    requestId: 'r1', asOfCutoff: T(2),
    snapshotRef: { snapshotId: 's1', contentFingerprint: 'cf1' },
    fusionPolicyVersion: 'p1',
    targets: [{ featureId: 'simple_return_1h', definitionVersion: '1.0.0' }],
    inputs: new Map([['simple_return_1h', base]]),
    actor: ACTOR,
  }).get('simple_return_1h')!.value as number;

  const corrected: RawDataPoint<{ close: number }>[] = [
    base[0]!,
    { sourceId: 'primary', value: { close: 110 }, eventTime: T(1), closedAt: T(2), arrivalTime: T(3), availabilityTime: T(3), version: 2, fingerprint: 'f2v2' },
  ];
  const v2 = fe.computeAffected(
    {
      requestId: 'r2', asOfCutoff: T(3),
      snapshotRef: { snapshotId: 's2', contentFingerprint: 'cf2' },
      fusionPolicyVersion: 'p1',
      targets: [{ featureId: 'simple_return_1h', definitionVersion: '1.0.0' }],
      inputs: new Map([['simple_return_1h', corrected]]),
      actor: ACTOR,
    },
    new Set(['simple_return_1h']),
  ).get('simple_return_1h')!.value as number;

  const passed = Math.abs(v1 - 0.05) < 1e-9 && Math.abs(v2 - 0.10) < 1e-9;
  return { name: '4. late correction recompute', passed, details: `v1=${v1}, v2=${v2}` };
}

export function scenario5_engineFailure(): ScenarioResult {
  const audit = new HashChainAuditLog();
  const registry = new FeatureRegistry();
  registry.register(simpleReturn1h);
  registry.register({
    featureId: 'broken_feature', definitionVersion: '1.0.0', timeframe: '1h', minHistoryMs: 0,
    availabilityRule: { requireClosedCandle: true, expectedLagMs: 1000 },
    inputsRequired: [], dependencies: [], unit: 'x', parameters: {}, validationRules: [],
    compute() { throw new Error('simulated crash'); },
  });
  const fe = new FeatureEngineeringEngine(
    registry, { engineVersion: '1.0', policyVersion: 'p1', configVersion: 'c1' }, audit,
  );
  const points: RawDataPoint<{ close: number }>[] = [
    { sourceId: 'primary', value: { close: 100 }, eventTime: T(0), closedAt: T(1), arrivalTime: T(1), availabilityTime: T(1), version: 1, fingerprint: 'a' },
    { sourceId: 'primary', value: { close: 101 }, eventTime: T(1), closedAt: T(2), arrivalTime: T(2), availabilityTime: T(2), version: 1, fingerprint: 'b' },
  ];
  const res = fe.computeBatch({
    requestId: 'r', asOfCutoff: T(2),
    snapshotRef: { snapshotId: 's', contentFingerprint: 'c' },
    fusionPolicyVersion: 'p1',
    targets: [
      { featureId: 'simple_return_1h', definitionVersion: '1.0.0' },
      { featureId: 'broken_feature', definitionVersion: '1.0.0' },
    ],
    inputs: new Map([['simple_return_1h', points], ['broken_feature', points]]),
    actor: ACTOR,
  });
  const independent = res.get('simple_return_1h')!;
  const broken = res.get('broken_feature')!;
  const passed = independent.status === 'VALID' && broken.status === 'COMPUTATION_FAILED';
  return { name: '5. failure isolation', passed, details: `indep=${independent.status}, broken=${broken.status}` };
}

export function scenario6_auditFailure(): ScenarioResult {
  const fragile = {
    count: 0,
    append() { this.count++; if (this.count === 2) throw new Error('audit storage failure'); },
    readAll: () => [],
  };
  const audit = fragile as unknown as HashChainAuditLog;
  const task = new Task('t1', 'r1', audit, ACTOR);
  let observed = false;
  try { task.transition('VALIDATING'); task.transition('PROCESSING'); }
  catch { observed = true; }
  const passed = observed && fragile.count === 2;
  return { name: '6. audit storage failure visible', passed, details: `attempts=${fragile.count}` };
}

export function scenario7_versionChange(): ScenarioResult {
  const registry = new FeatureRegistry();
  registry.register({ ...simpleReturn1h, definitionVersion: '1.0.0' });
  registry.register({ ...simpleReturn1h, definitionVersion: '2.0.0' });
  const v1 = registry.get('simple_return_1h', '1.0.0');
  const v2 = registry.get('simple_return_1h', '2.0.0');
  const passed = v1.definitionVersion === '1.0.0' && v2.definitionVersion === '2.0.0' && v1 !== v2;
  return { name: '7. coexisting feature versions', passed, details: `v1=${v1.definitionVersion}, v2=${v2.definitionVersion}` };
}

export function scenario8_primaryRecovery(): ScenarioResult {
  const audit = new HashChainAuditLog();
  const fusion = new DataFusionEngine(audit, '1.0');
  const t = T(0);
  const duringOutage = fusion.fuse(
    [{ sourceId: 'secondary', value: { close: 100 }, eventTime: t, availabilityTime: t, sourceVersion: 1, qualityStatus: 'PASS' }],
    policy, t, ACTOR,
  );
  const afterRecovery = fusion.fuse(
    [
      { sourceId: 'primary',   value: { close: 100.1 }, eventTime: t, availabilityTime: t, sourceVersion: 1, qualityStatus: 'PASS' },
      { sourceId: 'secondary', value: { close: 100.0 }, eventTime: t, availabilityTime: t, sourceVersion: 1, qualityStatus: 'PASS' },
    ], policy, t, ACTOR,
  );
  const passed = duringOutage.fusedValue?.close === 100
    && afterRecovery.fusedValue?.close === 100.1
    && afterRecovery.provenance[0]!.sourceId === 'primary';
  return { name: '8. primary recovery restores priority', passed, details: `after=${afterRecovery.provenance[0]?.sourceId}` };
}

export function runAllScenarios(): ScenarioResult[] {
  return [
    scenario1_outlier(), scenario2_trueJump(), scenario3_missingCandle(),
    scenario4_lateData(), scenario5_engineFailure(), scenario6_auditFailure(),
    scenario7_versionChange(), scenario8_primaryRecovery(),
  ];
}

function mkCandle(ts: string, close: number): RawDataPoint<Candle> {
  return {
    sourceId: 'primary',
    value: { open: close, high: close + 1, low: close - 1, close, volume: 1000 },
    eventTime: ts, closedAt: ts, arrivalTime: ts, availabilityTime: ts,
    version: 1, fingerprint: ts,
  };
}