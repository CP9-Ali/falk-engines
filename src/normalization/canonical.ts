import type { RawDataPoint } from '../core/types';
import { engineVersion } from '../core/versions';
import { resolveUnits, type PriceUnit, type VolumeUnit } from './unit-normalizer';
import type { Candle } from '../data-quality/checks/base';

export type VolumeSemantics = 'TICK' | 'REAL' | 'CONTRACT' | 'UNKNOWN';
export type CanonicalTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface CanonicalCandle {
  readonly source_id: string;
  readonly source_symbol: string;
  readonly canonical_symbol: 'XAUUSD';
  readonly timeframe: CanonicalTimeframe;

  readonly event_time_utc: string;
  readonly source_timestamp: string;
  readonly source_timezone: string;
  readonly arrival_time_utc: string;
  readonly availability_time_utc: string;

  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;

  readonly volume_value: number;
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
}

export const VOLUME_SEMANTICS_BY_SOURCE: Record<string, VolumeSemantics> = {
  'twelvedata-ws': 'UNKNOWN',
  'binance-paxg': 'TICK',
  'fcsapi-xau': 'UNKNOWN',
  'xaus-api': 'UNKNOWN',
};

export const SOURCE_SYMBOL_BY_SOURCE: Record<string, string> = {
  'twelvedata-ws': 'XAU/USD',
  'binance-paxg': 'PAXGUSDT',
  'fcsapi-xau': 'FX:XAUUSD',
  'xaus-api': 'XAUUSD',
};

export const SOURCE_TIMEZONE: Record<string, string> = {
  'twelvedata-ws': 'UTC',
  'binance-paxg': 'UTC',
  'xaus-api': 'UTC',
  'fcsapi-xau': 'UTC',
  'forexfactory': 'America/New_York',
  'finnhub': 'UTC',
};

export const PRECISION_BY_SOURCE: Record<string, { decimal_places: number; tick_size: number; price_unit: string; volume_unit: string }> = {
  'twelvedata-ws': { decimal_places: 5, tick_size: 0.01, price_unit: 'USD/oz', volume_unit: 'unknown' },
  'binance-paxg': { decimal_places: 2, tick_size: 0.01, price_unit: 'USD/oz', volume_unit: 'ticks' },
  'xaus-api': { decimal_places: 2, tick_size: 0.01, price_unit: 'USD/oz', volume_unit: 'unknown' },
  'fcsapi-xau': { decimal_places: 2, tick_size: 0.01, price_unit: 'USD/oz', volume_unit: 'unknown' },
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
  const source_timezone = SOURCE_TIMEZONE[raw.sourceId] ?? 'UTC';
  const precision = PRECISION_BY_SOURCE[raw.sourceId];
  const units = resolveUnits(raw.sourceId);
  const rawVolume = raw.value.volume;
  const volume_value = volume_semantics === 'UNKNOWN' ? 0 : rawVolume;

  return {
    source_id: raw.sourceId,
    source_symbol,
    canonical_symbol: 'XAUUSD',
    timeframe,
    event_time_utc: raw.eventTime,
    source_timestamp: raw.eventTime,
    source_timezone,
    arrival_time_utc: raw.arrivalTime,
    availability_time_utc: raw.availabilityTime,
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
  };
  readonly reasons: ReadonlyArray<string>;
}

export function assessUsability(c: CanonicalCandle): UsabilityReport {
  const reasons: string[] = [];
  const ohlcValid =
    Number.isFinite(c.open) && Number.isFinite(c.high) &&
    Number.isFinite(c.low) && Number.isFinite(c.close) &&
    c.high >= c.low && c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close);
  if (!ohlcValid) reasons.push('OHLC invalid');

  const volOk = c.volume_semantics !== 'UNKNOWN' && c.volume_value > 0;
  if (!volOk) reasons.push('volume semantics unknown or zero');

  return {
    suitable_for: {
      rsi_atr: ohlcValid,
      volume_profile: ohlcValid && volOk,
      source_comparison: ohlcValid,
      delta_cvd: false,
      order_flow: false,
    },
    reasons,
  };
}