import { describe, it, expect } from 'vitest';
import {
  buildMetadata,
  computeParametersHash,
  isFinal,
  assertNoLookahead,
  missingFeature,
  assertReproducible,
} from '../feature-engineering/metadata';

const base = {
  feature_id: 'rsi',
  feature_version: '1.0.0',
  symbol: 'XAUUSD',
  timeframe: 'H1',
  unit: 'index',
  parameters: { period: 14 },
  data_snapshot_id: 'snap-001',
};

describe('Feature acceptance: identity & reproducibility', () => {
  it('carries feature_id, feature_version, parameters_hash, data_snapshot_id', () => {
    const m = buildMetadata({ ...base, value: 55.3, calculated_at_utc: '2026-01-01T10:00:00Z', valid_at_utc: '2026-01-01T10:00:00Z', status: 'final' });
    expect(m.feature_id).toBe('rsi');
    expect(m.feature_version).toBe('1.0.0');
    expect(m.parameters_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(m.data_snapshot_id).toBe('snap-001');
  });

  it('parameters_hash stable regardless of key order', () => {
    expect(computeParametersHash({ a: 1, b: 2 })).toBe(computeParametersHash({ b: 2, a: 1 }));
  });

  it('same inputs produce same value', () => {
    const build = () => buildMetadata({ ...base, value: 42, calculated_at_utc: '2026-01-01T10:00:00Z', valid_at_utc: '2026-01-01T10:00:00Z', status: 'final' });
    assertReproducible(build(), build());
  });
});

describe('Feature acceptance: lookahead prevention', () => {
  it('rejects calculated_at before valid_at', () => {
    const m = buildMetadata({ ...base, value: 1, calculated_at_utc: '2026-01-01T09:00:00Z', valid_at_utc: '2026-01-01T10:00:00Z', status: 'final' });
    expect(() => assertNoLookahead(m)).toThrow(/lookahead/);
  });

  it('accepts calculated_at after valid_at', () => {
    const m = buildMetadata({ ...base, value: 1, calculated_at_utc: '2026-01-01T10:00:05Z', valid_at_utc: '2026-01-01T10:00:00Z', status: 'final' });
    expect(() => assertNoLookahead(m)).not.toThrow();
  });
});

describe('Feature acceptance: missing data not fabricated', () => {
  it('missing feature has null value and status=missing', () => {
    const m = missingFeature({ ...base, calculated_at_utc: '2026-01-01T10:00:00Z', valid_at_utc: '2026-01-01T10:00:00Z', warnings: ['insufficient_data'] });
    expect(m.value).toBeNull();
    expect(m.status).toBe('missing');
    expect(m.warnings).toContain('insufficient_data');
    expect(isFinal(m)).toBe(false);
  });
});

describe('Feature acceptance: provisional vs final', () => {
  it('provisional is not final', () => {
    const m = buildMetadata({ ...base, value: 50, calculated_at_utc: '2026-01-01T10:00:00Z', valid_at_utc: '2026-01-01T10:00:00Z', status: 'provisional' });
    expect(isFinal(m)).toBe(false);
  });

  it('final with null value flags warning', () => {
    const m = buildMetadata({ ...base, value: null, calculated_at_utc: '2026-01-01T10:00:00Z', valid_at_utc: '2026-01-01T10:00:00Z', status: 'final' });
    expect(m.warnings).toContain('value_null_but_final');
  });
});

describe('Feature acceptance: lineage', () => {
  it('records sources and derived_from', () => {
    const m = buildMetadata({ ...base, value: 1, calculated_at_utc: '2026-01-01T10:00:00Z', valid_at_utc: '2026-01-01T10:00:00Z', status: 'final', lineage: { sources: ['ingest-A'], derived_from: ['sma-20'] } });
    expect(m.lineage.sources).toContain('ingest-A');
    expect(m.lineage.derived_from).toContain('sma-20');
  });
});
