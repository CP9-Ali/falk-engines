import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ReplayEngine } from '../replay/replay-engine';
import { EvidenceBuilder } from '../evidence/evidence-chain';
import type { CanonicalCandle } from '../normalization/canonical';
import type { FeatureComputeResult } from '../feature-engineering/types';

const TEST_DIR = '.backup-replay-test';

describe('ReplayEngine (Evidence+Replay)', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, 'twelvedata-ws', '1m'), { recursive: true });
    writeFileSync(
      join(TEST_DIR, 'twelvedata-ws', '1m', 'abc123.json'),
      JSON.stringify({
        source_id: 'twelvedata-ws',
        source_symbol: 'XAU/USD',
        timeframe: '1m',
        event_time_utc: '2026-10-23T10:00:00.000Z',
        payload: { datetime: '2026-10-23 10:00:00', open: '4015.00', high: '4018.00', low: '4014.00', close: '4017.00' },
        payload_hash: 'hash1',
        lineage_id: 'abc123',
      }),
    );
  });

  afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('lists available snapshots', () => {
    const e = new ReplayEngine(TEST_DIR);
    const list = e.listAvailable();
    expect(list.length).toBe(1);
    expect(list[0]!.source).toBe('twelvedata-ws');
    expect(list[0]!.count).toBe(1);
  });

  it('loads records with filters', () => {
    const e = new ReplayEngine(TEST_DIR);
    const recs = e.load({ source_id: 'twelvedata-ws', timeframe: '1m' });
    expect(recs.length).toBe(1);
    expect(recs[0]!.lineage_id).toBe('abc123');
  });

  it('converts record to candle', () => {
    const e = new ReplayEngine(TEST_DIR);
    const recs = e.load({ source_id: 'twelvedata-ws', timeframe: '1m' });
    const c = e.toCandle(recs[0]!);
    expect(c).not.toBeNull();
    expect(c!.value.close).toBe(4017);
    expect(c!.value.open).toBe(4015);
  });

  it('filters by date range', () => {
    const e = new ReplayEngine(TEST_DIR);
    const before = e.load({ from_utc: '2026-10-23T09:00:00.000Z', to_utc: '2026-10-23T09:30:00.000Z' });
    expect(before.length).toBe(0);
    const inside = e.load({ from_utc: '2026-10-23T09:30:00.000Z', to_utc: '2026-10-23T10:30:00.000Z' });
    expect(inside.length).toBe(1);
  });
});

describe('EvidenceBuilder', () => {
  it('builds complete chain', () => {
    const b = new EvidenceBuilder();
    const canonical = {
      source_id: 'twelvedata-ws', source_symbol: 'XAU/USD', canonical_symbol: 'XAUUSD' as const,
      timeframe: '1m' as const, event_time_utc: '2026-10-23T10:00:00.000Z',
      source_timestamp: '2026-10-23T10:00:00.000Z', source_timezone: 'UTC',
      arrival_time_utc: '2026-10-23T10:01:00.000Z', availability_time_utc: '2026-10-23T10:01:00.000Z',
      open: 4015, high: 4018, low: 4014, close: 4017, volume_value: 0,
      volume_semantics: 'UNKNOWN' as const, raw_fingerprint: 'fp123',
      lineage_id: 'abc123', raw_payload_ref: '/tmp/nonexistent.json',
      normalization_version: '1.0.0', processing_version: 'falk-1.0.0',
    } as CanonicalCandle;

    const feature: FeatureComputeResult = {
      featureId: 'sma_20_1m', definitionVersion: '1.0.0', status: 'VALID', value: 4016.5,
      asOfCutoff: '2026-10-23T10:00:00.000Z', computedAt: '2026-10-23T10:00:01.000Z',
      availabilityTime: '2026-10-23T10:00:00.000Z',
      snapshotRef: { snapshotId: 's1', contentFingerprint: 'cf1' },
      fusionPolicyVersion: 'p1',
    };

    const chain = b.build(feature, canonical);
    expect(chain.nodes.length).toBe(3);
    expect(chain.nodes[0]!.stage).toBe('raw');
    expect(chain.nodes[1]!.stage).toBe('normalized');
    expect(chain.nodes[2]!.stage).toBe('feature');
    expect(chain.complete).toBe(false);
  });
});