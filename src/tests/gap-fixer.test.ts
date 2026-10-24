import { describe, it, expect, beforeEach } from 'vitest';
import { rmSync } from 'node:fs';
import { GapFixer } from '../ingestion/gap-fixer';
import { ErrorQueue } from '../ingestion/error-queue';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const T = (s: number) => new Date(Date.UTC(2025, 0, 1, 0, 0, s)).toISOString();
const mk = (offsetSec: number): RawDataPoint<Candle> => ({
  sourceId: 'p',
  value: { open: 100, high: 101, low: 99, close: 100, volume: 1 },
  eventTime: T(offsetSec), closedAt: T(offsetSec + 60), arrivalTime: T(offsetSec), availabilityTime: T(offsetSec + 60),
  version: 1, fingerprint: 'f' + offsetSec,
});

const TEST_DIR = '.backup-gap-test';

describe('GapFixer (§5.1)', () => {
  beforeEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('detects gap between missing candles', () => {
    const eq = new ErrorQueue(TEST_DIR);
    const fixer = new GapFixer('twelvedata-ws', '1m', 60_000, eq);
    const points = [mk(0), mk(60), mk(120), mk(600)]; // gap 120→600 = 8 minutes
    const gaps = fixer.detectFromPoints(points);
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.reason).toBe('missing-candles');
    expect(gaps[0]!.status).toBe('PENDING');
  });

  it('no gap when continuous', () => {
    const eq = new ErrorQueue(TEST_DIR);
    const fixer = new GapFixer('twelvedata-ws', '1m', 60_000, eq);
    const points = [mk(0), mk(60), mk(120)];
    expect(fixer.detectFromPoints(points).length).toBe(0);
  });

  it('detects gap from ErrorQueue', () => {
    const eq = new ErrorQueue(TEST_DIR);
    eq.push({ source_id: 'twelvedata-ws', operation: 'history-fetch-1m', reason: 'HTTP 429' });
    const fixer = new GapFixer('twelvedata-ws', '1m', 60_000, eq);
    const gaps = fixer.detectFromErrors();
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.reason).toContain('429');
  });

  it('fix() calls fetcher and reports success', async () => {
    const eq = new ErrorQueue(TEST_DIR);
    const fixer = new GapFixer('twelvedata-ws', '1m', 60_000, eq);
    const gap = fixer.detectFromPoints([mk(0), mk(600)])[0]!;
    let called = false;
    const result = await fixer.fix(gap, async () => {
      called = true;
      return [mk(120), mk(180)];
    });
    expect(called).toBe(true);
    expect(result.success).toBe(true);
    expect(result.fetched_count).toBe(2);
  });

  it('fix() captures fetcher errors', async () => {
    const eq = new ErrorQueue(TEST_DIR);
    const fixer = new GapFixer('twelvedata-ws', '1m', 60_000, eq);
    const gap = fixer.detectFromPoints([mk(0), mk(600)])[0]!;
    const result = await fixer.fix(gap, async () => { throw new Error('network down'); });
    expect(result.success).toBe(false);
    expect(result.error).toContain('network down');
  });
});

// =====================================================================
// Stage 5: needs_refetch integration
// =====================================================================

describe('GapFixer (Stage 5 — needs_refetch integration)', () => {
  beforeEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('marks all-weekend gap as ABANDONED', () => {
    const eq = new ErrorQueue(TEST_DIR);
    const fixer = new GapFixer('twelvedata-ws', '1m', 60_000, eq);
    // Jan 4 2025 = Saturday, Jan 5 = Sunday (Jan 1 2025 = Wednesday)
    const satMidnight = 172800 + 86400;       // Jan 4 00:00 UTC
    const sunMidnight = 172800 + 2 * 86400;   // Jan 5 00:00 UTC
    const gaps = fixer.detectFromPoints([mk(satMidnight), mk(sunMidnight)]);
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.status).toBe('ABANDONED');
    expect(gaps[0]!.reason).toContain('market-closed');
    expect(gaps[0]!.analysis).toBeDefined();
    expect(gaps[0]!.analysis!.needs_refetch).toBe(false);
    expect(gaps[0]!.analysis!.open_candles).toBe(0);
    expect(gaps[0]!.analysis!.closed_candles).toBeGreaterThan(1000);
  });

  it('includes analysis in open-market gap', () => {
    const eq = new ErrorQueue(TEST_DIR);
    const fixer = new GapFixer('twelvedata-ws', '1m', 60_000, eq);
    const gaps = fixer.detectFromPoints([mk(0), mk(60), mk(120), mk(600)]);
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.status).toBe('PENDING');
    expect(gaps[0]!.reason).toBe('missing-candles');  // backward compat
    expect(gaps[0]!.analysis).toBeDefined();
    expect(gaps[0]!.analysis!.gap_type).toBe('UNEXPECTED_FEED_ERROR');
    expect(gaps[0]!.analysis!.open_candles).toBeGreaterThan(0);
    expect(gaps[0]!.analysis!.needs_refetch).toBe(true);
  });

  it('fix() skips ABANDONED gaps without calling fetcher', async () => {
    const eq = new ErrorQueue(TEST_DIR);
    const fixer = new GapFixer('twelvedata-ws', '1m', 60_000, eq);
    const satMidnight = 172800 + 86400;
    const sunMidnight = 172800 + 2 * 86400;
    const gap = fixer.detectFromPoints([mk(satMidnight), mk(sunMidnight)])[0]!;
    let called = false;
    const result = await fixer.fix(gap, async () => { called = true; return []; });
    expect(called).toBe(false);
    expect(result.success).toBe(false);
    expect(result.error).toContain('abandoned');
    expect(result.fetched_count).toBe(0);
  });

  it('detectFromErrors still yields PENDING (no analysis field)', () => {
    const eq = new ErrorQueue(TEST_DIR);
    eq.push({ source_id: 'twelvedata-ws', operation: 'history-fetch-1m', reason: 'HTTP 500' });
    const fixer = new GapFixer('twelvedata-ws', '1m', 60_000, eq);
    const gaps = fixer.detectFromErrors();
    expect(gaps.length).toBe(1);
    expect(gaps[0]!.status).toBe('PENDING');
    expect(gaps[0]!.analysis).toBeUndefined();
  });
});
