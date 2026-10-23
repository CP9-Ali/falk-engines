import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type RequestStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'NO_RESULT';

/** §5.2: كل طلب يُسجَّل بـ request_id ووقت البدء والاستلام */
export interface RequestLog {
  readonly request_id: string;
  readonly source_id: string;
  readonly operation: string;
  readonly started_at_utc: string;
  readonly completed_at_utc: string | null;
  readonly status: RequestStatus;
  readonly reason?: string;
  readonly payload_size?: number;
}

export class RequestTracker {
  private readonly dir: string;
  private readonly path: string;

  constructor(baseDir = '.backup/requests') {
    this.dir = baseDir;
    mkdirSync(this.dir, { recursive: true });
    this.path = join(this.dir, 'log.jsonl');
  }

  newRequestId(): string {
    return 'req-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  }

  begin(sourceId: string, operation: string): { request_id: string; log: RequestLog } {
    const request_id = this.newRequestId();
    const log: RequestLog = {
      request_id,
      source_id: sourceId,
      operation,
      started_at_utc: new Date().toISOString(),
      completed_at_utc: null,
      status: 'SKIPPED',
    };
    return { request_id, log };
  }

  complete(log: RequestLog, status: RequestStatus, opts?: { reason?: string; payload_size?: number }): RequestLog {
    const finished: RequestLog = {
      ...log,
      completed_at_utc: new Date().toISOString(),
      status,
      ...(opts?.reason !== undefined ? { reason: opts.reason } : {}),
      ...(opts?.payload_size !== undefined ? { payload_size: opts.payload_size } : {}),
    };
    appendFileSync(this.path, JSON.stringify(finished) + '\n', 'utf-8');
    return finished;
  }

  list(): RequestLog[] {
    if (!existsSync(this.path)) return [];
    const lines = readFileSync(this.path, 'utf-8').split('\n').filter(l => l.trim().length > 0);
    const out: RequestLog[] = [];
    for (const line of lines) {
      try { out.push(JSON.parse(line)); } catch { /* skip */ }
    }
    return out;
  }

  count(): number { return this.list().length; }

  summary(): { total: number; success: number; failed: number; skipped: number } {
    const all = this.list();
    return {
      total: all.length,
      success: all.filter(r => r.status === 'SUCCESS').length,
      failed: all.filter(r => r.status === 'FAILED').length,
      skipped: all.filter(r => r.status === 'SKIPPED').length,
    };
  }
}