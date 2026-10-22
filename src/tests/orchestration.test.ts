import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { Task } from '../orchestration/task';
import { IllegalTransitionError } from '../core/errors';

describe('Task lifecycle', () => {
  it('rejects illegal transitions', () => {
    const t = new Task('t', 'r', new HashChainAuditLog(), 'test');
    expect(() => t.transition('COMPLETED')).toThrow(IllegalTransitionError);
  });
  it('reaches COMPLETED only with conditions', () => {
    const t = new Task('t', 'r', new HashChainAuditLog(), 'test');
    t.transition('VALIDATING'); t.transition('PROCESSING'); t.transition('READY_FOR_ACCEPTANCE');
    expect(() => t.tryComplete({ acceptancePassed: false, versionRefsConsistent: true, resultStored: true })).toThrow();
    t.tryComplete({ acceptancePassed: true, versionRefsConsistent: true, resultStored: true });
    expect(t.getState()).toBe('COMPLETED');
  });
});