import WebSocket from 'ws';
import 'dotenv/config';
import { runPipeline } from './integration/pipeline';
import { DataFusionEngine } from './data-fusion/engine';
import { ConflictLog } from './data-fusion/conflict-record';
import { FeatureRegistry } from './feature-engineering/registry';
import { makeSma20, makeRsi14, makeAtr14 } from './feature-engineering/financial';
import { structuralCheck } from './data-quality/checks/structural';
import { completenessCheck } from './data-quality/checks/completeness';
import { schemaCheck } from './data-quality/checks/schema';
import { duplicateCheck } from './data-quality/checks/duplicate';
import { crossFieldCheck } from './data-quality/checks/cross-field';
import { missingCheck } from './data-quality/checks/missing';
import { timestampCheck } from './data-quality/checks/timestamp';
import { HashChainAuditLog } from './audit/audit-log';
import { AuthorizationService } from './security/permissions';
import { LocalFileOffsite, BackupManager } from './backup/backup-manager';
import { DashboardServer } from './dashboard/server';
import { TwelveDataWsSource, TIMEFRAMES, type RawInfo } from './ingestion/twelvedata-ws';
import { loadBinanceHistory } from './ingestion/binance-history';
import { toCanonical, assessUsability, type LineageRef } from './normalization/canonical';
import { RawStore } from './storage/raw-store';
import { SourceRegistry } from './ingestion/source-registry';
import { aggregateCandles, compareTimeframes } from './multi-timeframe/aggregator';
import { AggregationSource } from './multi-timeframe/aggregation-source';
import { classifySession } from './calendar/session-calendar';
import { RunContextStore } from './replay/run-context';
import { EventIntelligence } from './events/event-intelligence';
import type { RawDataPoint } from './core/types';
import type { Candle } from './data-quality/checks/base';
import type { FeatureComputeResult } from './feature-engineering/types';
import { HistoryRestorer } from './ingestion/history-restorer';

const PAXG_SYMBOL = 'paxgusdt';
const PAXG_BINANCE = 'PAXGUSDT';
const PORT = parseInt(process.env.PORT || '3000');
const TD_KEY = process.env.TWELVEDATA_API_KEY || '';

const DISPLAY_TFS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
const historiesByTf = new Map<string, RawDataPoint<Candle>[]>();
const paxgHistory: RawDataPoint<Candle>[] = [];
const MAX_HISTORY = 300;
let lastPaxgKlineStart = 0;

for (const tf of TIMEFRAMES) historiesByTf.set(tf.label, []);

function fmt(r: FeatureComputeResult | undefined, need: string): string {
  if (!r || r.value === null || r.value === undefined) return need;
  return typeof r.value === 'number' ? r.value.toFixed(2) : String(r.value);
}

function filterByCutoff(history: RawDataPoint<Candle>[], cutoff: string): RawDataPoint<Candle>[] {
  const ms = new Date(cutoff).getTime();
  return history.filter(p => new Date(p.availabilityTime).getTime() <= ms);
}

function tfToMult(tf: string): number {
  switch (tf) {
    case '5m': return 5;
    case '15m': return 15;
    case '1h': return 60;
    case '4h': return 240;
    case '1d': return 1440;
    case '1w': return 10080;
    default: return 1;
  }
}

