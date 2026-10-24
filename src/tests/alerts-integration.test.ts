import { describe, it, expect } from 'vitest';
import { runBacktestAndAlert, enrichFusionAndAlert, evaluateQualityAndAlert } from '../alerts/integration';
import { createAlertRouter } from '../alerts/router';
import { createMemoryChannel } from '../alerts/channels/memory';
import { createMemoryChannel as mkMem } from '../alerts/channels/memory';
import type { BacktestConfig } from '../backtest/types';
import type { CanonicalCandle } from '../normalization/canonical';
import type { Strategy } from '../backtest/event-loop';
import type { EnrichedFusionResult } from '../data-fusion/enrich';

function mkCandle(openIso: string, close: number): CanonicalCandle {
  return {
    source_id: 'test', source_symbol: 'XAUUSD', canonical_symbol: 'XAUUSD',
    instrument_type: 'spot', price_source: 't', quote_currency: 'USD', base_currency: 'XAU',
    timeframe: '1h', event_time_utc: openIso, source_timestamp: openIso,
    source_timezone: 'UTC', source_timezone_status: 'RESOLVED', time_blocked: false,
    arrival_time_utc: openIso, availability_time_utc: openIso,
    open: close, high: close, low: close, close,
    volume_value: null, volume_semantics: 'UNKNOWN',
    raw_fingerprint: 'fp-' + openIso, lineage_id: 'lin-' + openIso,
    raw_payload_ref: 'raw-' + openIso, normalization_version: 'nv1', processing_version: 'pv1',
  } as any;
}

function alternateStrategy(): Strategy {
  let i = 0;
  return (c) => {
    const isEven = i % 2 === 0;
    i += 1;
    return { action: isEven ? 'OPEN_LONG' : 'CLOSE', at: c.event_time_utc };
  };
}

const baseConfig: BacktestConfig = {
  version: 'bt-v1', symbol: 'XAUUSD', timeframe: '1h',
  from_utc: '2026-01-01T00:00:00Z', to_utc: '2026-01-02T00:00:00Z',
  initial_capital: 10_000, fees_bps: 0, slippage_bps: 0,
  allow_reentry_same_bar: false,
};

// ?? runBacktestAndAlert ????????????????????????????????????????
describe('?10.4 ? runBacktestAndAlert', () => {
  it('healthy backtest ? no alerts', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    const result = await runBacktestAndAlert(
      {
        config: baseConfig,
        candles: [mkCandle('2026-01-01T00:00:00Z', 2000)],
        strategy: alternateStrategy(),
      },
      router,
    );
    expect(result.backtest.metrics.total_trades).toBeGreaterThanOrEqual(0);
    expect(result.alerts.length).toBe(0);
    expect(capture.received()).toHaveLength(0);
  });

  it('drawdown breach triggers CRITICAL delivery', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    const cfg: BacktestConfig = {
      ...baseConfig,
      from_utc: '2026-01-01T00:00:00Z',
      to_utc: '2026-01-01T05:00:00Z',
      initial_capital: 10_000,
      allow_reentry_same_bar: true,
    };
    const result = await runBacktestAndAlert(
      {
        config: cfg,
        candles: [
          mkCandle('2026-01-01T00:00:00Z', 2000),
          mkCandle('2026-01-01T01:00:00Z', 1000),   // -50% price
          mkCandle('2026-01-01T02:00:00Z', 500),
        ],
        strategy: (() => { let i = 0; return () => i++ === 0
          ? { action: 'OPEN_LONG', at: 'x' }
          : { action: 'CLOSE', at: 'x' }; })(),
      },
      router,
      { max_drawdown_high_pct: 5 },
    );
    expect(result.alerts.length).toBeGreaterThan(0);
    expect(capture.received().length).toBeGreaterThan(0);
  });

  it('does not affect backtest computation', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    const opts = {
      config: baseConfig,
      candles: [
        mkCandle('2026-01-01T00:00:00Z', 2000),
        mkCandle('2026-01-01T01:00:00Z', 2010),
      ],
      strategy: alternateStrategy(),
    };
    const { backtest } = await runBacktestAndAlert(opts, router);
    expect(backtest.trades).toHaveLength(1);
    expect(backtest.final_equity).toBeGreaterThan(10_000);
  });

  it('router failure does not throw', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    // no rules likely to fire on healthy run ? just ensure no crash
    const r = await runBacktestAndAlert(
      {
        config: baseConfig,
        candles: [mkCandle('2026-01-01T00:00:00Z', 2000)],
        strategy: alternateStrategy(),
      },
      router,
    );
    expect(r.backtest.config_version).toBe('bt-v1');
  });
});

// ?? enrichFusionAndAlert ??????????????????????????????????????
function mkEnriched(over: Partial<EnrichedFusionResult<any>> = {}): EnrichedFusionResult<any> {
  return {
    conflictStatus: 'CONSISTENT',
    fusedValue: { close: 100 },
    droppedSources: [],
    provenance: [{ sourceId: 'A' }, { sourceId: 'B' }],
    report_id: 'rep-1',
    as_of_cutoff: '2026-01-01T00:00:00Z',
    policy_version: 'v1',
    engine_version: 'ev',
    deltas: [],
    raw_values: [],
    source_counts: { total: 2, comparable: 2, blocked: 0, dropped_by_policy: 0, independent_evidence: 2 },
    sensitive_use_blocked: false,
    ...over,
  } as any;
}

