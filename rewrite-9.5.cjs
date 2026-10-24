const fs = require('fs');

fs.writeFileSync('src/tests/backtest-cli.test.ts', `import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli, parseArgs } from '../backtest/cli';

function mkCandle(openIso: string, close: number): any {
  return {
    source_id: 'test', source_symbol: 'XAUUSD', canonical_symbol: 'XAUUSD',
    instrument_type: 'spot', price_source: 't', quote_currency: 'USD', base_currency: 'XAU',
    timeframe: '1h', event_time_utc: openIso, source_timestamp: openIso,
    source_timezone: 'UTC', source_timezone_status: 'RESOLVED', time_blocked: false,
    arrival_time_utc: openIso, availability_time_utc: openIso,
    open: close, high: close, low: close, close,
    volume_value: null, volume_semantics: 'UNKNOWN',
    raw_fingerprint: 'fp-' + openIso, lineage_id: 'lin-' + openIso,
    raw_payload_ref: 'raw-' + openIso, normalization_version: 'nv1', processing_version: 'pv1',
  };
}

let tmpDir: string;
let candleFile: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'falk-cli-'));
  candleFile = join(tmpDir, 'candles.json');
  // 30 flat candles @ 100 (SMA5 == SMA10 == 100), then 30 rising +2/bar.
  // Transition produces a genuine SMA5 > SMA10 cross -> OPEN_LONG fires.
  const candles = [];
  for (let i = 0; i < 30; i++) {
    const iso = new Date(Date.UTC(2026, 0, 1, i)).toISOString();
    candles.push(mkCandle(iso, 100));
  }
  for (let i = 0; i < 30; i++) {
    const iso = new Date(Date.UTC(2026, 0, 2, i)).toISOString();
    candles.push(mkCandle(iso, 100 + (i + 1) * 2));
  }
  await writeFile(candleFile, JSON.stringify(candles), 'utf8');
});

afterAll(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

describe('?9.5 ? parseArgs', () => {
  it('throws with usage when required args missing', () => {
    expect(() => parseArgs([])).toThrow(/missing required args/);
  });

  it('throws on invalid timeframe', () => {
    expect(() => parseArgs([
      '--candles', 'x', '--from', 'a', '--to', 'b', '--timeframe', '2h',
    ])).toThrow(/invalid timeframe/);
  });

  it('throws on non-numeric fast', () => {
    expect(() => parseArgs([
      '--candles', 'x', '--from', 'a', '--to', 'b', '--fast', 'abc',
    ])).toThrow(/--fast must be a number/);
  });

  it('defaults applied when optional args missing', () => {
    const a = parseArgs(['--candles', 'x', '--from', 'a', '--to', 'b']);
    expect(a.strategy).toBe('sma_cross');
    expect(a.fast).toBe(20);
    expect(a.slow).toBe(50);
    expect(a.timeframe).toBe('1h');
    expect(a.initial_capital).toBe(10_000);
    expect(a.fees_bps).toBe(0);
    expect(a.slippage_bps).toBe(0);
  });

  it('all optional args parsed', () => {
    const a = parseArgs([
      '--candles', 'x', '--from', 'a', '--to', 'b',
      '--fast', '5', '--slow', '10', '--timeframe', '4h',
      '--capital', '5000', '--fees-bps', '2', '--slippage-bps', '1',
    ]);
    expect(a.fast).toBe(5);
    expect(a.slow).toBe(10);
    expect(a.timeframe).toBe('4h');
    expect(a.initial_capital).toBe(5000);
  });

  it('rejects unsupported strategy', () => {
    expect(() => parseArgs([
      '--candles', 'x', '--from', 'a', '--to', 'b', '--strategy', 'ema',
    ])).toThrow(/unsupported strategy/);
  });
});

describe('?9.5 ? runCli end-to-end', () => {
  it('runs on tmp candles file and returns BacktestResult', async () => {
    const r = await runCli([
      '--candles', candleFile,
      '--from', '2026-01-01T00:00:00Z',
      '--to',   '2026-01-10T00:00:00Z',
      '--fast', '5', '--slow', '10',
    ]);
    expect(r.config_version).toBe('bt-cli-v1');
    expect(r.candles_processed).toBeGreaterThan(0);
    expect(Array.isArray(r.trades)).toBe(true);
    expect(Array.isArray(r.equity_curve)).toBe(true);
    expect(r.metrics).toBeDefined();
    expect(typeof r.final_equity).toBe('number');
  });

  it('sma-cross on flat-then-rise data produces at least one trade', async () => {
    const r = await runCli([
      '--candles', candleFile,
      '--from', '2026-01-01T00:00:00Z',
      '--to',   '2026-01-10T00:00:00Z',
      '--fast', '5', '--slow', '10',
    ]);
    expect(r.trades.length).toBeGreaterThanOrEqual(1);
  });

  it('throws on missing candles file', async () => {
    await expect(runCli([
      '--candles', '/nonexistent/path.json',
      '--from', '2026-01-01T00:00:00Z',
      '--to',   '2026-01-10T00:00:00Z',
    ])).rejects.toThrow();
  });

  it('throws on malformed JSON file', async () => {
    const bad = join(tmpDir, 'bad.json');
    await writeFile(bad, 'not json', 'utf8');
    await expect(runCli([
      '--candles', bad,
      '--from', 'a', '--to', 'b',
    ])).rejects.toThrow();
  });

  it('throws on JSON that is not an array', async () => {
    const notArr = join(tmpDir, 'obj.json');
    await writeFile(notArr, '{"foo":1}', 'utf8');
    await expect(runCli([
      '--candles', notArr,
      '--from', 'a', '--to', 'b',
    ])).rejects.toThrow(/must contain a JSON array/);
  });
});
`, 'utf8');

console.log('  [OK] backtest-cli.test.ts rewritten with 30-flat + 30-rising fixture');
