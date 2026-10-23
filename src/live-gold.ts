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
import { EventIntelligence } from './events/event-intelligence';
import { RunContextStore } from './replay/run-context';
import { HistoryRestorer } from './ingestion/history-restorer';
import { EngineResultsLog } from './replay/engine-results';
import { H3Aggregator } from './ingestion/h3-aggregator';
import { GapFixer } from './ingestion/gap-fixer';
import { ErrorQueue } from './ingestion/error-queue';
import { RateLimitManager } from './ingestion/rate-limiter';
import { AlertManager } from './monitoring/alerts';
import { HealthMonitor } from './monitoring/health-monitor';
import { AlertBridge } from './monitoring/alert-bridge';
import { buildEvidenceSnapshot } from './evidence/evidence-chain';
import type { RawDataPoint } from './core/types';
import type { Candle } from './data-quality/checks/base';
import type { FeatureComputeResult } from './feature-engineering/types';
import { Scheduler } from './ingestion/scheduler';
import { ConnectorManager } from './ingestion/connector-manager';
import { ReferenceFetcher } from './ingestion/reference-fetcher';

const PAXG_SYMBOL = 'paxgusdt';
const PAXG_BINANCE = 'PAXGUSDT';
const PORT = parseInt(process.env.PORT || '3000');
const TD_KEY = process.env.TWELVEDATA_API_KEY || '';

const DISPLAY_TFS = ['1m', '5m', '15m', '1h', 'H3', '4h', '1d', '1w'];
const H3_MS = 3 * 60 * 60 * 1000;
const historiesByTf = new Map<string, RawDataPoint<Candle>[]>();
const paxgHistory: RawDataPoint<Candle>[] = [];
const MAX_HISTORY = 300;
let lastPaxgKlineStart = 0;

for (const tf of TIMEFRAMES) historiesByTf.set(tf.label, []);
historiesByTf.set('H3', []);

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
    case 'H3': return 180;
    case '4h': return 240;
    case '1d': return 1440;
    case '1w': return 10080;
    default: return 1;
  }
}

