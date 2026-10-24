import type { RawDataPoint } from '../core/types';
import { engineVersion } from '../core/versions';
import { resolveUnits, type PriceUnit, type VolumeUnit } from './unit-normalizer';
import type { Candle } from '../data-quality/checks/base';

export type VolumeSemantics = 'TICK' | 'REAL' | 'CONTRACT' | 'UNKNOWN';
export type CanonicalTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
export type InstrumentType = 'SPOT' | 'CFD' | 'FUTURE' | 'CRYPTO' | 'INDEX' | 'AGGREGATED' | 'UNKNOWN';

export interface SourceMetadata {
  readonly instrument_type: InstrumentType;
  readonly price_source: string;
  readonly quote_currency: string;
  readonly base_currency: string;
}

/**
 * Stage 8A (§7.1): per-source instrument metadata.
 * Similar symbol names do NOT prove identical instruments.
 */
export const SOURCE_METADATA: Record<string, SourceMetadata> = {
  'twelvedata-ws': { instrument_type: 'SPOT',       price_source: 'FX:TWELVEDATA', quote_currency: 'USD',     base_currency: 'XAU' },
  'binance-paxg':  { instrument_type: 'CRYPTO',     price_source: 'CEX:BINANCE',   quote_currency: 'USDT',    base_currency: 'PAXG' },
  'fcsapi-xau':    { instrument_type: 'SPOT',       price_source: 'FX:FCSAPI',     quote_currency: 'USD',     base_currency: 'XAU' },
  'xaus-api':      { instrument_type: 'UNKNOWN',    price_source: 'UNKNOWN:xaus-api', quote_currency: 'UNKNOWN', base_currency: 'XAU' },
  'h3-aggregated': { instrument_type: 'AGGREGATED', price_source: 'AGG:h3',        quote_currency: 'USD',     base_currency: 'XAU' },
};

const UNKNOWN_METADATA: SourceMetadata = {
  instrument_type: 'UNKNOWN',
  price_source: 'UNKNOWN',
  quote_currency: 'UNKNOWN',
  base_currency: 'UNKNOWN',
};

export function getSourceMetadata(sourceId: string): SourceMetadata {
  return SOURCE_METADATA[sourceId] ?? UNKNOWN_METADATA;
}


export interface CanonicalCandle {
  readonly source_id: string;
  readonly source_symbol: string;
  readonly canonical_symbol: 'XAUUSD';
  readonly instrument_type: InstrumentType;
  readonly price_source: string;
  readonly quote_currency: string;
  readonly base_currency: string;
  readonly timeframe: CanonicalTimeframe;
  readonly event_time_utc: string;
  readonly source_timestamp: string;
  readonly source_timezone: string;
  /** Stage 1: RESOLVED if timezone known, UNKNOWN otherwise */
  readonly source_timezone_status: 'RESOLVED' | 'UNKNOWN';
  /** Stage 1: true when source_timezone is UNKNOWN (blocks time-sensitive comparisons) */
  readonly time_blocked: boolean;
  readonly arrival_time_utc: string;
  readonly availability_time_utc: string;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume_value: number | null;
  readonly volume_semantics: VolumeSemantics;
  readonly raw_fingerprint: string;
  readonly lineage_id: string;
  readonly raw_payload_ref: string;
  readonly normalization_version: string;
  readonly processing_version: string;
  readonly decimal_places?: number;
  readonly tick_size?: number;
  readonly price_unit?: string;
  readonly volume_unit?: string;
  /** §7: received_at_utc - when FALK received the record */
  readonly received_at_utc?: string;
  /** §7: processed_at_utc - when normalization completed */
  readonly processed_at_utc?: string;
  /** §7: candle_open_time_utc - explicit candle open */
  readonly candle_open_time_utc?: string;
  /** §7: candle_close_time_utc - explicit close (null if unknown) */
  readonly candle_close_time_utc?: string | null;
  /** §7 + §5.4: is_final - true if candle is closed, not updatable */
  readonly is_final?: boolean;
}

export const VOLUME_SEMANTICS_BY_SOURCE: Record<string, VolumeSemantics> = {
  'twelvedata-ws': 'UNKNOWN',
  'binance-paxg': 'TICK',
  'fcsapi-xau': 'UNKNOWN',
  'xaus-api': 'UNKNOWN',
  'h3-aggregated': 'UNKNOWN',
};

export const SOURCE_SYMBOL_BY_SOURCE: Record<string, string> = {
  'twelvedata-ws': 'XAU/USD',
  'binance-paxg': 'PAXGUSDT',
  'fcsapi-xau': 'FX:XAUUSD',
  'xaus-api': 'XAUUSD',
  'h3-aggregated': 'XAU/USD-AGG',
};

export const SOURCE_TIMEZONE: Record<string, string> = {
  'twelvedata-ws': 'UTC',
  'binance-paxg': 'UTC',
  'xaus-api': 'UTC',
  'fcsapi-xau': 'UTC',
  'forexfactory': 'America/New_York',
  'finnhub': 'UTC',
  'h3-aggregated': 'UTC',
};