async function main() {
  console.log('\n=== FALK GOLD Live (7 TF + Normalization + Raw Storage + Comparison) ===');
  console.log('   Timeframes: ' + DISPLAY_TFS.join(' | '));
  console.log('   Dashboard:  http://localhost:' + PORT + '\n');

  const dashboard = new DashboardServer(PORT);
  dashboard.start();

  const rawStore = new RawStore();
  const registry = new SourceRegistry();
  const eventIntel = new EventIntelligence({ pollMs: 5 * 60_000, highImpactWindowMs: 30 * 60_000 });
  eventIntel.refreshIfNeeded().catch(() => {});
  const finnhubKey = process.env.FINNHUB_API_KEY || '';
  eventIntel.refreshNewsIfNeeded(finnhubKey).catch(() => {});
  setInterval(() => { eventIntel.refreshIfNeeded().catch(() => {}); eventIntel.refreshNewsIfNeeded(finnhubKey).catch(() => {}); }, 5 * 60_000);
  const audit = new HashChainAuditLog();
  const aggSource = new AggregationSource(audit);
  const conflictLog = new ConflictLog('.backup/conflicts');
  const auth = new AuthorizationService(audit);
  const reg = new FeatureRegistry();
  for (const tf of TIMEFRAMES) {
    reg.register(makeSma20(tf.label, tf.ms));
    reg.register(makeRsi14(tf.label, tf.ms));
    reg.register(makeAtr14(tf.label, tf.ms));
  }
  // ÇÓÊÚÇÏÉ histories ãä raw files ÞÈá ÈÏÁ WebSocket
  const restorer = new HistoryRestorer('.backup/raw');
  for (const tf of TIMEFRAMES) {
    const restored = restorer.restore('twelvedata-ws', tf.label, 200);
    if (restored.length > 0) {
      historiesByTf.set(tf.label, restored);
      console.log('[RESTORE] ' + tf.label + ': ' + restored.length + ' candles');
    }
  }
  const restoredPaxg = restorer.restore('binance-paxg', '1m', 100);
  if (restoredPaxg.length > 0) {
    for (const p of restoredPaxg) paxgHistory.push(p);
    console.log('[RESTORE] binance-paxg/1m: ' + restoredPaxg.length + ' candles');
  }
  // §13: ?????? run context — íÍÝÙ ßá ãÇ íáÒã áÅÚÇÏÉ ÇáÊÔÛíá
  const runStore = new RunContextStore('.backup/runs');
  const analysisRunId = RunContextStore.newRunId();
  const settingsSnapshot = {
    timeframes: TIMEFRAMES.map(t => ({ label: t.label, ms: t.ms })),
    display: DISPLAY_TFS,
    fusion_policy_version: 'gold-multitf-v6',
    quality_checks: ['structural', 'completeness', 'schema', 'duplicate', 'cross-field'],
    feature_ids: TIMEFRAMES.flatMap(t => ['sma_20_' + t.label, 'rsi_14_' + t.label, 'atr_14_' + t.label]),
    event_sources: ['forexfactory', 'finnhub'],
    port: PORT,
  };
  runStore.save({
    analysis_run_id: analysisRunId,
    started_at_utc: new Date().toISOString(),
    settings_snapshot: settingsSnapshot,
    versions: {
      code_version: '1.0.0',
      schema_version: '1.0',
      policy_version: 'gold-multitf-v6',
      config_version: '1.0',
    },
    feature_definitions: TIMEFRAMES.flatMap(t => [
      { feature_id: 'sma_20_' + t.label, definition_version: '1.0.0', parameters: { period: 20 } },
      { feature_id: 'rsi_14_' + t.label, definition_version: '1.0.0', parameters: { period: 14 } },
      { feature_id: 'atr_14_' + t.label, definition_version: '1.0.0', parameters: { period: 14 } },
    ]),
    settings_hash: RunContextStore.hashSettings(settingsSnapshot),
  });
  console.log('[RUN] analysis_run_id: ' + analysisRunId);
  const sink = new LocalFileOffsite('.backup');
  const backup = new BackupManager(audit, { rpoMs: 60000, rtoMs: 5000, offsiteRequired: true }, sink);

  const processCandle = function (tfLabel: string, point: RawDataPoint<Candle>, lineage: LineageRef): void {
    try {
      const cutoff = point.availabilityTime;
      const hist = filterByCutoff(historiesByTf.get(tfLabel) || [], cutoff);
      if (hist.length === 0) return;

      const canonical = toCanonical(point, tfLabel as any, lineage);
      const usability = assessUsability(canonical);

      const useCheck = registry.validateUse(point.sourceId, 'rsi_atr');
      if (!useCheck.allowed) {
        console.warn('[' + tfLabel + '] SKIP - ' + useCheck.reason);
        registry.markFailure(point.sourceId);
        return;
      }
      registry.markSuccess(point.sourceId);

      let aggComparison = '';
      if (tfLabel === '5m' || tfLabel === '15m' || tfLabel === '1h' || tfLabel === '4h') {
        const oneMinuteHistory = historiesByTf.get('1m') || [];
        if (oneMinuteHistory.length >= 5) {
          const aggregated = aggregateCandles(oneMinuteHistory, '1m', tfLabel as any);
          const bucketSize = 60_000 * tfToMult(tfLabel);
          const currentBucketStart = Math.floor(new Date(point.eventTime).getTime() / bucketSize) * bucketSize;
          const aggPoint = aggregated.find(a => new Date(a.point.eventTime).getTime() === currentBucketStart);

          if (aggPoint && aggPoint.complete) {
            const cmp = compareTimeframes(aggPoint.point, point, 100);
            aggComparison = ' | agg_vs_12d=' + (cmp.matches ? 'OK' : 'DIVERGE(' + cmp.divergence_bps + 'bps)');
            if (!cmp.matches) {
              dashboard.broadcast({
                type: 'error',
                timeframe: tfLabel,
                data: { message: 'TF divergence: ' + tfLabel + ' vs 1m-aggregated = ' + cmp.divergence_bps + ' bps' },
              });
            }
          }
        }
      }

      const sources: Array<{ sourceId: string; points: RawDataPoint<Candle>[] }> = [
        { sourceId: 'gold-xau', points: hist }
      ];
      if (tfLabel === '1m' && paxgHistory.length > 0) {
        const filtered = filterByCutoff(paxgHistory, cutoff);
        if (filtered.length > 0) sources.push({ sourceId: 'binance-paxg', points: filtered });
      }

      const result = runPipeline({
        taskId: 'live-' + tfLabel + '-' + point.fingerprint,
        requestId: 'req-' + point.fingerprint,
        actor: { principalId: 'system', roles: ['ANALYST'] },
        asOfCutoff: cutoff,
        snapshotRef: { snapshotId: 'live-' + tfLabel, contentFingerprint: point.fingerprint },
        sources: sources,
        fusionPolicy: {
          policyVersion: 'gold-multitf-v6',
          priorityOrder: ['gold-xau', 'binance-paxg'],
          conflictStrategy: 'STRICT_PRIORITY',
          toleranceBps: 100,
          allowSourceSwitching: false
        },
        featureTargets: [
          { featureId: 'sma_20_' + tfLabel, definitionVersion: '1.0.0' },
          { featureId: 'rsi_14_' + tfLabel, definitionVersion: '1.0.0' },
          { featureId: 'atr_14_' + tfLabel, definitionVersion: '1.0.0' }
        ],
        featureInputs: new Map([
          ['sma_20_' + tfLabel, hist],
          ['rsi_14_' + tfLabel, hist],
          ['atr_14_' + tfLabel, hist]
        ])
      }, { qualityChecks: [structuralCheck, completenessCheck, schemaCheck, duplicateCheck, crossFieldCheck, missingCheck, timestampCheck], featureRegistry: reg, audit: audit, auth: auth });

      const sma = result.features.get('sma_20_' + tfLabel);
      const rsi = result.features.get('rsi_14_' + tfLabel);
      const atr = result.features.get('atr_14_' + tfLabel);
      const smaVal = typeof sma?.value === 'number' ? sma.value : null;
      const rsiVal = typeof rsi?.value === 'number' ? rsi.value : null;
      const atrVal = typeof atr?.value === 'number' ? atr.value : null;

      dashboard.broadcast({ type: 'candle', timeframe: tfLabel, data: { symbol: 'XAU', ...point }, status: result.executionStatus });
      dashboard.broadcast({ type: 'feature', timeframe: tfLabel, data: { name: 'sma', value: smaVal } });
      dashboard.broadcast({ type: 'feature', timeframe: tfLabel, data: { name: 'rsi', value: rsiVal } });
      dashboard.broadcast({ type: 'feature', timeframe: tfLabel, data: { name: 'atr', value: atrVal } });
      dashboard.broadcast({ type: 'task', timeframe: tfLabel, data: { state: result.finalState, exec: result.executionStatus } });

      dashboard.broadcast({
        type: 'quality',
        timeframe: tfLabel,
        data: {
          status: result.qualityAfter?.overallStatus ?? (usability.suitable_for.rsi_atr ? 'PASS' : 'FAIL'),
          suitable: result.qualityAfter?.suitableForTask ?? usability.suitable_for.rsi_atr,
          volume_semantics: canonical.volume_semantics
        }
      });

      if (result.fused) {
        dashboard.broadcast({ type: 'fusion', timeframe: tfLabel, data: { value: result.fused.value, conflict: result.fused.conflictStatus } });
      }

      if (result.fused) {
        try {
          const frep = new DataFusionEngine(audit, '1.0').buildReport({
            fusedValue: result.fused.value !== null ? { close: result.fused.value } : null,
            conflictStatus: result.fused.conflictStatus as any,
            provenance: [],
            droppedSources: [],
            asOfCutoff: cutoff,
            policyVersion: 'gold-multitf-v6',
          }, {
            policyVersion: 'gold-multitf-v6',
            priorityOrder: ['gold-xau', 'binance-paxg'],
            conflictStrategy: 'STRICT_PRIORITY',
            toleranceBps: 100,
            allowSourceSwitching: false,
          });
          backup.takeSnapshot('INCREMENTAL', JSON.stringify({ kind: 'fusion-report', timeframe: tfLabel, report: frep }), 'fusion-reporter');
        } catch { /* ignore */ }
      }

      if (tfLabel === '1m' || tfLabel === '15m' || tfLabel === '1h') {
        const snap = backup.takeSnapshot('INCREMENTAL', JSON.stringify({
          timeframe: tfLabel,
          canonical: canonical,
          features: { sma20: smaVal, rsi14: rsiVal, atr14: atrVal },
          executionStatus: result.executionStatus,
          usability: usability
        }), 'live-runner');
        dashboard.broadcast({ type: 'worm', data: { id: snap.snapshotId, total: sink.count(), last: snap.snapshotId } });
      }

      const evFeatures = eventIntel.computeFeatures({ asOfCutoff: cutoff, eventTimeUtc: point.eventTime });
      dashboard.broadcast({ type: 'feature', timeframe: tfLabel, data: { name: 'news', value: evFeatures.is_high_impact_active ? 1 : 0 } });
      const newsFeatures = eventIntel.computeNewsFeatures({ asOfCutoff: cutoff, eventTimeUtc: point.eventTime });
      const newsLine = newsFeatures.news_count_1h > 0
        ? ' | news:' + newsFeatures.news_bias + '(' + newsFeatures.news_count_1h + ')'
        : '';
      const evLine = evFeatures.is_high_impact_active ? ' | NEWS=active' : (evFeatures.minutes_since_last_high !== null ? ' | last_high=' + evFeatures.minutes_since_last_high + 'm' : '');

      const logLine =
        '[' + tfLabel + '] C=' + point.value.close.toFixed(2) +
        ' | src=' + canonical.source_symbol + '(' + canonical.volume_semantics + ')' +
        ' | lineage=' + canonical.lineage_id.slice(0, 8) +
        ' | ' + result.executionStatus +
        ' | SMA=' + fmt(sma, 'N/A') +
        ' RSI=' + fmt(rsi, 'N/A') +
        ' ATR=' + fmt(atr, 'N/A') +
        aggComparison;
      console.log(logLine);
    } catch (e) {
      console.error('[ERROR ' + tfLabel + ']', (e as Error).message);
    }
  };

  const onCandle = function (tfLabel: string, p: RawDataPoint<Candle>, isHistory: boolean, rawInfo: RawInfo): void {
    const hist = historiesByTf.get(tfLabel) || [];
    hist.push(p);
    if (hist.length > MAX_HISTORY) hist.shift();
    historiesByTf.set(tfLabel, hist);

    if (isHistory) {
      dashboard.broadcast({ type: 'candle', timeframe: tfLabel, data: { symbol: 'XAU', ...p }, status: 'BACKFILL' });
      return;
    }
    processCandle(tfLabel, p, rawInfo.lineage);
  };

  try {
    console.log('[PAXG] Loading 100 bars (1m backup)...');
    const hist = await loadBinanceHistory(PAXG_BINANCE, 100);
    for (const rec of hist) {
      paxgHistory.push(rec.point);
      rawStore.save({
        source_id: 'binance-paxg',
        source_symbol: PAXG_BINANCE,
        timeframe: '1m',
        event_time_utc: rec.point.eventTime,
        fetch_method: 'history',
        fetched_at_utc: new Date().toISOString(),
        payload: rec.rawRow
      });
      dashboard.broadcast({ type: 'candle', timeframe: '1m', data: { symbol: 'PAXG', ...rec.point }, status: 'BACKFILL' });
    }
    console.log('[PAXG] Loaded ' + hist.length + ' bars');
  } catch (e) {
    console.error('[PAXG] History:', (e as Error).message);
  }

  if (TD_KEY) {
    const td = new TwelveDataWsSource(
      TD_KEY, 'XAU/USD', TIMEFRAMES,
      onCandle,
      function (price, ts) { dashboard.broadcast({ type: 'tick', data: { source: 'XAU', price: price, ts: ts } }); },
      function () { /* health */ }
    );
    await td.start();
    process.on('SIGINT', function () { td.stop(); });
  } else {
    console.warn('[TD] No TWELVEDATA_API_KEY');
  }

  const url = 'wss://stream.binance.com:9443/stream?streams=' + PAXG_SYMBOL + '@kline_1m/' + PAXG_SYMBOL + '@ticker';
  const connect = function (): void {
    const ws = new WebSocket(url);
    let pingTimer: NodeJS.Timeout | null = null;
    ws.on('open', function () {
      console.log('[WS] PAXG connected');
      pingTimer = setInterval(function () { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 30000);
    });
    ws.on('message', function (data: WebSocket.RawData) {
      try {
        const msg = JSON.parse(data.toString());
        if (!msg.stream || !msg.data) return;
        if (msg.stream.endsWith('@ticker')) {
          const price = parseFloat(msg.data.c);
          if (Number.isFinite(price)) dashboard.broadcast({ type: 'tick', data: { source: 'PAXG', price: price, ts: new Date().toISOString() } });
          return;
        }
        if (msg.stream.indexOf('@kline_') >= 0) {
          const k = msg.data.k;
          if (!k || !k.x) return;
          if (k.t <= lastPaxgKlineStart) return;
          lastPaxgKlineStart = k.t;
          const p: RawDataPoint<Candle> = {
            sourceId: 'binance-paxg',
            value: {
              open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l),
              close: parseFloat(k.c), volume: parseFloat(k.v)
            },
            eventTime: new Date(k.t).toISOString(),
            closedAt: new Date(k.T + 1).toISOString(),
            arrivalTime: new Date().toISOString(),
            availabilityTime: new Date(k.T + 1).toISOString(),
            version: 1,
            fingerprint: PAXG_SYMBOL + '-' + k.t
          };
          paxgHistory.push(p);
          if (paxgHistory.length > MAX_HISTORY) paxgHistory.shift();
          rawStore.save({
            source_id: 'binance-paxg',
            source_symbol: PAXG_BINANCE,
            timeframe: '1m',
            event_time_utc: p.eventTime,
            fetch_method: 'live-kline',
            fetched_at_utc: new Date().toISOString(),
            payload: k
          });
        }
      } catch (e) {
        console.warn('[WS] parse:', (e as Error).message);
      }
    });
    ws.on('close', function () {
      if (pingTimer) clearInterval(pingTimer);
      console.warn('[WS] PAXG closed, reconnect in 5s');
      setTimeout(connect, 5000);
    });
    ws.on('error', function (e) { console.error('[WS] PAXG:', e.message); });
  };
  connect();

  process.on('SIGINT', function () {
    console.log('\n[SHUTDOWN]');
    dashboard.stop();
    process.exit(0);
  });
}

main().catch(console.error);