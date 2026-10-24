const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// ????????? [1/2] execution.ts ?????????
fs.writeFileSync('src/backtest/execution.ts', `import type {
  BacktestConfig,
  Trade,
  EquityPoint,
  TradeOutcome,
  Side,
} from './types';
import type { SignalEvent } from './event-loop';

export interface ExecutionInput {
  readonly config: BacktestConfig;
  readonly events: ReadonlyArray<SignalEvent>;
}

export interface ExecutionResult {
  readonly trades: ReadonlyArray<Trade>;
  readonly equity_curve: ReadonlyArray<EquityPoint>;
  readonly final_equity: number;
  readonly open_position_at_end: boolean;
}

interface OpenPos {
  readonly side: Side;
  readonly opened_at: string;
  readonly entry_price_raw: number;
  readonly entry_price: number;
  readonly size: number;
  readonly fees_open: number;
  readonly reason_open?: string;
  readonly lineage_ids: string[];
}

const BPS = 10_000;

function slipUp(price: number, bps: number): number {
  return price * (1 + bps / BPS);
}
function slipDown(price: number, bps: number): number {
  return price * (1 - bps / BPS);
}

function feesOn(notional: number, bps: number): number {
  return (notional * bps) / BPS;
}

function outcomeOf(pnl_abs: number, tolerance = 1e-9): TradeOutcome {
  if (Math.abs(pnl_abs) <= tolerance) return 'BREAKEVEN';
  return pnl_abs > 0 ? 'WIN' : 'LOSS';
}

function idFor(n: number): string {
  return 'trade-' + String(n).padStart(6, '0');
}

export function runExecution(input: ExecutionInput): ExecutionResult {
  const { config, events } = input;
  const maxPct = config.max_position_size_pct ?? 1.0;

  const trades: Trade[] = [];
  const equity_curve: EquityPoint[] = [];

  let equity = config.initial_capital;
  let peak_equity = equity;
  let openPos: OpenPos | null = null;
  let tradeCount = 0;

  function recordEquity(time: string): void {
    if (equity > peak_equity) peak_equity = equity;
    const dd = peak_equity === 0 ? 0 : ((peak_equity - equity) / peak_equity) * 100;
    equity_curve.push({ time, equity, drawdown_pct: dd });
  }

  function closePosition(exit_time: string, exit_price_raw: number, reason_close?: string): void {
    if (openPos === null) return;

    const exit_price =
      openPos.side === 'BUY'
        ? slipDown(exit_price_raw, config.slippage_bps)
        : slipUp(exit_price_raw, config.slippage_bps);

    const exit_notional = exit_price * openPos.size;
    const fees_close = feesOn(exit_notional, config.fees_bps);
    const fees_total = openPos.fees_open + fees_close;

    const gross =
      openPos.side === 'BUY'
        ? (exit_price - openPos.entry_price) * openPos.size
        : (openPos.entry_price - exit_price) * openPos.size;

    const pnl_abs = gross - fees_total;
    const notional_in = openPos.entry_price * openPos.size;
    const pnl_pct = notional_in === 0 ? 0 : pnl_abs / notional_in;

    equity += pnl_abs;

    const slippage_abs =
      Math.abs(openPos.entry_price - openPos.entry_price_raw) * openPos.size +
      Math.abs(exit_price - exit_price_raw) * openPos.size;

    trades.push({
      id: idFor(++tradeCount),
      side: openPos.side,
      opened_at: openPos.opened_at,
      closed_at: exit_time,
      entry_price: openPos.entry_price,
      exit_price,
      size: openPos.size,
      pnl_abs,
      pnl_pct,
      fees_abs: fees_total,
      slippage_abs,
      outcome: outcomeOf(pnl_abs),
      ...(openPos.reason_open !== undefined ? { reason_open: openPos.reason_open } : {}),
      ...(reason_close !== undefined ? { reason_close } : {}),
      lineage_ids: openPos.lineage_ids,
    });

    openPos = null;
    recordEquity(exit_time);
  }

  function openPosition(
    side: Side,
    open_time: string,
    price_raw: number,
    reason?: string,
    lineage?: string,
  ): void {
    if (openPos !== null) return;
    if (equity <= 0) return;

    const entry_price =
      side === 'BUY'
        ? slipUp(price_raw, config.slippage_bps)
        : slipDown(price_raw, config.slippage_bps);
    if (entry_price <= 0) return;

    const notional = equity * maxPct;
    const size = notional / entry_price;
    if (!Number.isFinite(size) || size <= 0) return;

    const fees_open = feesOn(notional, config.fees_bps);

    openPos = {
      side,
      opened_at: open_time,
      entry_price_raw: price_raw,
      entry_price,
      size,
      fees_open,
      ...(reason !== undefined ? { reason_open: reason } : {}),
      lineage_ids: lineage !== undefined ? [lineage] : [],
    };
  }

  // Start equity curve at initial capital.
  const startTime =
    events.length > 0 && events[0] !== undefined
      ? events[0].candle.event_time_utc
      : config.from_utc;
  recordEquity(startTime);

  for (const ev of events) {
    const price = ev.candle.close;
    const closeTime = ev.close_time;
    const lineage = ev.candle.lineage_id;

    switch (ev.signal.action) {
      case 'HOLD':
        break;
      case 'OPEN_LONG':
        openPosition('BUY', closeTime, price, ev.signal.reason, lineage);
        break;
      case 'OPEN_SHORT':
        openPosition('SELL', closeTime, price, ev.signal.reason, lineage);
        break;
      case 'CLOSE':
        closePosition(closeTime, price, ev.signal.reason);
        break;
    }
  }

  let openPosition_at_end = false;
  if (openPos !== null) {
    openPosition_at_end = true;
    const last = events[events.length - 1];
    const lastPrice = last !== undefined ? last.candle.close : 0;
    const lastTime = last !== undefined ? last.close_time : config.to_utc;
    closePosition(lastTime, lastPrice, 'END_OF_BACKTEST');
  }

  return {
    trades,
    equity_curve,
    final_equity: equity,
    open_position_at_end,
  };
}
`, 'utf8');
ok('execution.ts');

