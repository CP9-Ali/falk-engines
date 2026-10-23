import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HistoryRestorer } from '../ingestion/history-restorer';

const TEST_DIR = '.backup-restore-test';

describe('HistoryRestorer (recovery)', () => {
  beforeAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(join(TEST_DIR, 'twelvedata-ws', '1m'), { recursive: true });

    // اكتب 3 raw files بصيغة TwelveData
    for (let i = 0; i < 3; i++) {
      writeFileSync(
        join(TEST_DIR, 'twelvedata-ws', '1m', 'file' + i + '.json'),
        JSON.stringify({
          source_id: 'twelvedata-ws',
          source_symbol: 'XAU/USD',
          timeframe: '1m',
          event_time_utc: new Date(Date.UTC(2025, 0, 1, 0, i, 0)).toISOString(),
          payload: {
            datetime: '2025-01-01 00:0' + i + ':00',
            open: '4000', high: '4010', low: '3990', close: '4005',
          },
          lineage_id: 'lineage-' + i,
        }),
      );
    }
  });

  afterAll(() => rmSync(TEST_DIR, { recursive: true, force: true }));

  it('restores 3 candles from raw', () => {
    const r = new HistoryRestorer(TEST_DIR);
    const candles = r.restore('twelvedata-ws', '1m');
    expect(candles.length).toBe(3);
    expect(candles[0]!.value.close).toBe(4005);
  });

  it('returns empty for missing timeframe', () => {
    const r = new HistoryRestorer(TEST_DIR);
    expect(r.restore('twelvedata-ws', '5m')).toEqual([]);
  });

  it('caps at maxBars', () => {
    const r = new HistoryRestorer(TEST_DIR);
    const candles = r.restore('twelvedata-ws', '1m', 2);
    expect(candles.length).toBe(2);
  });

  it('sorts by eventTime', () => {
    const r = new HistoryRestorer(TEST_DIR);
    const candles = r.restore('twelvedata-ws', '1m');
    for (let i = 1; i < candles.length; i++) {
      const prev = new Date(candles[i - 1]!.eventTime).getTime();
      const cur = new Date(candles[i]!.eventTime).getTime();
      expect(cur).toBeGreaterThanOrEqual(prev);
    }
  });
});