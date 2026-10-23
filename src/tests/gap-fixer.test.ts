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