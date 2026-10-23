import WebSocket from 'ws';
import 'dotenv/config';
import { runPipeline } from './integration/pipeline';
import { FeatureRegistry } from './feature-engineering/registry';
import { sma20, rsi14, atr14 } from './feature-engineering/financial';
import { structuralCheck } from './data-quality/checks/structural';
import { completenessCheck } from './data-quality/checks/completeness';
import { HashChainAuditLog } from './audit/audit-log';
import { AuthorizationService } from './security/permissions';
import { LocalFileOffsite, BackupManager } from './backup/backup-manager';
import { DashboardServer } from './dashboard/server';
import { TwelveDataWsSource } from './ingestion/twelvedata-ws';
import { XausApiSource } from './ingestion/xaus-api';
import { XauSourceManager } from './ingestion/xau-source-manager';
import { loadBinanceHistory } from './ingestion/binance-history';
import type { RawDataPoint } from './core/types';
import type { Candle } from './data-quality/checks/base';
import type { FeatureComputeResult } from './feature-engineering/types';

const PAXG_SYMBOL = 'paxgusdt';
const PAXG_BINANCE = 'PAXGUSDT';
const INTERVAL = process.argv[2] || '1m';
const PORT = parseInt(process.env.PORT || '3000');
const TD_KEY = process.env.TWELVEDATA_API_KEY || '';

const paxgHistory: RawDataPoint<Candle>[] = [];
const xauHistory: RawDataPoint<Candle>[] = [];
const MAX_HISTORY = 100;
let lastPaxgKlineStart = 0;
let activeSourceName = 'none';

function fmt(r: FeatureComputeResult | undefined, need: string): string {
  if (!r || r.value === null || r.value === undefined) return need;
  return typeof r.value === 'number' ? r.value.toFixed(2) : String(r.value);
}

function filterByCutoff(history: RawDataPoint<Candle>[], cutoff: string): RawDataPoint<Candle>[] {
  const ms = new Date(cutoff).getTime();
  return history.filter(p => new Date(p.availabilityTime).getTime() <= ms);
}

