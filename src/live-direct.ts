import WebSocket from 'ws';
import { runPipeline } from './integration/pipeline';
import { FeatureRegistry } from './feature-engineering/registry';
import { sma20, rsi14, atr14 } from './feature-engineering/financial';
import { structuralCheck } from './data-quality/checks/structural';
import { completenessCheck } from './data-quality/checks/completeness';
import { HashChainAuditLog } from './audit/audit-log';
import { AuthorizationService } from './security/permissions';
import { LocalFileOffsite, BackupManager } from './backup/backup-manager';
import type { RawDataPoint } from './core/types';
import type { Candle } from './data-quality/checks/base';
import type { FeatureComputeResult } from './feature-engineering/types';

const candleHistory: RawDataPoint<Candle>[] = [];
const MAX_HISTORY = 100;

function fmt(r: FeatureComputeResult | undefined, needMsg: string): string {
  if (!r || r.value === null || r.value === undefined) return needMsg;
  const v = r.value;
  if (typeof v === 'number') return v.toFixed(2);
  return String(v);
}

async function main() {
  const symbol = (process.argv[2] || 'btcusdt').toLowerCase();
  const interval = process.argv[3] || '1m';

  console.log(`\n=== FALK Live Runner (Direct, no Docker) ===`);
  console.log(`   Symbol:   ${symbol.toUpperCase()}`);
  console.log(`   Interval: ${interval}\n`);

  const audit = new HashChainAuditLog();
  const auth = new AuthorizationService(audit);
  const reg = new FeatureRegistry();
  reg.register(sma20);
  reg.register(rsi14);
  reg.register(atr14);

  const backup = new BackupManager(
    audit,
    { rpoMs: 60_000, rtoMs: 5_000, offsiteRequired: true },
    new LocalFileOffsite('.backup'),
  );

  const url = `wss://stream.binance.com:9443/ws/${symbol}@kline_${interval}`;

  const connect = (): void => {
    const ws = new WebSocket(url);

    ws.on('open', () => {
      console.log(`[WS] Connected: ${symbol}@kline_${interval}`);
      console.log(`[WS] Waiting for next closed candle...\n`);
    });

    ws.on('message', async (data: WebSocket.RawData) => {
      const msg = JSON.parse(data.toString());
      if (!msg.k || !msg.k.x) return;

      const k = msg.k;
      const point: RawDataPoint<Candle> = {
        sourceId: 'binance',
        value: {
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        },
        eventTime: new Date(k.t).toISOString(),
        closedAt: new Date(k.T + 1).toISOString(),
        arrivalTime: new Date().toISOString(),
        availabilityTime: new Date(k.T + 1).toISOString(),
        version: 1,
        fingerprint: `${symbol}-${k.t}`,
      };

      candleHistory.push(point);
      if (candleHistory.length > MAX_HISTORY) candleHistory.shift();

      console.log(`\n[CANDLE] ${symbol.toUpperCase()} @ ${point.eventTime}`);
      console.log(`   O:${point.value.open} H:${point.value.high} L:${point.value.low} C:${point.value.close}`);
      console.log(`   History: ${candleHistory.length} candles`);

      try {
        const result = runPipeline(
          {
            taskId: `live-${point.fingerprint}`,
            requestId: `req-${point.fingerprint}`,
            actor: { principalId: 'system', roles: ['ANALYST'] },
            asOfCutoff: point.availabilityTime,
            snapshotRef: { snapshotId: 'live', contentFingerprint: point.fingerprint },
            sources: [{ sourceId: 'binance', points: [...candleHistory] }],
            fusionPolicy: {
              policyVersion: 'live-v1',
              priorityOrder: ['binance'],
              conflictStrategy: 'STRICT_PRIORITY',
              toleranceBps: 50,
              allowSourceSwitching: true,
            },
            featureTargets: [
              { featureId: 'sma_20', definitionVersion: '1.0.0' },
              { featureId: 'rsi_14', definitionVersion: '1.0.0' },
              { featureId: 'atr_14', definitionVersion: '1.0.0' },
            ],
            featureInputs: new Map([
              ['sma_20', [...candleHistory]],
              ['rsi_14', [...candleHistory]],
              ['atr_14', [...candleHistory]],
            ]),
          },
          {
            qualityChecks: [structuralCheck, completenessCheck],
            featureRegistry: reg,
            audit,
            auth,
          },
        );

        const sma = result.features.get('sma_20');
        const rsi = result.features.get('rsi_14');
        const atr = result.features.get('atr_14');

        console.log(`   [TASK] ${result.finalState} | Exec: ${result.executionStatus}`);
        console.log(`   SMA20: ${fmt(sma, 'N/A (need 20)')}`);
        console.log(`   RSI14: ${fmt(rsi, 'N/A (need 15)')}`);
        console.log(`   ATR14: ${fmt(atr, 'N/A (need 15)')}`);

        const snap = backup.takeSnapshot(
          'INCREMENTAL',
          JSON.stringify({
            candle: point,
            features: {
              sma20: sma?.value ?? null,
              rsi14: rsi?.value ?? null,
              atr14: atr?.value ?? null,
            },
            executionStatus: result.executionStatus,
          }),
          'live-runner',
        );
        console.log(`   [WORM] ${snap.snapshotId}`);
      } catch (err) {
        console.error(`   [ERROR] Pipeline failed:`, (err as Error).message);
      }
    });

    ws.on('close', () => {
      console.warn('[WS] Disconnected. Reconnecting in 5s...');
      setTimeout(connect, 5000);
    });

    ws.on('error', (err) => console.error('[WS] Error:', err));
  };

  connect();
}

main().catch(console.error);