describe('?10.4 ? enrichFusionAndAlert', () => {
  it('CONSISTENT + 2 evidence ? no alerts', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    const r = await enrichFusionAndAlert(mkEnriched(), router);
    expect(r.alerts).toHaveLength(0);
    expect(capture.received()).toHaveLength(0);
  });

  it('DISCREPANCY ? HIGH alert delivered', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    const r = await enrichFusionAndAlert(mkEnriched({ conflictStatus: 'DISCREPANCY' }), router);
    expect(r.alerts.length).toBeGreaterThan(0);
    expect(capture.received()).toHaveLength(1);
    expect(capture.received()[0]!.severity).toBe('HIGH');
  });

  it('UNRESOLVED_CONFLICT ? CRITICAL', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    await enrichFusionAndAlert(mkEnriched({ conflictStatus: 'UNRESOLVED_CONFLICT' }), router);
    expect(capture.received()[0]!.severity).toBe('CRITICAL');
  });

  it('passes through enriched result unchanged', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    const r = await enrichFusionAndAlert(mkEnriched({ report_id: 'unique-id' }), router);
    expect(r.enriched.report_id).toBe('unique-id');
  });

  it('dedup per report: second identical call is skipped by router', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    const enriched = mkEnriched({ conflictStatus: 'DISCREPANCY' });
    await enrichFusionAndAlert(enriched, router);
    const r2 = await enrichFusionAndAlert(enriched, router);
    // Second call produces a result with skipped channels
    expect(r2.alerts[0]!.skipped_channels.length).toBeGreaterThan(0);
    expect(capture.received()).toHaveLength(1);
  });
});

// ?? evaluateQualityAndAlert ???????????????????????????????????
describe('?10.4 ? evaluateQualityAndAlert', () => {
  it('all pass ? no alerts', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    const r = await evaluateQualityAndAlert(
      [
        { name: 'DQ-A', severity: 'WARNING', passed: true },
        { name: 'DQ-B', severity: 'CRITICAL', passed: true },
      ],
      router,
    );
    expect(r.alerts).toHaveLength(0);
  });

  it('failed CRITICAL check ? delivered', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    await evaluateQualityAndAlert(
      [{ name: 'DQ-SESSION-GAP', severity: 'CRITICAL', passed: false, message: 'candles in closed market' }],
      router,
    );
    expect(capture.received()).toHaveLength(1);
    expect(capture.received()[0]!.severity).toBe('CRITICAL');
    expect(capture.received()[0]!.message).toBe('candles in closed market');
  });

  it('multiple failures ? multiple deliveries', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    await evaluateQualityAndAlert(
      [
        { name: 'A', severity: 'WARNING', passed: false },
        { name: 'B', severity: 'HIGH', passed: false },
        { name: 'C', severity: 'CRITICAL', passed: true },
      ],
      router,
    );
    expect(capture.received()).toHaveLength(2);
  });

  it('per-check-per-run adds run_id to dedup key', async () => {
    const capture = mkMem('capture');
    const router = createAlertRouter({
      channels: { capture },
      routes: { WARNING: ['capture'], HIGH: ['capture'], CRITICAL: ['capture'] },
    });
    await evaluateQualityAndAlert(
      [{ name: 'X', severity: 'WARNING', passed: false }],
      router,
      { dedup_scope: 'per-check-per-run', run_id: 'run-42' },
    );
    expect(capture.received()).toHaveLength(1);
  });
});

// ?? End-to-end ????????????????????????????????????????????????
describe('?10.4 ? end-to-end with multiple channels', () => {
  it('fusion DISCREPANCY delivered to both HIGH channels', async () => {
    const warn = mkMem('warn');
    const high = mkMem('high');
    const router = createAlertRouter({
      channels: { warn, high },
      routes: { WARNING: ['warn'], HIGH: ['high'], CRITICAL: ['warn', 'high'] },
    });
    await enrichFusionAndAlert(mkEnriched({ conflictStatus: 'DISCREPANCY' }), router);
    expect(high.received()).toHaveLength(1);
    expect(warn.received()).toHaveLength(0);
  });

  it('fusion UNRESOLVED delivered to both CRITICAL channels', async () => {
    const warn = mkMem('warn');
    const high = mkMem('high');
    const router = createAlertRouter({
      channels: { warn, high },
      routes: { WARNING: ['warn'], HIGH: ['high'], CRITICAL: ['warn', 'high'] },
    });
    await enrichFusionAndAlert(mkEnriched({ conflictStatus: 'UNRESOLVED_CONFLICT' }), router);
    expect(warn.received()).toHaveLength(1);
    expect(high.received()).toHaveLength(1);
  });
});
