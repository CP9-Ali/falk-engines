import { describe, it, expect } from 'vitest';
import { DataFusionEngine } from '../data-fusion/engine';
import { HashChainAuditLog } from '../audit/audit-log';
import type { FusionPolicy } from '../data-fusion/types';

const policy: FusionPolicy = {
  policyVersion: 'p',
  priorityOrder: ['A', 'B', 'C'],
  conflictStrategy: 'STRICT_PRIORITY',
  toleranceBps: 50,
  allowSourceSwitching: false,
};

const CUTOFF = '2025-01-06T10:00:00.000Z';

function mk(sourceId: string, close: number, timeBlocked?: boolean) {
  const base = {
    sourceId,
    value: { close },
    eventTime: CUTOFF,
    availabilityTime: CUTOFF,
    sourceVersion: 1,
    qualityStatus: 'PASS' as const,
  };
  return timeBlocked === undefined ? base : { ...base, timeBlocked };
}

describe('Stage 8C — fusion blocks timeBlocked sources', () => {
  it('single timeBlocked source → TIME_BLOCKED with null value', () => {
    const engine = new DataFusionEngine(new HashChainAuditLog(), '1.0');
    const r = engine.fuse([mk('A', 100, true)], policy, CUTOFF, 'test');
    expect(r.fusedValue).toBeNull();
    expect(r.conflictStatus).toBe('INSUFFICIENT_COMPARABLE_DATA');
    expect(r.droppedSources).toHaveLength(1);
    expect(r.droppedSources[0]!.reason).toBe('TIME_BLOCKED');
  });

  it('all sources timeBlocked → TIME_BLOCKED', () => {
    const engine = new DataFusionEngine(new HashChainAuditLog(), '1.0');
    const r = engine.fuse([mk('A', 100, true), mk('B', 101, true)], policy, CUTOFF, 'test');
    expect(r.fusedValue).toBeNull();
    expect(r.conflictStatus).toBe('INSUFFICIENT_COMPARABLE_DATA');
    expect(r.droppedSources).toHaveLength(2);
    expect(r.droppedSources.every(d => d.reason === 'TIME_BLOCKED')).toBe(true);
  });

  it('mixed: one timeBlocked + one clean → uses clean only', () => {
    const engine = new DataFusionEngine(new HashChainAuditLog(), '1.0');
    const r = engine.fuse([mk('A', 100, true), mk('B', 101)], policy, CUTOFF, 'test');
    expect(r.fusedValue).not.toBeNull();
    expect((r.fusedValue as { close: number }).close).toBe(101);
    expect(r.droppedSources.some(d => d.reason === 'TIME_BLOCKED')).toBe(true);
    expect(r.provenance).toHaveLength(1);
    expect(r.provenance[0]!.sourceId).toBe('B');
  });

  it('timeBlocked undefined → backward compat (not blocked)', () => {
    const engine = new DataFusionEngine(new HashChainAuditLog(), '1.0');
    const r = engine.fuse([mk('A', 100), mk('B', 101)], policy, CUTOFF, 'test');
    expect(r.fusedValue).not.toBeNull();
    expect(r.droppedSources).toHaveLength(0);
    expect(r.conflictStatus).not.toBe('INSUFFICIENT_COMPARABLE_DATA');
  });

  it('timeBlocked false → behaves as not blocked', () => {
    const engine = new DataFusionEngine(new HashChainAuditLog(), '1.0');
    const r = engine.fuse([mk('A', 100, false), mk('B', 101, false)], policy, CUTOFF, 'test');
    expect(r.fusedValue).not.toBeNull();
    expect(r.droppedSources).toHaveLength(0);
  });

  it('emits FUSION_TIME_BLOCKED audit event when all blocked', () => {
    const audit = new HashChainAuditLog();
    const engine = new DataFusionEngine(audit, '1.0');
    engine.fuse([mk('A', 100, true)], policy, CUTOFF, 'test');
    const events = audit.readAll();
    expect(events.some(e => e.eventType === 'FUSION_TIME_BLOCKED')).toBe(true);
  });

  it('clean FAIL source without timeBlocked → UNRESOLVED (not TIME_BLOCKED)', () => {
    const engine = new DataFusionEngine(new HashChainAuditLog(), '1.0');
    const failInput = { ...mk('A', 100), qualityStatus: 'FAIL' as const };
    const r = engine.fuse([failInput], policy, CUTOFF, 'test');
    expect(r.fusedValue).toBeNull();
    expect(r.conflictStatus).toBe('UNRESOLVED_CONFLICT');
  });
});
