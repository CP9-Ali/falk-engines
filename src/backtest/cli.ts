import { readFile } from 'node:fs/promises';
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
].join('\n');

function getOpt(argv: ReadonlyArray<string>, name: string): string | undefined {
  const i = argv.indexOf('--' + name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined) throw new Error(`missing value for --${name}`);
  return v;
}

function numOpt(argv: ReadonlyArray<string>, name: string, def: number): number {
  const raw = getOpt(argv, name);
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
}

export function parseArgs(argv: ReadonlyArray<string>): CliArgs {
  const candles = getOpt(argv, 'candles');
  const from_utc = getOpt(argv, 'from');
  const to_utc = getOpt(argv, 'to');
  if (candles === undefined || from_utc === undefined || to_utc === undefined) {
    throw new Error('missing required args\n\n' + USAGE);
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
