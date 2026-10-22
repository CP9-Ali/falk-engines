import type { AuditLog } from '../audit/audit-log';
import type { RawDataPoint } from '../core/types';
import type { Candle, QualityCheck } from '../data-quality/checks/base';
import type { FusionPolicy } from '../data-fusion/types';
import type { FeatureRegistry } from '../feature-engineering/registry';
import type { AuthorizationService, Principal } from '../security/permissions';
import type { MetricsRegistry } from '../monitoring/metrics';
import type { BackupManager } from '../backup/backup-manager';
import { runPipeline, type PipelineResult } from './pipeline';
import { newId } from '../core/ids';

export interface LivePipelineConfig {
  readonly symbol: string;
  readonly maxBufferSize: number;
  readonly minCandlesForFeatures: number;
  readonly expectedCadenceMs: number;
  readonly actor: Principal;
  readonly fusionPolicy: FusionPolicy;
  readonly featureTargets: ReadonlyArray<{ featureId: string; definitionVersion: string }>;
}

export interface LiveTickResult {
  readonly status: 'WARMING_UP' | 'EXECUTED' | 'ERROR';
  readonly candles: number;
  readonly pipelineResult?: PipelineResult;
  readonly error?: string;
}

export interface LivePipelineDeps {
  readonly qualityChecks: ReadonlyArray<QualityCheck>;
  readonly featureRegistry: FeatureRegistry;
  readonly audit: AuditLog;
  readonly auth: AuthorizationService;
  readonly backup?: BackupManager;
  readonly metrics?: MetricsRegistry;
}

export class LivePipelineOrchestrator {
  private candles: RawDataPoint<Candle>[] = [];
  private processedClosed = 0;
  private runs = 0;
  private lastError?: string;

  constructor(
    private readonly cfg: LivePipelineConfig,
    private readonly deps: LivePipelineDeps,
  ) {}

  /** تحميل تاريخي — لا يُشغّل pipeline تلقائياً (استدعِ runNow للنتيجة الفورية). */
  loadHistory(points: RawDataPoint<Candle>[]): void {
    this.candles = [...points.slice(-this.cfg.maxBufferSize)];
  }

  /** تشغيل pipeline فوري على النافذة الحالية (بدون انتظار شمعة جديدة). */
  async runNow(): Promise<LiveTickResult> {
    if (this.candles.length < this.cfg.minCandlesForFeatures) {
      return { status: 'WARMING_UP', candles: this.candles.length };
    }
    return this.execute();
  }

  async onPoint(point: RawDataPoint<Candle>): Promise<LiveTickResult> {
    // §5.4: رفض الشموع قيد التكوّن
    const isClosed =
      point.fingerprint.endsWith('closed') ||
      (!point.fingerprint.endsWith('open') &&
        point.closedAt !== undefined &&
        new Date(point.closedAt).getTime() <= Date.now());
    if (!isClosed) {
      return { status: 'WARMING_UP', candles: this.candles.length };
    }

    this.candles.push(point);
    if (this.candles.length > this.cfg.maxBufferSize) this.candles.shift();
    this.processedClosed++;

    if (this.candles.length < this.cfg.minCandlesForFeatures) {
      return { status: 'WARMING_UP', candles: this.candles.length };
    }

    return this.execute();
  }

  stats() {
    return {
      candlesInWindow: this.candles.length,
      processedClosedCandles: this.processedClosed,
      pipelineRuns: this.runs,
      lastError: this.lastError,
    };
  }

  private async execute(): Promise<LiveTickResult> {
    const lastCandle = this.candles[this.candles.length - 1]!;
    try {
      const cutoff = lastCandle.closedAt ?? lastCandle.eventTime;
      const featureInputs = new Map<string, unknown>();
      for (const t of this.cfg.featureTargets) {
        featureInputs.set(t.featureId, this.candles);
      }

      const result = runPipeline(
        {
          taskId: newId('live-task'),
          requestId: newId('live-req'),
          actor: this.cfg.actor,
          asOfCutoff: cutoff,
          snapshotRef: {
            snapshotId: `live-${Date.now()}`,
            contentFingerprint: lastCandle.fingerprint,
          },
          sources: [{ sourceId: this.cfg.symbol, points: this.candles }],
          fusionPolicy: this.cfg.fusionPolicy,
          featureTargets: this.cfg.featureTargets,
          featureInputs,
        },
        {
          qualityChecks: this.deps.qualityChecks,
          featureRegistry: this.deps.featureRegistry,
          audit: this.deps.audit,
          auth: this.deps.auth,
          metrics: this.deps.metrics,
        },
      );

      this.runs++;

      if (this.deps.backup) {
        const payload = JSON.stringify({
          symbol: this.cfg.symbol,
          cutoff,
          candle: lastCandle.value,
          finalState: result.finalState,
          executionStatus: result.executionStatus,
          fusedValue: result.fused?.value,
          features: [...result.features.entries()].map(([k, v]) => ({
            featureId: k,
            status: v.status,
            value: v.value,
          })),
        });
        this.deps.backup.takeSnapshot('FULL', payload, this.cfg.actor.principalId);
      }

      if (result.errorMessage) {
        this.lastError = result.errorMessage;
        return {
          status: 'ERROR',
          candles: this.candles.length,
          error: result.errorMessage,
          pipelineResult: result,
        };
      }

      return {
        status: 'EXECUTED',
        candles: this.candles.length,
        pipelineResult: result,
      };
    } catch (e: any) {
      this.lastError = e.message;
      return { status: 'ERROR', candles: this.candles.length, error: e.message };
    }
  }
}