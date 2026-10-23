import WebSocket from 'ws';
import 'dotenv/config';
import { runPipeline } from './integration/pipeline';
import { FeatureRegistry } from './feature-engineering/registry';
import { makeSma20, makeRsi14, makeAtr14 } from './feature-engineering/financial';
import { structuralCheck } from './data-quality/checks/structural';
import { completenessCheck } from './data-quality/checks/completeness';
import { HashChainAuditLog } from './audit/audit-log';
import { AuthorizationService } from './security/permissions';
import { LocalFileOffsite, BackupManager } from './backup/backup-manager';
import { DashboardServer } from './dashboard/server';
import { TwelveDataWsSource, TIMEFRAMES, type RawInfo } from './ingestion/twelvedata-ws';
import { loadBinanceHistory } from './ingestion/binance-history';
import { toCanonical, assessUsability, type LineageRef } from './normalization/canonical';
import { RawStore } from './storage/raw-store';
import type { RawDataPoint } from './core/types';
import type { Candle } from './data-quality/checks/base';
import type { FeatureComputeResult } from './feature-engineering/types';

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

async function main() {
  console.log('\n=== FALK GOLD Live (7 TF + Normalization + Raw Storage) ===');
  console.log('   Timeframes: ' + DISPLAY_TFS.join(' | '));
  console.log('   Dashboard:  http://localhost:' + PORT + '\n');

  const dashboard = new DashboardServer(PORT);
  dashboard.start();

  const rawStore = new RawStore();
  const audit = new HashChainAuditLog();
  const auth = new AuthorizationService(audit);
  const reg = new FeatureRegistry();
  for (const tf of TIMEFRAMES) {
    reg.register(makeSma20(tf.label, tf.ms));
    reg.register(makeRsi14(tf.label, tf.ms));
    reg.register(makeAtr14(tf.label, tf.ms));
  }

  const sink = new LocalFileOffsite('.backup');
  const backup = new BackupManager(audit, { rpoMs: 60000, rtoMs: 5000, offsiteRequired: true }, sink);

  const processCandle = function (tfLabel: string, point: RawDataPoint<Candle>, lineage: LineageRef): void {
    try {
      const cutoff = point.availabilityTime;
      const hist = filterByCutoff(historiesByTf.get(tfLabel) || [], cutoff);
      if (hist.length === 0) return;

      const canonical = toCanonical(point, tfLabel as any, lineage);
      const usability = assessUsability(canonical);

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
        sources,
        fusionPolicy: {
          policyVersion: 'gold-multitf-v5',
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
      }, { qualityChecks: [structuralCheck, completenessCheck], featureRegistry: reg, audit, auth });

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
          volume_semantics: canonical.volume_semantics,
        },
      });

      if (result.fused) {
        dashboard.broadcast({ type: 'fusion', timeframe: tfLabel, data: { value: result.fused.value, conflict: result.fused.conflictStatus } });
      }

      if (tfLabel === '1m' || tfLabel === '15m' || tfLabel === '1h') {
        const snap = backup.takeSnapshot('INCREMENTAL', JSON.stringify({
          timeframe: tfLabel,
          canonical,
          features: { sma20: smaVal, rsi14: rsiVal, atr14: atrVal },
          executionStatus: result.executionStatus,
          usability,
        }), 'live-runner');
        dashboard.broadcast({ type: 'worm', data: { id: snap.snapshotId, total: sink.count(), last: snap.snapshotId } });
      }

      console.log('[' + tfLabel + '] C=' + point.value.close.toFixed(2) +
        ' | src=' + canonical.source_symbol + '(' + canonical.volume_semantics + ')' +
        ' | lineage=' + canonical.lineage_id.slice(0, 8) +
        ' | ' + result.executionStatus +
        ' | SMA=' + fmt(sma, 'N/A') + ' RSI=' + fmt(rsi, 'N/A') + ' ATR=' + fmt(atr, 'N/A'));
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
        payload: rec.rawRow,
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
      (price, ts) => { dashboard.broadcast({ type: 'tick', data: { source: 'XAU', price, ts } }); },
      () => {},
    );
    await td.start();
    process.on('SIGINT', () => { td.stop(); });
  } else {
    console.warn('[TD] No TWELVEDATA_API_KEY');
  }

  const url = 'wss://stream.binance.com:9443/stream?streams=' + PAXG_SYMBOL + '@kline_1m/' + PAXG_SYMBOL + '@ticker';
  const connect = function (): void {
    const ws = new WebSocket(url);
    let pingTimer: NodeJS.Timeout | null = null;
    ws.on('open', () => {
      console.log('[WS] PAXG connected');
      pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 30000);
    });
    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg = JSON.parse(data.toString());
        if (!msg.stream || !msg.data) return;
        if (msg.stream.endsWith('@ticker')) {
          const price = parseFloat(msg.data.c);
          if (Number.isFinite(price)) dashboard.broadcast({ type: 'tick', data: { source: 'PAXG', price, ts: new Date().toISOString() } });
          return;
        }
        if (msg.stream.indexOf('@kline_') >= 0) {
          const k = msg.data.k;
          if (!k || !k.x) return;
          if (k.t <= lastPaxgKlineStart) return;
          lastPaxgKlineStart = k.t;
          const p: RawDataPoint<Candle> = {
            sourceId: 'binance-paxg',
            value: { open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v) },
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
    ws.on('close', () => {
      if (pingTimer) clearInterval(pingTimer);
      console.warn('[WS] PAXG closed, 5s');
      setTimeout(connect, 5000);
    });
    ws.on('error', (e) => console.error('[WS] PAXG:', e.message));
  };
  connect();

  process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN]');
    dashboard.stop();
    process.exit(0);
  });
}

main().catch(console.error);