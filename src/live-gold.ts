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
import { TwelveDataXauPoller } from './ingestion/twelvedata-xau';
import type { RawDataPoint } from './core/types';
import type { Candle } from './data-quality/checks/base';
import type { FeatureComputeResult } from './feature-engineering/types';

const PAXG_SYMBOL = 'paxgusdt';
const INTERVAL = process.argv[2] || '1m';
const PORT = parseInt(process.env.PORT || '3000');
const XAU_API_KEY = process.env.TWELVEDATA_API_KEY || '';

const paxgHistory: RawDataPoint<Candle>[] = [];
const xauHistory: RawDataPoint<Candle>[] = [];
const MAX_HISTORY = 100;

function fmt(r: FeatureComputeResult | undefined, need: string): string {
  if (!r || r.value === null || r.value === undefined) return need;
  return typeof r.value === 'number' ? r.value.toFixed(2) : String(r.value);
}

async function main() {
  console.log('\n=== FALK GOLD Live (PAXG + XAU/USD) ===');
  console.log('   PAXG:     Binance WebSocket');
  console.log('   XAU:      TwelveData poller ' + (XAU_API_KEY ? '(enabled)' : '(DISABLED — no API key)'));
  console.log('   Interval: ' + INTERVAL);
  console.log('   Dashboard: http://localhost:' + PORT + '\n');

  const dashboard = new DashboardServer(PORT);
  dashboard.start();

  const audit = new HashChainAuditLog();
  const auth = new AuthorizationService(audit);
  const reg = new FeatureRegistry();
  reg.register(sma20);
  reg.register(rsi14);
  reg.register(atr14);

  const sink = new LocalFileOffsite('.backup');
  const backup = new BackupManager(
    audit,
    { rpoMs: 60_000, rtoMs: 5_000, offsiteRequired: true },
    sink,
  );

  // دالة معالجة موحدة لكل مصدر
  const processCandle = (sourceLabel: string, point: RawDataPoint<Candle>): void => {
    try {
      const sources: { sourceId: string; points: RawDataPoint<Candle>[] }[] = [];
      if (paxgHistory.length > 0) sources.push({ sourceId: 'binance-paxg', points: [...paxgHistory] });
      if (xauHistory.length > 0) sources.push({ sourceId: 'twelvedata-xau', points: [...xauHistory] });

      const primaryHistory = xauHistory.length > 0 ? xauHistory : paxgHistory;

      const result = runPipeline(
        {
          taskId: 'live-' + point.fingerprint,
          requestId: 'req-' + point.fingerprint,
          actor: { principalId: 'system', roles: ['ANALYST'] },
          asOfCutoff: point.availabilityTime,
          snapshotRef: { snapshotId: 'live', contentFingerprint: point.fingerprint },
          sources,
          fusionPolicy: {
            policyVersion: 'gold-v1',
            priorityOrder: ['twelvedata-xau', 'binance-paxg'],  // ← XAU أولاً (أدق)
            conflictStrategy: 'STRICT_PRIORITY',
            toleranceBps: 100,
            allowSourceSwitching: false,
          },
          featureTargets: [
            { featureId: 'sma_20', definitionVersion: '1.0.0' },
            { featureId: 'rsi_14', definitionVersion: '1.0.0' },
            { featureId: 'atr_14', definitionVersion: '1.0.0' },
          ],
          featureInputs: new Map([
            ['sma_20', [...primaryHistory]],
            ['rsi_14', [...primaryHistory]],
            ['atr_14', [...primaryHistory]],
          ]),
        },
        { qualityChecks: [structuralCheck, completenessCheck], featureRegistry: reg, audit, auth },
      );

      const sma = result.features.get('sma_20');
      const rsi = result.features.get('rsi_14');
      const atr = result.features.get('atr_14');

      dashboard.broadcast({
        type: 'candle',
        data: { symbol: sourceLabel, ...point },
        status: result.executionStatus,
      });
      if (result.qualityAfter) {
        dashboard.broadcast({
          type: 'quality',
          data: {
            status: result.qualityAfter.overallStatus,
            suitable: result.qualityAfter.suitableForTask,
          },
        });
      }
      if (result.fused) {
        dashboard.broadcast({
          type: 'fusion',
          data: { value: result.fused.value, conflict: result.fused.conflictStatus },
        });
      }
      const smaVal = typeof sma?.value === 'number' ? sma.value : null;
const rsiVal = typeof rsi?.value === 'number' ? rsi.value : null;
const atrVal = typeof atr?.value === 'number' ? atr.value : null;

dashboard.broadcast({ type: 'feature', data: { name: 'sma', value: smaVal } });
dashboard.broadcast({ type: 'feature', data: { name: 'rsi', value: rsiVal } });
dashboard.broadcast({ type: 'feature', data: { name: 'atr', value: atrVal } });
      const snap = backup.takeSnapshot(
        'INCREMENTAL',
        JSON.stringify({
          source: sourceLabel,
          candle: point,
          features: { sma20: sma?.value ?? null, rsi14: rsi?.value ?? null, atr14: atr?.value ?? null },
          executionStatus: result.executionStatus,
        }),
        'live-runner',
      );
      dashboard.broadcast({
        type: 'worm',
        data: { id: snap.snapshotId, total: sink.count(), last: snap.snapshotId },
      });

      console.log('[' + sourceLabel + '] C=' + point.value.close.toFixed(2) +
        ' | fused=' + (result.fused?.value?.toFixed(2) ?? 'N/A') +
        ' | ' + result.executionStatus);
    } catch (err) {
      console.error('[ERROR ' + sourceLabel + ']', (err as Error).message);
    }
  };

  // ── Binance PAXG ─────────────────────────────────────
  const url = 'wss://stream.binance.com:9443/ws/' + PAXG_SYMBOL + '@kline_' + INTERVAL;
  const connect = (): void => {
    const ws = new WebSocket(url);
    ws.on('open', () => console.log('[WS] Connected: ' + PAXG_SYMBOL + '@kline_' + INTERVAL));
    ws.on('message', (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (!msg.k || !msg.k.x) return;
      const k = msg.k;
      const point: RawDataPoint<Candle> = {
        sourceId: 'binance-paxg',
        value: {
          open: parseFloat(k.o), high: parseFloat(k.h),
          low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v),
        },
        eventTime: new Date(k.t).toISOString(),
        closedAt: new Date(k.T + 1).toISOString(),
        arrivalTime: new Date().toISOString(),
        availabilityTime: new Date(k.T + 1).toISOString(),
        version: 1,
        fingerprint: PAXG_SYMBOL + '-' + k.t,
      };
      paxgHistory.push(point);
      if (paxgHistory.length > MAX_HISTORY) paxgHistory.shift();
      processCandle('PAXG', point);
    });
    ws.on('close', () => { setTimeout(connect, 5000); });
    ws.on('error', (err) => console.error('[WS] Error:', err));
  };
  connect();

  // ── TwelveData XAU/USD ───────────────────────────────
  if (XAU_API_KEY) {
    const poller = new TwelveDataXauPoller(XAU_API_KEY, (point) => {
      xauHistory.push(point);
      if (xauHistory.length > MAX_HISTORY) xauHistory.shift();
      processCandle('XAU', point);
    });
    poller.start();
    process.on('SIGINT', () => poller.stop());
  } else {
    console.warn('[XAU] No TWELVEDATA_API_KEY in .env — using PAXG only');
  }

  process.on('SIGINT', () => {
    console.log('\n[SHUTDOWN]');
    dashboard.stop();
    process.exit(0);
  });
}

main().catch(console.error);
