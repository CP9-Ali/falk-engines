import type {
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
    open_position_at_end: openPosition_at_end,
  };
}