async function main() {
  console.log('\n=== FALK GOLD Live (8 TF: 1m|5m|15m|1h|H3|4h|1d|1w) ===');
  console.log('   Timeframes: ' + DISPLAY_TFS.join(' | '));
  console.log('   Dashboard:  http://localhost:' + PORT + '\n');

  const dashboard = new DashboardServer(PORT);
  dashboard.start();

  const rawStore = new RawStore();
  const registry = new SourceRegistry();
  const audit = new HashChainAuditLog();
  const auth = new AuthorizationService(audit);
  const aggSource = new AggregationSource(audit);
  const conflictLog = new ConflictLog('.backup/conflicts');
  const engineResults = new EngineResultsLog('.backup/engine-runs');
  const h3Aggregator = new H3Aggregator();
  const errorQueue = new ErrorQueue('.backup/errors');
  const gapFixer = new GapFixer('twelvedata-ws', '1m', 60_000, errorQueue);
  const alertMgr = new AlertManager(audit);
  const healthMon = new HealthMonitor(new RateLimitManager(), errorQueue, ['twelvedata-ws', 'binance-paxg', 'xaus-api']);
  const alertBridge = new AlertBridge(healthMon, alertMgr, 'live-runner', { pollMs: 60_000 });
  // �5: unified connector + reference fetcher
  const connectors = new ConnectorManager();
  // �5: register each source as a Connector
  let tdSource: TwelveDataWsSource | null = null;
  connectors.register({
    source_id: 'twelvedata-ws',
    start: async () => {
      if (!TD_KEY) return;
      tdSource = new TwelveDataWsSource(TD_KEY, 'XAU/USD', TIMEFRAMES, onCandle,
        function (price, ts) { dashboard.broadcast({ type: 'tick', data: { source: 'XAU', price, ts } }); },
        function () { /* health */ });
      await tdSource.start();
    },
    stop: () => { if (tdSource) tdSource.stop(); },
  });
  const referenceFetcher = new ReferenceFetcher();
  referenceFetcher.registerTwelveData();
  referenceFetcher.registerH3();
  await referenceFetcher.fetchBinancePaxg();

  // �5: Scheduler � verify market state before historical fetch
  const scheduler = new Scheduler();
  const schedCheck = scheduler.shouldRun('history-fetch');
  console.log('[SCHEDULER] history-fetch: ' + (schedCheck.should_run ? 'allowed' : 'blocked') + ' (' + schedCheck.reason + ')');
  alertBridge.start();
  // �5.1: GapFixer monitoring (logs detected gaps, no auto-refetch in live mode)
  setInterval(() => {
    const errGaps = gapFixer.detectFromErrors();
    const histPoints = historiesByTf.get('1m') || [];
    const pointGaps = gapFixer.detectFromPoints(histPoints);
    const allGaps = errGaps.concat(pointGaps);
    if (allGaps.length > 0) {
      console.log('[GAPFIXER] ' + allGaps.length + ' gaps detected (errors=' + errGaps.length + ', completeness=' + pointGaps.length + ')');
    }
  }, 5 * 60_000);
  const reg = new FeatureRegistry();

  for (const tf of TIMEFRAMES) {
    reg.register(makeSma20(tf.label, tf.ms));
    reg.register(makeRsi14(tf.label, tf.ms));
    reg.register(makeAtr14(tf.label, tf.ms));
  }
  reg.register(makeSma20('H3', H3_MS));
  reg.register(makeRsi14('H3', H3_MS));
  reg.register(makeAtr14('H3', H3_MS));

  const sink = new LocalFileOffsite('.backup');
  const backup = new BackupManager(
    audit,
    { rpoMs: 60000, rtoMs: 5000, offsiteRequired: true },
    sink,
  );
  setInterval(() => {
    const gaps = gapFixer.detectFromErrors();
    if (gaps.length > 0) {
      gapFixer.fixAll(gaps, async () => []); // ��� ��ء ��� ����� ��� ������ ���
    }
  }, 5 * 60_000);
  const eventIntel = new EventIntelligence({ pollMs: 5 * 60_000, highImpactWindowMs: 30 * 60_000 });
  eventIntel.refreshIfNeeded().catch(() => {});
  const finnhubKey = process.env.FINNHUB_API_KEY || '';
  eventIntel.refreshNewsIfNeeded(finnhubKey).catch(() => {});
  setInterval(() => {
    eventIntel.refreshIfNeeded().catch(() => {});
    eventIntel.refreshNewsIfNeeded(finnhubKey).catch(() => {});
  }, 5 * 60_000);

  const runStore = new RunContextStore('.backup/runs');
  const analysisRunId = RunContextStore.newRunId();
  const settingsSnapshot = {
    timeframes: TIMEFRAMES.map(t => ({ label: t.label, ms: t.ms })),
    display: DISPLAY_TFS,
    fusion_policy_version: 'gold-multitf-v6',
    quality_checks: ['structural', 'completeness', 'schema', 'duplicate', 'cross-field', 'missing', 'timestamp'],
    feature_ids: TIMEFRAMES.flatMap(t => ['sma_20_' + t.label, 'rsi_14_' + t.label, 'atr_14_' + t.label])
      .concat(['sma_20_H3', 'rsi_14_H3', 'atr_14_H3']),
    event_sources: ['forexfactory', 'finnhub'],
    port: PORT,
  };
  runStore.save({
    analysis_run_id: analysisRunId,
    started_at_utc: new Date().toISOString(),
    settings_snapshot: settingsSnapshot,
    versions: { code_version: '1.0.0', schema_version: '1.0', policy_version: 'gold-multitf-v6', config_version: '1.0' },
    feature_definitions: TIMEFRAMES.flatMap(t => [
      { feature_id: 'sma_20_' + t.label, definition_version: '1.0.0', parameters: { period: 20 } },
      { feature_id: 'rsi_14_' + t.label, definition_version: '1.0.0', parameters: { period: 14 } },
      { feature_id: 'atr_14_' + t.label, definition_version: '1.0.0', parameters: { period: 14 } },
    ]).concat([
      { feature_id: 'sma_20_H3', definition_version: '1.0.0', parameters: { period: 20 } },
      { feature_id: 'rsi_14_H3', definition_version: '1.0.0', parameters: { period: 14 } },
      { feature_id: 'atr_14_H3', definition_version: '1.0.0', parameters: { period: 14 } },
    ]),
    settings_hash: RunContextStore.hashSettings(settingsSnapshot),
  });
  console.log('[RUN] analysis_run_id: ' + analysisRunId);

  // ??????? histories ?? raw
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

  // ??????? H3 ????????? ?? 1h
  const restoredH1 = restorer.restore('twelvedata-ws', '1h', 300);
  const h3History = h3Aggregator.restoreFromHistory(restoredH1);
  if (h3History.length > 0) {
    historiesByTf.set('H3', h3History);
    console.log('[RESTORE] H3 (from 1h): ' + h3History.length + ' candles');
    for (const h3 of h3History) {
      dashboard.broadcast({ type: 'candle', timeframe: 'H3', data: { symbol: 'XAU', ...h3 }, status: 'BACKFILL' });
    }
  }

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
      const sessionInfo = classifySession(point.eventTime);
      if (tfLabel === '5m' || tfLabel === '15m' || tfLabel === '1h' || tfLabel === '4h') {
        const oneMinuteHistory = historiesByTf.get('1m') || [];
        if (oneMinuteHistory.length >= 5) {
          const aggCandles = aggSource.buildAndCompare(oneMinuteHistory, tfLabel as any, point, analysisRunId);
          const bucketSize = 60_000 * tfToMult(tfLabel);
          const currentBucketStart = Math.floor(new Date(point.eventTime).getTime() / bucketSize) * bucketSize;
          const agg = aggCandles.find(a => new Date(a.point.eventTime).getTime() === currentBucketStart);
          if (agg && agg.comparison) {
            aggComparison = ' | agg_vs_12d=' + (agg.comparison.matches ? 'OK' : 'DIVERGE(' + agg.comparison.divergence_bps + 'bps)');
          } else if (agg) {
            aggComparison = ' | agg=complete=' + agg.complete;
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

      const evFeatures = eventIntel.computeFeatures({ asOfCutoff: cutoff, eventTimeUtc: point.eventTime });
      dashboard.broadcast({ type: 'feature', timeframe: tfLabel, data: { name: 'news', value: evFeatures.is_high_impact_active ? 1 : 0 } });
      const newsFeatures = eventIntel.computeNewsFeatures({ asOfCutoff: cutoff, eventTimeUtc: point.eventTime });
      const newsLine = newsFeatures.news_count_1h > 0 ? ' | news:' + newsFeatures.news_bias + '(' + newsFeatures.news_count_1h + ')' : '';
      const evLine = evFeatures.is_high_impact_active ? ' | NEWS=active' : (evFeatures.minutes_since_last_high !== null ? ' | last_high=' + evFeatures.minutes_since_last_high + 'm' : '');

      const result = runPipeline({
        taskId: 'live-' + tfLabel + '-' + point.fingerprint,
        requestId: 'req-' + point.fingerprint,
        actor: { principalId: 'system', roles: ['ANALYST'] },
        asOfCutoff: cutoff,
        snapshotRef: { snapshotId: 'live-' + tfLabel, contentFingerprint: point.fingerprint },
        sources,
        fusionPolicy: {
          policyVersion: 'gold-multitf-v6',
          priorityOrder: ['gold-xau', 'binance-paxg'],
          conflictStrategy: 'STRICT_PRIORITY',
          toleranceBps: 100,
          allowSourceSwitching: false,
        },
        featureTargets: [
          { featureId: 'sma_20_' + tfLabel, definitionVersion: '1.0.0' },
          { featureId: 'rsi_14_' + tfLabel, definitionVersion: '1.0.0' },
          { featureId: 'atr_14_' + tfLabel, definitionVersion: '1.0.0' },
        ],
        featureInputs: new Map([
          ['sma_20_' + tfLabel, hist],
          ['rsi_14_' + tfLabel, hist],
          ['atr_14_' + tfLabel, hist],
        ]),
      }, { qualityChecks: [structuralCheck, completenessCheck, schemaCheck, duplicateCheck, crossFieldCheck, missingCheck, timestampCheck], featureRegistry: reg, audit, auth });

      const sma = result.features.get('sma_20_' + tfLabel);
      const rsi = result.features.get('rsi_14_' + tfLabel);
      const atr = result.features.get('atr_14_' + tfLabel);
      const smaVal = typeof sma?.value === 'number' ? sma.value : null;
      const rsiVal = typeof rsi?.value === 'number' ? rsi.value : null;
      const atrVal = typeof atr?.value === 'number' ? atr.value : null;

      // ?13: engine results per candle
      const nowIso = new Date().toISOString();
      engineResults.append({
        analysis_run_id: analysisRunId, timeframe: tfLabel,
        candle_fingerprint: point.fingerprint, candle_event_time_utc: point.eventTime,
        engine: 'quality', engine_version: '1.0.0',
        status: result.qualityAfter?.overallStatus ?? 'UNKNOWN',
        value: { suitable: result.qualityAfter?.suitableForTask ?? false, findings_count: result.qualityAfter?.findings.length ?? 0 },
        created_at_utc: nowIso,
      });
      engineResults.append({
        analysis_run_id: analysisRunId, timeframe: tfLabel,
        candle_fingerprint: point.fingerprint, candle_event_time_utc: point.eventTime,
        engine: 'fusion', engine_version: '1.0.0',
        status: result.fused?.conflictStatus ?? 'NONE',
        value: { fused_value: result.fused?.value ?? null, sources_used: sources.length },
        created_at_utc: nowIso,
      });
      engineResults.append({
        analysis_run_id: analysisRunId, timeframe: tfLabel,
        candle_fingerprint: point.fingerprint, candle_event_time_utc: point.eventTime,
        engine: 'feature', engine_version: '1.0.0',
        status: result.executionStatus,
        value: { sma: smaVal, rsi: rsiVal, atr: atrVal },
        created_at_utc: nowIso,
      });

      dashboard.broadcast({ type: 'candle', timeframe: tfLabel, data: { symbol: 'XAU', ...point }, status: result.executionStatus });
      dashboard.broadcast({ type: 'feature', timeframe: tfLabel, data: { name: 'sma', value: smaVal } });
      dashboard.broadcast({ type: 'feature', timeframe: tfLabel, data: { name: 'rsi', value: rsiVal } });
      dashboard.broadcast({ type: 'feature', timeframe: tfLabel, data: { name: 'atr', value: atrVal } });
      dashboard.broadcast({ type: 'task', timeframe: tfLabel, data: { state: result.finalState, exec: result.executionStatus } });
      dashboard.broadcast({
        type: 'quality', timeframe: tfLabel,
        data: {
          status: result.qualityAfter?.overallStatus ?? (usability.suitable_for.rsi_atr ? 'PASS' : 'FAIL'),
          suitable: result.qualityAfter?.suitableForTask ?? usability.suitable_for.rsi_atr,
          volume_semantics: canonical.volume_semantics,
        },
      });

      if (result.fused) {
        dashboard.broadcast({ type: 'fusion', timeframe: tfLabel, data: { value: result.fused.value, conflict: result.fused.conflictStatus } });
        if (result.fused.conflictStatus !== 'NONE') {
          try {
            conflictLog.record({
              as_of_cutoff: cutoff,
              policy_version: 'gold-multitf-v6',
              stream_key: tfLabel,
              sources: [{ source_id: 'gold-xau', close: point.value.close, weight: 1 }],
              spread_bps: 0,
              resolution: result.fused.conflictStatus as any,
              resolved_by: 'STRICT_PRIORITY',
            });
          } catch { /* ignore */ }
        }
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
          usability: usability,
        }), 'live-runner');
        dashboard.broadcast({ type: 'worm', data: { id: snap.snapshotId, total: sink.count(), last: snap.snapshotId } });
      }

      const logLine =
        '[' + tfLabel + '] C=' + point.value.close.toFixed(2) +
        ' | src=' + canonical.source_symbol + '(' + canonical.volume_semantics + ')' +
        ' | lineage=' + canonical.lineage_id.slice(0, 8) +
        ' | ' + result.executionStatus +
        ' | SMA=' + fmt(sma, 'N/A') +
        ' RSI=' + fmt(rsi, 'N/A') +
        ' ATR=' + fmt(atr, 'N/A') +
        aggComparison + evLine + newsLine;
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

    // H3 aggregation from 1h
    if (tfLabel === '1h') {
      const h3 = h3Aggregator.add(p);
      if (h3) {
        const h3Hist = historiesByTf.get('H3') || [];
        h3Hist.push(h3);
        if (h3Hist.length > MAX_HISTORY) h3Hist.shift();
        historiesByTf.set('H3', h3Hist);
        console.log('[H3] New H3: ' + h3.eventTime + ' close=' + h3.value.close);

        const h3Lineage = rawStore.save({
          source_id: 'h3-aggregated',
          source_symbol: 'XAU/USD-AGG',
          timeframe: 'H3',
          event_time_utc: h3.eventTime,
          fetch_method: 'history',
          fetched_at_utc: new Date().toISOString(),
          payload: {
            kind: 'aggregated-from-1h',
            h3: h3.value,
            source_fingerprint: h3.fingerprint,
            generated_at: new Date().toISOString(),
          },
        });
        if (!isHistory) processCandle('H3', h3, h3Lineage);
      }
    }

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
        payload: rec.rawRow,
      });
      dashboard.broadcast({ type: 'candle', timeframe: '1m', data: { symbol: 'PAXG', ...rec.point }, status: 'BACKFILL' });
    }
    console.log('[PAXG] Loaded ' + hist.length + ' bars');
  } catch (e) {
    console.error('[PAXG] History:', (e as Error).message);
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
              close: parseFloat(k.c), volume: parseFloat(k.v),
            },
            eventTime: new Date(k.t).toISOString(),
            closedAt: new Date(k.T + 1).toISOString(),
            arrivalTime: new Date().toISOString(),
            availabilityTime: new Date(k.T + 1).toISOString(),
            version: 1,
            fingerprint: PAXG_SYMBOL + '-' + k.t,
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
            payload: k,
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
