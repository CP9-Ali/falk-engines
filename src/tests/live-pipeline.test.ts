import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { AuthorizationService } from '../security/permissions';
import { FeatureRegistry } from '../feature-engineering/registry';
import { simpleReturn1h } from '../feature-engineering/examples';
import { structuralCheck } from '../data-quality/checks/structural';
import { completenessCheck } from '../data-quality/checks/completeness';
import {
  LivePipelineOrchestrator,
  type LivePipelineConfig,
  type LivePipelineDeps,
} from '../integration/live-pipeline';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const T = (m: number) => new Date(Date.UTC(2025, 0, 1, 0, m, 0)).toISOString();
const CLOSED_AT = (m: number) => new Date(Date.UTC(2025, 0, 1, 0, m + 1, 0)).toISOString();

const candle = (m: number, close: number, closed = true): RawDataPoint<Candle> => ({
  sourceId: 'binance',
  value: { open: close, high: close + 1, low: close - 1, close, volume: 10 },
  eventTime: T(m),
  closedAt: CLOSED_AT(m),
  arrivalTime: T(m),
  availabilityTime: CLOSED_AT(m),
  version: 1,
  fingerprint: `binance-${m}-${closed ? 'closed' : 'open'}`,
});

const mkConfig = (): LivePipelineConfig => ({
  symbol: 'binance',
  maxBufferSize: 100,
  minCandlesForFeatures: 2,
  expectedCadenceMs: 60_000,
  actor: { principalId: 'test', roles: ['ANALYST'] },
  fusionPolicy: {
    policyVersion: 'p1',
    priorityOrder: ['binance'],
    conflictStrategy: 'STRICT_PRIORITY',
    toleranceBps: 50,
    allowSourceSwitching: false,
  },
  featureTargets: [{ featureId: 'simple_return_1h', definitionVersion: '1.0.0' }],
});

const mkDeps = (): LivePipelineDeps => {
  const audit = new HashChainAuditLog();
  const registry = new FeatureRegistry();
  registry.register(simpleReturn1h);
  return {
    qualityChecks: [structuralCheck, completenessCheck],
    featureRegistry: registry,
    audit,
    auth: new AuthorizationService(audit),
  };
};

describe('LivePipelineOrchestrator', () => {
  it('WARMING_UP on first candle', async () => {
    const orch = new LivePipelineOrchestrator(mkConfig(), mkDeps());
    const r = await orch.onPoint(candle(0, 100));
    expect(r.status).toBe('WARMING_UP');
    expect(r.candles).toBe(1);
  });

  it('rejects in-progress (open) candles', async () => {
    const orch = new LivePipelineOrchestrator(mkConfig(), mkDeps());
    const r = await orch.onPoint(candle(0, 100, false));
    expect(r.status).toBe('WARMING_UP');
    expect(orch.stats().processedClosedCandles).toBe(0);
  });

  it('executes pipeline once threshold reached', async () => {
    const orch = new LivePipelineOrchestrator(mkConfig(), mkDeps());
    await orch.onPoint(candle(0, 100));
    const r = await orch.onPoint(candle(1, 105));
    expect(r.status).toBe('EXECUTED');
    expect(r.pipelineResult).toBeDefined();
    expect(r.pipelineResult!.finalState).toBe('COMPLETED');
    expect(r.pipelineResult!.features.get('simple_return_1h')!.status).toBe('VALID');
    expect(orch.stats().pipelineRuns).toBe(1);
  });

  it('trims rolling window to maxBufferSize', async () => {
    const orch = new LivePipelineOrchestrator({ ...mkConfig(), maxBufferSize: 3 }, mkDeps());
    for (let i = 0; i < 10; i++) {
      await orch.onPoint(candle(i, 100 + i));
    }
    const s = orch.stats();
    expect(s.candlesInWindow).toBe(3);
    expect(s.pipelineRuns).toBe(9);
  });

  it('loadHistory pre-fills window', async () => {
    const orch = new LivePipelineOrchestrator(mkConfig(), mkDeps());
    orch.loadHistory([candle(0, 100), candle(1, 105)]);
    const r = await orch.onPoint(candle(2, 110));
    expect(r.status).toBe('EXECUTED');
    expect(orch.stats().pipelineRuns).toBe(1);
  });

  it('records ERROR on auth denial', async () => {
    const orch = new LivePipelineOrchestrator(
      { ...mkConfig(), actor: { principalId: 'viewer', roles: ['VIEWER'] } },
      mkDeps(),
    );
    orch.loadHistory([candle(0, 100), candle(1, 105)]);
    const r = await orch.onPoint(candle(2, 110));
    expect(r.status).toBe('ERROR');
    expect(orch.stats().lastError).toContain('denied');
  });

  it('computes correct return across two candles', async () => {
    const orch = new LivePipelineOrchestrator(mkConfig(), mkDeps());
    await orch.onPoint(candle(0, 100));
    const r = await orch.onPoint(candle(1, 110));
    expect(r.status).toBe('EXECUTED');
    const ret = r.pipelineResult!.features.get('simple_return_1h')!.value as number;
    expect(ret).toBeCloseTo(0.10, 6);
  });

  it('accumulates stats across runs', async () => {
    const orch = new LivePipelineOrchestrator(mkConfig(), mkDeps());
    for (let i = 0; i < 5; i++) await orch.onPoint(candle(i, 100 + i));
    const s = orch.stats();
    expect(s.processedClosedCandles).toBe(5);
    expect(s.pipelineRuns).toBe(4);
  });
});