export const PRECISION_BY_SOURCE: Record<string, { decimal_places: number; tick_size: number; price_unit: string; volume_unit: string }> = {
  'twelvedata-ws': { decimal_places: 5, tick_size: 0.01, price_unit: 'USD/oz', volume_unit: 'unknown' },
  'binance-paxg': { decimal_places: 2, tick_size: 0.01, price_unit: 'USD/oz', volume_unit: 'ticks' },
  'xaus-api': { decimal_places: 2, tick_size: 0.01, price_unit: 'USD/oz', volume_unit: 'unknown' },
  'fcsapi-xau': { decimal_places: 2, tick_size: 0.01, price_unit: 'USD/oz', volume_unit: 'unknown' },
  'h3-aggregated': { decimal_places: 5, tick_size: 0.01, price_unit: 'USD/oz', volume_unit: 'unknown' },
};

export interface LineageRef {
  readonly lineage_id: string;
  readonly raw_path: string;
}

export function toCanonical(
  raw: RawDataPoint<Candle>,
  timeframe: CanonicalTimeframe,
  lineage: LineageRef,
): CanonicalCandle {
  const volume_semantics = VOLUME_SEMANTICS_BY_SOURCE[raw.sourceId] ?? 'UNKNOWN';
  const source_symbol = SOURCE_SYMBOL_BY_SOURCE[raw.sourceId] ?? 'UNKNOWN';
  const meta = getSourceMetadata(raw.sourceId);
  const tzLookup = SOURCE_TIMEZONE[raw.sourceId];
  const source_timezone = tzLookup ?? 'UNKNOWN';
  const source_timezone_status: 'RESOLVED' | 'UNKNOWN' = tzLookup ? 'RESOLVED' : 'UNKNOWN';
  const time_blocked = source_timezone_status === 'UNKNOWN';
  const precision = PRECISION_BY_SOURCE[raw.sourceId];
  const units = resolveUnits(raw.sourceId);
  const rawVolume = raw.value.volume;
  const volume_value = volume_semantics === 'UNKNOWN' ? null : rawVolume;

  return {
    source_id: raw.sourceId,
    source_symbol,
    canonical_symbol: 'XAUUSD',
    instrument_type: meta.instrument_type,
    price_source: meta.price_source,
    quote_currency: meta.quote_currency,
    base_currency: meta.base_currency,
    timeframe,
    event_time_utc: raw.eventTime,
    source_timestamp: raw.eventTime,
    source_timezone,
    source_timezone_status,
    time_blocked,
    arrival_time_utc: raw.arrivalTime,
    availability_time_utc: raw.availabilityTime,
    received_at_utc: raw.arrivalTime,
    processed_at_utc: new Date().toISOString(),
    candle_open_time_utc: raw.eventTime,
    candle_close_time_utc: raw.closedAt ?? null,
    is_final: raw.closedAt !== undefined,
    open: raw.value.open,
    high: raw.value.high,
    low: raw.value.low,
    close: raw.value.close,
    volume_value,
    volume_semantics,
    raw_fingerprint: raw.fingerprint,
    lineage_id: lineage.lineage_id,
    raw_payload_ref: lineage.raw_path,
    normalization_version: engineVersion('normalization'),
    processing_version: engineVersion('normalization'),
    ...(precision
      ? {
          decimal_places: precision.decimal_places,
          tick_size: precision.tick_size,
          price_unit: units.price_unit,
          volume_unit: units.volume_unit,
        }
      : {}),
  };
}

export interface UsabilityReport {
  readonly suitable_for: {
    readonly rsi_atr: boolean;
    readonly volume_profile: boolean;
    readonly source_comparison: boolean;
    readonly delta_cvd: boolean;
    readonly order_flow: boolean;
    readonly news_analysis: boolean;
  };
  readonly reasons: ReadonlyArray<string>;
}

export function assessUsability(c: CanonicalCandle, opts?: { newsAvailable?: boolean; newsPublishedAt?: string; eventTime?: string }): UsabilityReport {
  const reasons: string[] = [];
  const ohlcValid =
    Number.isFinite(c.open) && Number.isFinite(c.high) &&
    Number.isFinite(c.low) && Number.isFinite(c.close) &&
    c.high >= c.low && c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close);
  if (!ohlcValid) reasons.push('OHLC invalid');

  const volOk = c.volume_semantics !== 'UNKNOWN' && c.volume_value !== null && c.volume_value > 0;
  if (!volOk) reasons.push('volume semantics unknown or zero');

  const timeOk = c.time_blocked !== true;
  if (!timeOk) reasons.push('timezone UNKNOWN - time-sensitive comparisons blocked');
  
  return {
    suitable_for: {
      rsi_atr: ohlcValid,
      volume_profile: ohlcValid && volOk,
      source_comparison: ohlcValid && timeOk,
      delta_cvd: false,
      order_flow: false,
      news_analysis: timeOk && opts?.newsAvailable === true && opts?.newsPublishedAt !== undefined && opts?.eventTime !== undefined && new Date(opts.newsPublishedAt).getTime() <= new Date(opts.eventTime).getTime(),
    },
    reasons,
  };
}

/** Stage 8A (§7.1): true only if two candles refer to the same tradable instrument. */
export function areInstrumentsEquivalent(
  a: Pick<CanonicalCandle, 'canonical_symbol' | 'instrument_type' | 'price_source'>,
  b: Pick<CanonicalCandle, 'canonical_symbol' | 'instrument_type' | 'price_source'>,
): boolean {
  return a.canonical_symbol === b.canonical_symbol
    && a.instrument_type === b.instrument_type
    && a.price_source === b.price_source;
}
