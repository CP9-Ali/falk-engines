import { describe, it, expect } from 'vitest';
import { migrateLegacyStatus, migrateLegacyReport } from '../data-fusion/migrate';
import { FUSION_STATUS_VALUES, FusionStatus } from '../data-fusion/types';

describe('?8.0 ? FusionStatus union', () => {
  it('exposes exactly 6 canonical statuses', () => {
    expect(FUSION_STATUS_VALUES).toHaveLength(6);
    expect(new Set(FUSION_STATUS_VALUES).size).toBe(6);
  });
});

describe('?8.0 ? legacy status migration', () => {
  it('RESOLVED_BY_TOLERANCE -> CONSISTENT', () =>
    expect(migrateLegacyStatus('RESOLVED_BY_TOLERANCE')).toBe('CONSISTENT'));
  it('RESOLVED_BY_POLICY -> CONSISTENT', () =>
    expect(migrateLegacyStatus('RESOLVED_BY_POLICY')).toBe('CONSISTENT'));
  it('UNRESOLVED -> UNRESOLVED_CONFLICT', () =>
    expect(migrateLegacyStatus('UNRESOLVED')).toBe('UNRESOLVED_CONFLICT'));
  it('TIME_BLOCKED -> INSUFFICIENT_COMPARABLE_DATA', () =>
    expect(migrateLegacyStatus('TIME_BLOCKED')).toBe('INSUFFICIENT_COMPARABLE_DATA'));
  it('NONE + 1 source -> INSUFFICIENT_COMPARABLE_DATA', () =>
    expect(migrateLegacyStatus('NONE', { totalSources: 1, blockedSources: 0 }))
      .toBe('INSUFFICIENT_COMPARABLE_DATA'));
  it('NONE + 2 sources -> CONSISTENT', () =>
    expect(migrateLegacyStatus('NONE', { totalSources: 2, blockedSources: 0 }))
      .toBe('CONSISTENT'));
});

describe('?8.0 ? legacy report migration', () => {
  it('produces FusionReport with deltas: []', () => {
    const r = migrateLegacyReport({ conflict_status: 'UNRESOLVED', sources_used: 2 });
    const s: FusionStatus = r.conflict_status;
    expect(s).toBe('UNRESOLVED_CONFLICT');
    expect(r.deltas).toEqual([]);
  });
});