// ????????? [2/2] test file ?????????
fs.writeFileSync('src/tests/backtest-execution.test.ts', `import { describe, it, expect } from 'vitest';
import { runExecution } from '../backtest/execution';
import type { SignalEvent } from '../backtest/event-loop';
import type { BacktestConfig, SignalAction } from '../backtest/types';
import type { CanonicalCandle } from '../normalization/canonical';

function mkCandle(openIso: string, close: number, closeTime: string): CanonicalCandle {
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
  } as any;
}

function ev(action: SignalAction, openIso: string, close: number, closeTime: string, reason?: string): SignalEvent {
  const c = mkCandle(openIso, close, closeTime);
  return {
    signal: { action, at: openIso, ...(reason !== undefined ? { reason } : {}) },
    candle: c,
    close_time: closeTime,
  };
}

const config: BacktestConfig = {
  version: 'bt-v1', symbol: 'XAUUSD', timeframe: '1h',
  from_utc: '2026-01-01T00:00:00Z', to_utc: '2026-01-02T00:00:00Z',
  initial_capital: 10_000, fees_bps: 0, slippage_bps: 0,
  allow_reentry_same_bar: false,
};

describe('?9.2 ? runExecution basics', () => {
  it('empty events ? initial capital only', () => {
    const r = runExecution({ config, events: [] });
    expect(r.trades).toEqual([]);
    expect(r.equity_curve).toHaveLength(1);
    expect(r.final_equity).toBe(10_000);
  });

  it('HOLD only ? no trades', () => {
    const r = runExecution({ config, events: [
      ev('HOLD', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('HOLD', '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(0);
    expect(r.final_equity).toBe(10_000);
  });

  it('OPEN_LONG then CLOSE with profit', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.outcome).toBe('WIN');
    expect(r.trades[0]!.entry_price).toBe(2000);
    expect(r.trades[0]!.exit_price).toBe(2010);
    expect(r.final_equity).toBeGreaterThan(10_000);
  });

  it('OPEN_SHORT then CLOSE with profit on price drop', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_SHORT', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',      '2026-01-01T01:00:00Z', 1990, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.outcome).toBe('WIN');
    expect(r.trades[0]!.pnl_abs).toBeGreaterThan(0);
  });

  it('OPEN_SHORT loses when price rises', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_SHORT', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',      '2026-01-01T01:00:00Z', 2020, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.outcome).toBe('LOSS');
    expect(r.trades[0]!.pnl_abs).toBeLessThan(0);
  });
});

describe('?9.2 ? slippage and fees', () => {
  it('slippage increases BUY entry, decreases BUY exit', () => {
    const cfg = { ...config, slippage_bps: 10 };   // 0.1%
    const r = runExecution({ config: cfg, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.entry_price).toBeCloseTo(2002, 5);   // 2000 * 1.001
    expect(r.trades[0]!.exit_price).toBeCloseTo(2008.99, 2); // 2010 * 0.999
    expect(r.trades[0]!.slippage_abs).toBeGreaterThan(0);
  });

  it('slippage decreases SELL entry, increases SELL exit', () => {
    const cfg = { ...config, slippage_bps: 10 };
    const r = runExecution({ config: cfg, events: [
      ev('OPEN_SHORT', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',      '2026-01-01T01:00:00Z', 1990, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.entry_price).toBeCloseTo(1998, 5);   // 2000 * 0.999
    expect(r.trades[0]!.exit_price).toBeCloseTo(1990.99, 2); // 1990 * 1.001
  });

  it('fees reduce pnl and appear in fees_abs', () => {
    const cfg = { ...config, fees_bps: 2 };   // 2 bps round-trip
    const r = runExecution({ config: cfg, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2000, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.fees_abs).toBeGreaterThan(0);
    expect(r.trades[0]!.pnl_abs).toBeLessThan(0);   // no price change, fees eat
    expect(r.trades[0]!.outcome).toBe('LOSS');
  });
});

describe('?9.2 ? position sizing and ignored signals', () => {
  it('max_position_size_pct halves the size', () => {
    const cfg = { ...config, max_position_size_pct: 0.5 };
    const full = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    const half = runExecution({ config: cfg, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(half.trades[0]!.size).toBeCloseTo(full.trades[0]!.size / 2, 5);
    expect(half.final_equity).toBeLessThan(full.final_equity);
  });

  it('OPEN_LONG with position open ? ignored', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('OPEN_LONG', '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
      ev('CLOSE',     '2026-01-01T02:00:00Z', 2020, '2026-01-01T03:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.entry_price).toBe(2000);
  });

  it('CLOSE without position ? ignored', () => {
    const r = runExecution({ config, events: [
      ev('CLOSE', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(0);
  });
});

describe('?9.2 ? end-of-backtest forced close', () => {
  it('open position at end is closed with END_OF_BACKTEST', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]!.reason_close).toBe('END_OF_BACKTEST');
    expect(r.open_position_at_end).toBe(true);
  });

  it('closed positions before end ? open_position_at_end false', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.open_position_at_end).toBe(false);
  });
});

describe('?9.2 ? equity curve and drawdown', () => {
  it('equity_curve starts at initial capital', () => {
    const r = runExecution({ config, events: [
      ev('HOLD', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
    ]});
    expect(r.equity_curve[0]!.equity).toBe(10_000);
    expect(r.equity_curve[0]!.drawdown_pct).toBe(0);
  });

  it('winning trade ? no drawdown', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.equity_curve[r.equity_curve.length - 1]!.drawdown_pct).toBe(0);
  });

  it('losing trade ? positive drawdown', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 1990, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.equity_curve[r.equity_curve.length - 1]!.drawdown_pct).toBeGreaterThan(0);
  });

  it('multiple trades produce multiple equity points', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
      ev('OPEN_LONG', '2026-01-01T02:00:00Z', 2010, '2026-01-01T03:00:00Z'),
      ev('CLOSE',     '2026-01-01T03:00:00Z', 2005, '2026-01-01T04:00:00Z'),
    ]});
    expect(r.trades).toHaveLength(2);
    expect(r.equity_curve).toHaveLength(3);   // initial + 2 closes
  });
});

describe('?9.2 ? misc', () => {
  it('lineage_ids captured from open candle', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.lineage_ids).toEqual(['lin-2026-01-01T00:00:00Z']);
  });

  it('breakeven when price unchanged and no fees', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2000, '2026-01-01T02:00:00Z'),
    ]});
    expect(r.trades[0]!.outcome).toBe('BREAKEVEN');
  });

  it('trade ids are sequential', () => {
    const r = runExecution({ config, events: [
      ev('OPEN_LONG', '2026-01-01T00:00:00Z', 2000, '2026-01-01T01:00:00Z'),
      ev('CLOSE',     '2026-01-01T01:00:00Z', 2010, '2026-01-01T02:00:00Z'),
      ev('OPEN_LONG', '2026-01-01T02:00:00Z', 2010, '2026-01-01T03:00:00Z'),
      ev('CLOSE',     '2026-01-01T03:00:00Z', 2020, '2026-01-01T04:00:00Z'),
    ]});
    expect(r.trades[0]!.id).toBe('trade-000001');
    expect(r.trades[1]!.id).toBe('trade-000002');
  });
});
`, 'utf8');
ok('backtest-execution.test.ts');

console.log('\nDONE. ?9.2 files written.');
