import { describe, it, expect } from 'vitest';
import { buildEvidenceSnapshot, type EvidenceChain } from '../evidence/evidence-chain';

function mkChain(id: string, complete: boolean): EvidenceChain {
  return {
    feature_id: id,
    lineage_id: 'lin-' + id,
    complete,
    nodes: [
      { stage: 'raw', ref_id: 'r1', description: 'test', payload_hash: 'h1', created_at_utc: '2025-01-01T00:00:00Z' },
      { stage: 'normalized', ref_id: 'r2', description: 'test', payload_hash: 'h2', created_at_utc: '2025-01-01T00:00:00Z' },
      { stage: 'feature', ref_id: 'r3', description: 'test', payload_hash: 'h3', created_at_utc: '2025-01-01T00:00:00Z' },
    ],
  };
}

describe('EvidenceSnapshot (§12)', () => {
  it('builds snapshot with all chains complete', () => {
    const chains = [mkChain('sma', true), mkChain('rsi', true)];
    const snap = buildEvidenceSnapshot('fp1', '1m', '2025-01-01T00:00:00Z', chains);
    expect(snap.snapshot_id).toMatch(/^esnap-/);
    expect(snap.chains.length).toBe(2);
    expect(snap.chains_complete).toBe(2);
    expect(snap.chains_incomplete).toBe(0);
    expect(snap.complete).toBe(true);
  });

  it('marks incomplete when any chain is incomplete', () => {
    const chains = [mkChain('sma', true), mkChain('rsi', false)];
    const snap = buildEvidenceSnapshot('fp1', '1m', '2025-01-01T00:00:00Z', chains);
    expect(snap.chains_complete).toBe(1);
    expect(snap.chains_incomplete).toBe(1);
    expect(snap.complete).toBe(false);
  });

  it('empty chains not complete', () => {
    const snap = buildEvidenceSnapshot('fp1', '1m', '2025-01-01T00:00:00Z', []);
    expect(snap.complete).toBe(false);
  });
});