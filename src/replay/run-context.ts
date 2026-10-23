import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export interface AnalysisRunContext {
  readonly analysis_run_id: string;
  readonly started_at_utc: string;
  readonly settings_snapshot: Record<string, unknown>;
  readonly versions: {
    readonly code_version: string;
    readonly schema_version: string;
    readonly policy_version: string;
    readonly config_version: string;
  };
  readonly feature_definitions: ReadonlyArray<{
    feature_id: string;
    definition_version: string;
    parameters: Record<string, number>;
  }>;
  readonly settings_hash: string;
  readonly notes?: string;
}

export class RunContextStore {
  private readonly dir: string;

  constructor(baseDir = '.backup/runs') {
    this.dir = baseDir;
    mkdirSync(this.dir, { recursive: true });
  }

  /** §13: يحفظ كل ما يلزم لإعادة التشغيل بنفس الشروط */
  save(ctx: AnalysisRunContext): string {
    const path = join(this.dir, ctx.analysis_run_id + '.json');
    const body = JSON.stringify(ctx, null, 2);
    writeFileSync(path, body, 'utf-8');
    return path;
  }

  load(analysisRunId: string): AnalysisRunContext | null {
    const path = join(this.dir, analysisRunId + '.json');
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as AnalysisRunContext;
    } catch {
      return null;
    }
  }

  list(): string[] {
    if (!existsSync(this.dir)) return [];
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    return readdirSync(this.dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
  }

  static hashSettings(settings: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(settings)).digest('hex');
  }

  static newRunId(): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const rand = Math.random().toString(36).slice(2, 8);
    return 'run-' + ts + '-' + rand;
  }
}