async function main() {
  console.log('\n=== FALK GOLD Live (Multi-Source Failover) ===');
  console.log('   Primary:   TwelveData WebSocket (~170ms)');
  console.log('   Backup 1:  xaus.com REST (no key)');
  console.log('   Backup 2:  Binance PAXG (gold token)');
  console.log('   Dashboard: http://localhost:' + PORT + '\n');

  const dashboard = new DashboardServer(PORT);
  dashboard.start();

  const audit = new HashChainAuditLog();
  const auth = new AuthorizationService(audit);
  const reg = new FeatureRegistry();
  reg.register(sma20); reg.register(rsi14); reg.register(atr14);

  const sink = new LocalFileOffsite('.backup');
  const backup = new BackupManager(audit, { rpoMs: 60000, rtoMs: 5000, offsiteRequired: true }, sink);

  const processCandle = function (sourceLabel: string, point: RawDataPoint<Candle>): void {
    try {
      const cutoff = point.availabilityTime;
      const filteredPaxg = filterByCutoff(paxgHistory, cutoff);
      const filteredXau = filterByCutoff(xauHistory, cutoff);
      const sources: Array<{ sourceId: string; points: RawDataPoint<Candle>[] }> = [];
      if (filteredPaxg.length > 0) sources.push({ sourceId: 'binance-paxg', points: filteredPaxg });
      if (filteredXau.length > 0) sources.push({ sourceId: 'gold-xau', points: filteredXau });
      const primary = filteredXau.length > 0 ? filteredXau : filteredPaxg;

      const result = runPipeline({
        taskId: 'live-' + point.fingerprint,
        requestId: 'req-' + point.fingerprint,
        actor: { principalId: 'system', roles: ['ANALYST'] },
        asOfCutoff: cutoff,
        snapshotRef: { snapshotId: 'live', contentFingerprint: point.fingerprint },
        sources,
        fusionPolicy: {
          policyVersion: 'gold-v2',
          priorityOrder: ['gold-xau', 'binance-paxg'],
          conflictStrategy: 'STRICT_PRIORITY',
          toleranceBps: 100,
          allowSourceSwitching: false
        },
        featureTargets: [
          { featureId: 'sma_20', definitionVersion: '1.0.0' },
          { featureId: 'rsi_14', definitionVersion: '1.0.0' },
          { featureId: 'atr_14', definitionVersion: '1.0.0' }
        ],
        featureInputs: new Map([
          ['sma_20', primary], ['rsi_14', primary], ['atr_14', primary]
        ])
      }, { qualityChecks: [structuralCheck, completenessCheck], featureRegistry: reg, audit, auth });

      const sma = result.features.get('sma_20');
      const rsi = result.features.get('rsi_14');
      const atr = result.features.get('atr_14');
      const smaVal = typeof sma?.value === 'number' ? sma.value : null;
      const rsiVal = typeof rsi?.value === 'number' ? rsi.value : null;
      const atrVal = typeof atr?.value === 'number' ? atr.value : null;

      dashboard.broadcast({ type: 'candle', data: { symbol: sourceLabel, ...point }, status: result.executionStatus });
      if (result.qualityAfter) dashboard.broadcast({ type: 'quality', data: { status: result.qualityAfter.overallStatus, suitable: result.qualityAfter.suitableForTask } });
      if (result.fused) dashboard.broadcast({ type: 'fusion', data: { value: result.fused.value, conflict: result.fused.conflictStatus } });
      dashboard.broadcast({ type: 'feature', data: { name: 'sma', value: smaVal } });
      dashboard.broadcast({ type: 'feature', data: { name: 'rsi', value: rsiVal } });
      dashboard.broadcast({ type: 'feature', data: { name: 'atr', value: atrVal } });
      dashboard.broadcast({ type: 'task', data: { state: result.finalState, exec: result.executionStatus } });

      const snap = backup.takeSnapshot('INCREMENTAL', JSON.stringify({ source: sourceLabel, candle: point, features: { sma20: smaVal, rsi14: rsiVal, atr14: atrVal }, executionStatus: result.executionStatus }), 'live-runner');
      dashboard.broadcast({ type: 'worm', data: { id: snap.snapshotId, total: sink.count(), last: snap.snapshotId } });

      console.log('[' + sourceLabel + '] C=' + point.value.close.toFixed(2) + ' | ' + result.executionStatus + ' | SMA=' + fmt(sma, 'N/A') + ' RSI=' + fmt(rsi, 'N/A') + ' ATR=' + fmt(atr, 'N/A'));
    } catch (e) { console.error('[ERROR ' + sourceLabel + ']', (e as Error).message); }
  };

  const xauHandler = function (p: RawDataPoint<Candle>, isHistory: boolean): void {
    xauHistory.push(p);
    if (xauHistory.length > MAX_HISTORY) xauHistory.shift();
    if (isHistory) { dashboard.broadcast({ type: 'candle', data: { symbol: 'XAU', ...p }, status: 'BACKFILL' }); return; }
    processCandle('XAU', p);
  };

  // === Backfill PAXG (instant history) ===
  try {
    console.log('[PAXG] Loading 100 historical bars...');
    const hist = await loadBinanceHistory(PAXG_BINANCE, 100);
    for (const p of hist) { paxgHistory.push(p); dashboard.broadcast({ type: 'candle', data: { symbol: 'PAXG', ...p }, status: 'BACKFILL' }); }
    console.log('[PAXG] Loaded ' + hist.length + ' bars');
  } catch (e) { console.error('[PAXG] History failed:', (e as Error).message); }

  // === Multi-source XAU with failover ===
  const manager = new XauSourceManager(
    { switchAfterMs: 30000, cooldownMs: 300000 },
    (name) => { activeSourceName = name; console.log('[Failover] >>> ACTIVE: ' + name); },
  );

  // priority 0 = primary
  const td = TD_KEY ? new TwelveDataWsSource(TD_KEY, 'XAU/USD', xauHandler,
    (price, ts) => { manager.notifyTick('twelvedata-ws'); dashboard.broadcast({ type: 'tick', data: { source: 'XAU', price, ts } }); },
    (healthy) => { /* manager internally tracks */ },
  ) : null;

  const xaus = new XausApiSource(xauHandler,
    (price, ts) => { manager.notifyTick('xaus-api'); dashboard.broadcast({ type: 'tick', data: { source: 'XAU', price, ts } }); },
    (healthy) => { /* manager internally tracks */ },
    10000,
  );

  if (td) manager.register(td, 0);
  manager.register(xaus, 1);
  manager.start();
  // === PAXG live ===
  const url = 'wss://stream.binance.com:9443/stream?streams=' + PAXG_SYMBOL + '@kline_' + INTERVAL + '/' + PAXG_SYMBOL + '@ticker';
  const connect = function (): void {
    const ws = new WebSocket(url);
    let pingTimer: NodeJS.Timeout | null = null;
    ws.on('open', () => { console.log('[WS] PAXG connected'); pingTimer = setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 30000); });
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
          const k = msg.data.k; if (!k || !k.x) return;
          if (k.t <= lastPaxgKlineStart) return; lastPaxgKlineStart = k.t;
          const p: RawDataPoint<Candle> = {
            sourceId: 'binance-paxg',
            value: { open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v) },
            eventTime: new Date(k.t).toISOString(),
            closedAt: new Date(k.T + 1).toISOString(),
            arrivalTime: new Date().toISOString(),
            availabilityTime: new Date(k.T + 1).toISOString(),
            version: 1, fingerprint: PAXG_SYMBOL + '-' + k.t,
          };
          paxgHistory.push(p); if (paxgHistory.length > MAX_HISTORY) paxgHistory.shift();
          processCandle('PAXG', p);
        }
      } catch (e) { console.warn('[WS] parse:', (e as Error).message); }
    });
    ws.on('close', () => { if (pingTimer) clearInterval(pingTimer); console.warn('[WS] PAXG closed, reconnect in 5s'); setTimeout(connect, 5000); });
    ws.on('error', (e) => console.error('[WS] PAXG error:', e.message));
  };
  connect();

  process.on('SIGINT', () => { console.log('\n[SHUTDOWN]'); manager.stop(); dashboard.stop(); process.exit(0); });
}

main().catch(console.error);