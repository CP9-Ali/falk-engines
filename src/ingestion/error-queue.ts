import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface FailedOperation {
  readonly id: string;
  readonly occurred_at_utc: string;
  readonly source_id: string;
  readonly operation: string;
  readonly reason: string;
  readonly payload?: Record<string, unknown>;
}

export class ErrorQueue {
  private readonly dir: string;
  private readonly path: string;

  constructor(baseDir = '.backup/errors') {
    this.dir = baseDir;
    mkdirSync(this.dir, { recursive: true });
    this.path = join(this.dir, 'queue.jsonl');
  }

  push(op: Omit<FailedOperation, 'id' | 'occurred_at_utc'>): FailedOperation {
    const entry: FailedOperation = {
      id: 'err-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      occurred_at_utc: new Date().toISOString(),
      ...op,
    };
    appendFileSync(this.path, JSON.stringify(entry) + '\n', 'utf-8');
    return entry;
  }

  list(): FailedOperation[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, 'utf-8').split('\n').filter(l => l.trim().length > 0);
    const out: FailedOperation[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return out;
  }

  count(): number {
    return this.list().length;
  }

  /** §5.3: عند إعادة التشغيل — كل فشل غير معالج يُسجّل */
  reportOnStartup(): FailedOperation[] {
    const failed = this.list();
    if (failed.length > 0) {
      console.warn('[ERR-QUEUE] ' + failed.length + ' unresolved failures at startup');
      const bySource = new Map<string, number>();
      for (const f of failed) {
        bySource.set(f.source_id, (bySource.get(f.source_id) ?? 0) + 1);
      }
      for (const [src, cnt] of bySource) {
        console.warn('[ERR-QUEUE]   ' + src + ': ' + cnt);
      }
    }
    return failed;
  }
}