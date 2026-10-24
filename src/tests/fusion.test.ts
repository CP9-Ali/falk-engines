import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { DataFusionEngine } from '../data-fusion/engine';
import type { FusionPolicy } from '../data-fusion/types';

const T = '2025-01-01T00:00:00.000Z';
const base = (id: string, close: number, q: 'PASS' | 'FAIL' = 'PASS', avail = T) => ({
  sourceId: id, value: { close }, eventTime: T, availabilityTime: avail, sourceVersion: 1, qualityStatus: q,
});

const mk = (over: Partial<FusionPolicy> = {}): FusionPolicy => ({
  policyVersion: 'p', priorityOrder: ['A', 'B', 'C'],
  conflictStrategy: 'STRICT_PRIORITY', toleranceBps: 50, allowSourceSwitching: true, ...over,
});

describe('DataFusionEngine', () => {
  it('drops quality-FAIL sources', () => {
    const r = new DataFusionEngine(new HashChainAuditLog(), '1.0').fuse(
      [base('A', 100), base('B', 100.1), base('C', 500, 'FAIL')], mk(), T, 'test');
    expect(r.fusedValue?.close).toBe(100);
    expect(r.droppedSources.length).toBe(1);
  });

  it('strict priority picks highest priority on conflict', () => {
    const r = new DataFusionEngine(new HashChainAuditLog(), '1.0').fuse(
      [base('A', 100), base('B', 200)], mk(), T, 'test');
    expect(r.fusedValue?.close).toBe(100);
    expect(r.conflictStatus).toBe('CONSISTENT');
  });

  it('REJECT_ON_CONFLICT returns null on unresolved conflict', () => {
    const r = new DataFusionEngine(new HashChainAuditLog(), '1.0').fuse(
      [base('A', 100), base('B', 200)], mk({ conflictStrategy: 'REJECT_ON_CONFLICT' }), T, 'test');
    expect(r.fusedValue).toBeNull();
    expect(r.conflictStatus).toBe('UNRESOLVED_CONFLICT');
  });

  it('excludes points not available at cutoff', () => {
    const r = new DataFusionEngine(new HashChainAuditLog(), '1.0').fuse(
      [base('A', 100), base('B', 999, 'PASS', '2025-01-01T05:00:00.000Z')], mk(), T, 'test');
    expect(r.fusedValue?.close).toBe(100);
  });

  it('refuses weighted average without approval', () => {
    expect(() => new DataFusionEngine(new HashChainAuditLog(), '1.0').fuse(
      [base('A', 100), base('B', 200)], mk({ conflictStrategy: 'WEIGHTED_AVERAGE_REQUIRES_APPROVAL' }), T, 'test',
    )).toThrow();
  });
});