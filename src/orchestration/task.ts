import type { AuditLog } from '../audit/audit-log';
import { IllegalTransitionError } from '../core/errors';
import { now } from '../core/time';
import type { Id, TaskState, Timestamp } from '../core/types';

const ALLOWED: Record<TaskState, ReadonlyArray<TaskState>> = {
  RECEIVED:              ['VALIDATING', 'REJECTED', 'FAILED', 'CANCELLED'],
  VALIDATING:            ['PROCESSING', 'WAITING_FOR_DATA', 'REJECTED', 'FAILED', 'CANCELLED'],
  PROCESSING:            ['WAITING_FOR_DATA', 'PARTIAL', 'READY_FOR_ACCEPTANCE', 'FAILED', 'CANCELLED'],
  WAITING_FOR_DATA:      ['PROCESSING', 'PARTIAL', 'FAILED', 'CANCELLED'],
  PARTIAL:               ['READY_FOR_ACCEPTANCE', 'WAITING_FOR_DATA', 'FAILED', 'CANCELLED'],
  READY_FOR_ACCEPTANCE:  ['COMPLETED', 'REJECTED', 'FAILED', 'CANCELLED'],
  COMPLETED:             ['SUPERSEDED'],
  REJECTED: [], FAILED: [], CANCELLED: [], SUPERSEDED: [],
};

export class Task {
  private state: TaskState = 'RECEIVED';
  private readonly history: { state: TaskState; at: Timestamp; reason?: string }[] = [];

  constructor(
    readonly taskId: Id,
    readonly requestId: Id,
    private readonly audit: AuditLog,
    readonly actor: string = 'system',
  ) {
    this.history.push({ state: 'RECEIVED', at: now() });
  }

  getState(): TaskState { return this.state; }

  transition(next: TaskState, reason?: string): void {
    const allowed = ALLOWED[this.state];
    if (!allowed || !allowed.includes(next)) throw new IllegalTransitionError(this.state, next);
    const from = this.state;
    this.state = next;
    this.history.push({ state: next, at: now(), ...(reason !== undefined ? { reason } : {}) });
    this.audit.append({
      eventType: 'TASK_TRANSITION',
      engine: 'Orchestration',
      eventTime: now(), recordTime: now(),
      actor: this.actor,
      refs: { taskId: this.taskId },
      versions: { schemaVersion: '1.0', policyVersion: '1.0', configVersion: '1.0', engineVersion: '1.0' },
      payload: { from, to: next, reason: reason ?? null },
    });
  }

  tryComplete(check: {
    acceptancePassed: boolean;
    versionRefsConsistent: boolean;
    resultStored: boolean;
  }): void {
    if (!check.acceptancePassed) throw new Error('Acceptance not passed');
    if (!check.versionRefsConsistent) throw new Error('Version refs inconsistent');
    if (!check.resultStored) throw new Error('Result not stored');
    this.transition('COMPLETED', 'All conditions met');
  }
}