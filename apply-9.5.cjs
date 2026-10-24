const fs = require('fs');
const path = require('path');
const ok = (m) => console.log('  [OK]   ' + m);

// ????????? [1/4] sma-cross strategy ?????????
fs.mkdirSync('src/backtest/strategies', { recursive: true });
fs.writeFileSync('src/backtest/strategies/sma-cross.ts', `import type { Strategy } from '../event-loop';

export interface SmaCrossOptions {
  readonly fast: number;
  readonly slow: number;
}

function avg(arr: ReadonlyArray<number>): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

export function createSmaCrossStrategy(opts: SmaCrossOptions): Strategy {
  if (!Number.isInteger(opts.fast) || opts.fast < 1) {
    throw new Error('fast must be a positive integer');
  }
  if (!Number.isInteger(opts.slow) || opts.slow < 1) {
    throw new Error('slow must be a positive integer');
  }
  if (opts.fast >= opts.slow) {
    throw new Error('fast must be < slow');
  }

  return (candle, ctx) => {
    const H = ctx.history;
    if (H.length < opts.slow + 1) {
      return { action: 'HOLD', at: candle.event_time_utc };
    }
    const closes = H.map((c) => c.close);
    const fastNow  = avg(closes.slice(-opts.fast));
    const slowNow  = avg(closes.slice(-opts.slow));
    const fastPrev = avg(closes.slice(-opts.fast - 1, -1));
    const slowPrev = avg(closes.slice(-opts.slow - 1, -1));

    if (fastPrev <= slowPrev && fastNow > slowNow) {
      return { action: 'OPEN_LONG', at: candle.event_time_utc, reason: 'sma_cross_up' };
    }
    if (fastPrev >= slowPrev && fastNow < slowNow) {
      return { action: 'CLOSE', at: candle.event_time_utc, reason: 'sma_cross_down' };
    }
    return { action: 'HOLD', at: candle.event_time_utc };
  };
}
`, 'utf8');
ok('strategies/sma-cross.ts');

// ????????? [2/4] cli.ts (pure) ?????????
fs.writeFileSync('src/backtest/cli.ts', `import { readFile } from 'node:fs/promises';
import type { CanonicalCandle } from '../normalization/canonical';
import type { BacktestConfig, BacktestResult } from './types';
import { runBacktest } from './runner';
import { createSmaCrossStrategy } from './strategies/sma-cross';

export interface CliArgs {
  readonly candles: string;
  readonly strategy: 'sma_cross';
  readonly fast: number;
  readonly slow: number;
  readonly timeframe: BacktestConfig['timeframe'];
  readonly from_utc: string;
  readonly to_utc: string;
  readonly initial_capital: number;
  readonly fees_bps: number;
  readonly slippage_bps: number;
}

const USAGE = [
  'Usage: npm run backtest -- [options]',
  '',
  'Required:',
  '  --candles <path>         JSON file with CanonicalCandle[]',
  '  --from <ISO8601>',
  '  --to <ISO8601>',
  '',
  'Optional:',
  '  --strategy <name>        sma_cross (default)',
  '  --fast <n>               SMA fast (default 20)',
  '  --slow <n>               SMA slow (default 50)',
  '  --timeframe <tf>         1m|5m|15m|1h|H3|4h|1d|1w (default 1h)',
  '  --capital <n>            initial capital (default 10000)',
  '  --fees-bps <n>           round-trip fees in bps (default 0)',
  '  --slippage-bps <n>       per-side slippage in bps (default 0)',
].join('\\n');

function getOpt(argv: ReadonlyArray<string>, name: string): string | undefined {
  const i = argv.indexOf('--' + name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined) throw new Error(\`missing value for --\${name}\`);
  return v;
}

function numOpt(argv: ReadonlyArray<string>, name: string, def: number): number {
  const raw = getOpt(argv, name);
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(\`--\${name} must be a number\`);
  return n;
}

export function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const candles = getOpt(argv, 'candles');
  const from_utc = getOpt(argv, 'from');
  const to_utc = getOpt(argv, 'to');
  if (candles === undefined || from_utc === undefined || to_utc === undefined) {
    throw new Error('missing required args\\n\\n' + USAGE);
  }
  const strategy = (getOpt(argv, 'strategy') ?? 'sma_cross') as CliArgs['strategy'];
  if (strategy !== 'sma_cross') {
    throw new Error('unsupported strategy: ' + strategy + ' (only sma_cross)');
  }
  const tf = (getOpt(argv, 'timeframe') ?? '1h') as BacktestConfig['timeframe'];
  const allowed = ['1m', '5m', '15m', '1h', 'H3', '4h', '1d', '1w'];
  if (!allowed.includes(tf)) {
    throw new Error('invalid timeframe: ' + tf);
  }
  return {
    candles,
    strategy,
    fast: numOpt(argv, 'fast', 20),
    slow: numOpt(argv, 'slow', 50),
    timeframe: tf,
    from_utc,
    to_utc,
    initial_capital: numOpt(argv, 'capital', 10_000),
    fees_bps: numOpt(argv, 'fees-bps', 0),
    slippage_bps: numOpt(argv, 'slippage-bps', 0),
  };
}

async function readCandles(filePath: string): Promise<CanonicalCandle[]> {
  const raw = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('candles file must contain a JSON array');
  }
  return parsed as CanonicalCandle[];
}

export async function runCli(argv: ReadonlyArray<string>): Promise<BacktestResult> {
  const args = parseArgs(argv);
  const candles = await readCandles(args.candles);
  const config: BacktestConfig = {
    version: 'bt-cli-v1',
    symbol: 'XAUUSD',
    timeframe: args.timeframe,
    from_utc: args.from_utc,
    to_utc: args.to_utc,
    initial_capital: args.initial_capital,
    fees_bps: args.fees_bps,
    slippage_bps: args.slippage_bps,
    allow_reentry_same_bar: false,
  };
  const strategy = createSmaCrossStrategy({ fast: args.fast, slow: args.slow });
  return runBacktest({ config, candles, strategy });
}

export const CLI_USAGE = USAGE;
`, 'utf8');
ok('cli.ts');

// ????????? [3/4] cli-entry.ts ?????????
fs.writeFileSync('src/backtest/cli-entry.ts', `import { runCli, CLI_USAGE } from './cli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  try {
    const result = await runCli(argv);
    process.stdout.write(JSON.stringify(result, null, 2) + '\\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write('backtest failed: ' + msg + '\\n');
    if (msg.startsWith('missing required args')) {
      process.stderr.write('\\n' + CLI_USAGE + '\\n');
    }
    process.exit(1);
  }
}

void main();
`, 'utf8');
ok('cli-entry.ts');

// ????????? [4/4] tests ?????????
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
  // Uptrend: 100 ? 200 (60 hourly candles) so SMA20 crosses SMA50 quickly.
  const candles = [];
  for (let i = 0; i < 60; i++) {
    const iso = new Date(Date.UTC(2026, 0, 1, i)).toISOString();
    candles.push(mkCandle(iso, 100 + i * 2));
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

  it('sma-cross on uptrend produces at least one trade', async () => {
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
ok('backtest-cli.test.ts');

// ????????? [5/5] package.json ?????????
const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (!pkg.scripts) pkg.scripts = {};
if (pkg.scripts.backtest) {
  console.log('  [WARN] scripts.backtest already exists ? leaving untouched');
} else {
  pkg.scripts.backtest = 'npx tsx src/backtest/cli-entry.ts';
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\\n', 'utf8');
  ok('package.json ? added scripts.backtest');
}

console.log('\\nDONE. ?9.5 files written.');
