import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * §13: "نتائج كل محرك وحالة تشغيله" — لكل شمعة، نسجّل نتيجة كل محرك على حدة.
 * هذا يختلف عن WORM snapshot العام — هنا رؤية per-engine مهيكلة.
 */

export type EngineName = 'quality' | 'fusion' | 'feature' | 'multi_tf';

export interface EngineResultEntry {
  readonly analysis_run_id: string;
  readonly timeframe: string;
  readonly candle_fingerprint: string;
  readonly candle_event_time_utc: string;
  readonly engine: EngineName;
  readonly engine_version: string;
  readonly status: string;
  readonly value: Record<string, unknown>;
  readonly created_at_utc: string;
}

export class EngineResultsLog {
  private readonly dir: string;

  constructor(baseDir = '.backup/engine-runs') {
    this.dir = baseDir;
    mkdirSync(this.dir, { recursive: true });
  }

  private pathFor(runId: string): string {
    return join(this.dir, runId + '.jsonl');
  }

  append(entry: EngineResultEntry): void {
    appendFileSync(this.pathFor(entry.analysis_run_id), JSON.stringify(entry) + '\n', 'utf-8');
  }

  list(runId: string): EngineResultEntry[] {
    const path = this.pathFor(runId);
    if (!existsSync(path)) return [];
    const lines = readFileSync(path, 'utf-8').split('\n').filter(l => l.trim().length > 0);
    const out: EngineResultEntry[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return out;
  }

  byTimeframe(runId: string, timeframe: string): EngineResultEntry[] {
    return this.list(runId).filter(e => e.timeframe === timeframe);
  }

  byEngine(runId: string, engine: EngineName): EngineResultEntry[] {
    return this.list(runId).filter(e => e.engine === engine);
  }

  count(runId: string): number {
    return this.list(runId).length;
  }
}