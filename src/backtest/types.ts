// ?9.0 ? Backtesting interfaces (no runtime deps)

export type Side = 'BUY' | 'SELL';

export type SignalAction = 'OPEN_LONG' | 'OPEN_SHORT' | 'CLOSE' | 'HOLD';

export type TradeOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN';

export interface Signal {
  readonly action: SignalAction;
  /** event_time_utc of the candle that produced this signal. */
  readonly at: string;
  /** Optional price hint from strategy; execution may differ due to slippage. */
  readonly price_hint?: number;
  /** Human-readable audit note. */
  readonly reason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Position {
  readonly side: Side;
  readonly opened_at: string;
  readonly entry_price: number;
  readonly size: number;
  readonly stop_loss?: number;
  readonly take_profit?: number;
}

export interface Trade {
  readonly id: string;
  readonly side: Side;
  readonly opened_at: string;
  readonly closed_at: string;
  readonly entry_price: number;
  readonly exit_price: number;
  readonly size: number;
  readonly pnl_abs: number;
  readonly pnl_pct: number;
  readonly fees_abs: number;
  readonly slippage_abs: number;
  readonly outcome: TradeOutcome;
  readonly reason_open?: string;
  readonly reason_close?: string;
  readonly lineage_ids?: ReadonlyArray<string>;
}

export interface EquityPoint {
  readonly time: string;
  readonly equity: number;
  readonly drawdown_pct: number;
}

export interface BacktestConfig {
  readonly version: string;
  readonly symbol: 'XAUUSD';
  readonly timeframe: '1m' | '5m' | '15m' | '1h' | 'H3' | '4h' | '1d' | '1w';
  readonly from_utc: string;
  readonly to_utc: string;
  readonly initial_capital: number;
  /** Round-trip fees in basis points. 0 = disabled. */
  readonly fees_bps: number;
  /** Per-side slippage in basis points. 0 = disabled. */
  readonly slippage_bps: number;
  /** Cap on notional / capital per position. 1.0 = full capital. */
  readonly max_position_size_pct?: number;
  /** When false, a CLOSE signal does not allow re-entry on the same bar. */
  readonly allow_reentry_same_bar: boolean;
}

export interface BacktestMetrics {
  readonly total_trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly breakevens: number;
  readonly win_rate: number;
  readonly profit_factor: number | null;
  readonly max_drawdown_pct: number;
  readonly sharpe_ratio: number | null;
  readonly sortino_ratio: number | null;
  readonly total_pnl_abs: number;
  readonly total_pnl_pct: number;
  readonly total_fees_abs: number;
  readonly avg_hold_duration_ms: number | null;
}

export interface BacktestResult {
  readonly config_version: string;
  readonly ran_at: string;
  readonly from_utc: string;
  readonly to_utc: string;
  readonly candles_processed: number;
  readonly candles_skipped_gap: number;
  readonly candles_skipped_not_final: number;
  readonly trades: ReadonlyArray<Trade>;
  readonly equity_curve: ReadonlyArray<EquityPoint>;
  readonly final_equity: number;
  readonly metrics: BacktestMetrics;
}
