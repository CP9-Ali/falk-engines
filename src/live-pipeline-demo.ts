import { BinanceLiveSource } from './ingestion/binance-live';
import { LivePipelineOrchestrator } from './integration/live-pipeline';
import { HashChainAuditLog } from './audit/audit-log';
import { AuthorizationService } from './security/permissions';
import { FeatureRegistry } from './feature-engineering/registry';
import { structuralCheck } from './data-quality/checks/structural';
import { completenessCheck } from './data-quality/checks/completeness';
import { simpleReturn1h } from './feature-engineering/examples';
import { LocalWormOffsite } from './backup/local-worm-offsite';
import { BackupManager } from './backup/backup-manager';
import { MetricsRegistry } from './monitoring/metrics';
import type { RawDataPoint } from './core/types';
import type { Candle } from './data-quality/checks/base';

const SYMBOL = 'btcusdt';
const INTERVAL = '1m' as const;
const CADENCE_MS = 60_000;
const HISTORY_CANDLES = 3;
const MIN_CANDLES = 2;

async function fetchRecentCandles(
  symbol: string,
  interval: string,
  count: number,
): Promise<RawDataPoint<Candle>[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${count}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance REST failed: ${res.status}`);
  const rows = (await res.json()) as unknown as unknown[][];
  return rows.map((row) => {
    const [openTime, open, high, low, close, volume, closeTime] = row as [
      number, string, string, string, string, string, number,
    ];
    return {
      sourceId: 'binance',
      value: {
        open: parseFloat(open),
        high: parseFloat(high),
        low: parseFloat(low),
        close: parseFloat(close),
        volume: parseFloat(volume),
      },
      eventTime: new Date(openTime).toISOString(),
      closedAt: new Date(closeTime + 1).toISOString(),
      arrivalTime: new Date(closeTime + 1).toISOString(),
      availabilityTime: new Date(closeTime + 1).toISOString(),
      version: 1,
      fingerprint: `${symbol}-${openTime}-closed`,
    };
  });
}

function printPipelineResult(tag: string, close: number, pr: any): void {
  const feats = [...pr.features.entries()]
    .map(([k, v]: [string, any]) =>
      `${k}=${v.value !== null ? Number(v.value).toFixed(6) : 'null'}`,
    )
    .join(', ');
  console.log(
    `${tag} close=${close.toFixed(2)} -> PIPELINE state=${pr.finalState} ` +
    `fused=${pr.fused?.value?.toFixed(2)} ${feats}`,
  );
}

async function main() {
  console.log('\n=== FALK ó Live Pipeline End-to-End ===\n');
  console.log(`Symbol:    ${SYMBOL}`);
  console.log(`Interval:  ${INTERVAL}`);
  console.log(`Pipeline:  Quality -> Fusion -> Quality -> Features -> WORM`);
  console.log(`Warmup:    ${HISTORY_CANDLES} historical + auto-run on history`);
  console.log(`Live:      next closed candle triggers a new run`);
  console.log(`Stop:      Ctrl+C\n`);

  const audit = new HashChainAuditLog();
  const auth = new AuthorizationService(audit);
  const registry = new FeatureRegistry();
  registry.register(simpleReturn1h);

  const worm = new LocalWormOffsite({ rootDir: 'backups/live', retentionDays: 365 });
  const backup = new BackupManager(
    audit,
    { rpoMs: 60_000, rtoMs: 10_000, offsiteRequired: true },
    worm,
  );

  const metrics = new MetricsRegistry();

  const orch = new LivePipelineOrchestrator(
    {
      symbol: SYMBOL,
      maxBufferSize: 100,
      minCandlesForFeatures: MIN_CANDLES,
      expectedCadenceMs: CADENCE_MS,
      actor: { principalId: 'live-demo', roles: ['ANALYST'] },
      fusionPolicy: {
        policyVersion: 'live-v1',
        priorityOrder: [SYMBOL],
        conflictStrategy: 'STRICT_PRIORITY',
        toleranceBps: 50,
        allowSourceSwitching: false,
      },
      featureTargets: [{ featureId: 'simple_return_1h', definitionVersion: '1.0.0' }],
    },
    {
      qualityChecks: [structuralCheck, completenessCheck],
      featureRegistry: registry,
      audit,
      auth,
      backup,
      metrics,
    },
  );

  // 1.  Õ„Ì·  «—ÌŒÌ
  console.log(`[setup] fetching ${HISTORY_CANDLES} recent candles...`);
  try {
    const history = await fetchRecentCandles(SYMBOL, INTERVAL, HISTORY_CANDLES);
    orch.loadHistory(history);
    console.log(
      `[setup] loaded ${history.length} candles ` +
      `(${history[0]?.eventTime} -> ${history[history.length - 1]?.eventTime})`,
    );

    // 2.  ‘€Ì· ›Ê—Ì ⁄·Ï «· «—ÌŒ
    console.log(`[setup] running initial pipeline on history...`);
    const warm = await orch.runNow();
    if (warm.status === 'EXECUTED' && warm.pipelineResult) {
      const last = history[history.length - 1]!;
      printPipelineResult('[INIT]  ', last.value.close, warm.pipelineResult);
      console.log(`[setup] snapshot saved to backups/live/snapshots/\n`);
    } else {
      console.log(`[setup] runNow: ${warm.status} (${warm.error ?? 'warming up'})\n`);
    }
  } catch (e: any) {
    console.error(`[setup] history failed: ${e.message}`);
    console.error(`        pipeline will warm up from live data\n`);
  }

  // 3. WebSocket ÕÌ
  let openSeen = 0;
  const source = new BinanceLiveSource({
    symbol: SYMBOL,
    interval: INTERVAL,
    emitInProgress: true,
    onPoint: async (p: RawDataPoint<Candle>) => {
      if (!p.fingerprint.endsWith('closed')) {
        openSeen++;
        if (openSeen <= 3 || openSeen % 30 === 0) {
          console.log(`[open]   close=${p.value.close.toFixed(2)} (${openSeen} in-progress ignored)`);
        }
        return;
      }

      const result = await orch.onPoint(p);
      if (result.status === 'EXECUTED' && result.pipelineResult) {
        printPipelineResult('[CLOSED]', p.value.close, result.pipelineResult);
      } else if (result.status === 'ERROR') {
        console.log(`[CLOSED] close=${p.value.close.toFixed(2)} -> ERROR: ${result.error}`);
      } else {
        console.log(
          `[CLOSED] close=${p.value.close.toFixed(2)} -> warming up (${result.candles}/${MIN_CANDLES})`,
        );
      }
    },
  });

  await source.start();

  process.on('SIGINT', async () => {
    console.log('\n\nShutting down...');
    await source.stop();
    const s = orch.stats();
    console.log(`\nFinal stats:`);
    console.log(`  Candles in window:       ${s.candlesInWindow}`);
    console.log(`  Closed candles received: ${s.processedClosedCandles}`);
    console.log(`  Pipeline runs:           ${s.pipelineRuns}`);
    if (s.lastError) console.log(`  Last error:              ${s.lastError}`);
    console.log(`\nResults: backups/live/snapshots/`);
    process.exit(0);
  });
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});