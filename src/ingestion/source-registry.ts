export type CapabilityStatus = 'VERIFIED' | 'UNVERIFIED' | 'UNKNOWN';
export type VolumeSemantics = 'TICK' | 'REAL' | 'CONTRACT' | 'UNKNOWN';
export type SourceType = 'broker' | 'api' | 'news' | 'calendar';
export type ConnectionType = 'websocket' | 'rest' | 'both';
export type TimestampSemantics = 'event_time_utc' | 'arrival_time_utc' | 'unknown';

export type UseCase =
  | 'rsi_atr'
  | 'volume_profile'
  | 'source_comparison'
  | 'delta_cvd'
  | 'order_flow'
  | 'news_analysis';

export interface SourceCapability {
  readonly source_id: string;
  readonly source_name: string;
  readonly source_type: SourceType;
  readonly connection_type: ConnectionType;
  readonly instrument_id: string;
  readonly canonical_symbol: string;

  readonly data_capabilities: {
    readonly ohlc: CapabilityStatus;
    readonly tick: CapabilityStatus;
    readonly orderbook: CapabilityStatus;
    readonly volume: CapabilityStatus;
    readonly news: CapabilityStatus;
  };

  readonly timestamp_semantics: TimestampSemantics;
  readonly volume_semantics: VolumeSemantics;

  readonly historical_coverage: {
    readonly from: string | null;
    readonly to: string | null;
    readonly status: CapabilityStatus;
    readonly verified_loaded_bars?: number;
  };

  readonly rate_limits: {
    readonly per_minute: number | null;
    readonly per_day: number | null;
    readonly status: CapabilityStatus;
  };

  readonly license_and_retention: {
    readonly commercial_use: CapabilityStatus;
    readonly redistribution: CapabilityStatus;
    readonly notes: string;
  };

  readonly config_version: string;

  /** ß4: „«  „ «· Õﬁﬁ „‰Â ›⁄·Ì« ›Ì runtime ó ·« «œ⁄«¡«  »·« œ·Ì· */
  readonly verification_notes: ReadonlyArray<string>;
}

export interface ValidationResult {
  readonly allowed: boolean;
  readonly reason: string;
}

export interface RuntimeStatus {
  readonly last_success_at: string | null;
  readonly last_failure_at: string | null;
  readonly consecutive_failures: number;
}

const CAPABILITY_MATRIX: Record<UseCase, (cap: SourceCapability) => ValidationResult> = {
  rsi_atr: (cap) => {
    if (cap.data_capabilities.ohlc !== 'VERIFIED') {
      return { allowed: false, reason: 'OHLC not verified' };
    }
    if (cap.timestamp_semantics !== 'event_time_utc') {
      return { allowed: false, reason: 'timestamp semantics must be event_time_utc' };
    }
    return { allowed: true, reason: 'OHLC verified + event_time' };
  },
  volume_profile: (cap) => {
    if (cap.data_capabilities.ohlc !== 'VERIFIED') {
      return { allowed: false, reason: 'OHLC not verified' };
    }
    if (cap.volume_semantics === 'UNKNOWN') {
      return { allowed: false, reason: 'volume semantics unknown' };
    }
    if (cap.data_capabilities.volume !== 'VERIFIED') {
      return { allowed: false, reason: 'volume not verified' };
    }
    return { allowed: true, reason: 'volume verified (' + cap.volume_semantics + ')' };
  },
  source_comparison: (cap) => {
    if (cap.data_capabilities.ohlc !== 'VERIFIED') {
      return { allowed: false, reason: 'OHLC not verified' };
    }
    if (cap.timestamp_semantics !== 'event_time_utc') {
      return { allowed: false, reason: 'timestamp semantics must be event_time_utc' };
    }
    return { allowed: true, reason: 'OHLC + event_time comparable' };
  },
  delta_cvd: () => ({ allowed: false, reason: 'requires trades with bid/ask ó not available' }),
  order_flow: () => ({ allowed: false, reason: 'requires level-2 order book ó not available' }),
  news_analysis: (cap) => {
    if (cap.data_capabilities.news !== 'VERIFIED') {
      return { allowed: false, reason: 'news capability not verified' };
    }
    return { allowed: true, reason: 'news verified' };
  },
};

export class SourceRegistry {
  private readonly sources = new Map<string, SourceCapability>();
  private readonly runtime = new Map<string, RuntimeStatus>();

  constructor() {
    this.register(this.defaultTwelveData());
    this.register(this.defaultBinancePaxg());
    this.register(this.defaultXausApi());
    this.register(this.defaultH3Aggregated());
  }

  register(cap: SourceCapability): void {
    this.sources.set(cap.source_id, cap);
    if (!this.runtime.has(cap.source_id)) {
      this.runtime.set(cap.source_id, {
        last_success_at: null,
        last_failure_at: null,
        consecutive_failures: 0,
      });
    }
  }

  get(sourceId: string): SourceCapability | undefined {
    return this.sources.get(sourceId);
  }

  runtimeStatus(sourceId: string): RuntimeStatus {
    return this.runtime.get(sourceId) ?? {
      last_success_at: null,
      last_failure_at: null,
      consecutive_failures: 0,
    };
  }

  markSuccess(sourceId: string): void {
    const prev = this.runtime.get(sourceId);
    if (!prev) return;
    this.runtime.set(sourceId, {
      last_success_at: new Date().toISOString(),
      last_failure_at: prev.last_failure_at,
      consecutive_failures: 0,
    });
  }

  markFailure(sourceId: string): void {
    const prev = this.runtime.get(sourceId);
    if (!prev) return;
    this.runtime.set(sourceId, {
      last_success_at: prev.last_success_at,
      last_failure_at: new Date().toISOString(),
      consecutive_failures: prev.consecutive_failures + 1,
    });
  }

  validateUse(sourceId: string, useCase: UseCase): ValidationResult {
    const cap = this.sources.get(sourceId);
    if (!cap) return { allowed: false, reason: 'unknown source_id' };

    const check = CAPABILITY_MATRIX[useCase];
    const result = check(cap);
    if (!result.allowed) {
      return { allowed: false, reason: sourceId + ': ' + result.reason };
    }

    const rt = this.runtime.get(sourceId);
    if (rt && rt.consecutive_failures >= 5) {
      return { allowed: false, reason: sourceId + ': too many consecutive failures (' + rt.consecutive_failures + ')' };
    }

    return result;
  }

  all(): ReadonlyArray<SourceCapability> {
    return Array.from(this.sources.values());
  }

  snapshot(): Record<string, unknown> {
    return {
      generated_at: new Date().toISOString(),
      registry_version: '1.1.0',
      sources: this.all().map((cap) => ({
        ...cap,
        runtime: this.runtimeStatus(cap.source_id),
      })),
    };
  }

  /**
   * ß4 + ß2.9: TwelveData WebSocket
   * VERIFIED at runtime:
   *   - OHLC loaded 100+ bars (1m..1w)
   *   - Live tick via WebSocket price events
   *   - Volume is UNKNOWN (0 in every candle ó no forex volume provided)
   *   - Rate limit 8/min hit (429 observed)
   * NOT VERIFIED:
   *   - Historical coverage start date (never loaded from 2000)
   *   - Per-day 800 limit (never hit)
   *   - Commercial license terms (never read)
   */
  private defaultTwelveData(): SourceCapability {
    return {
      source_id: 'twelvedata-ws',
      source_name: 'TwelveData WebSocket',
      source_type: 'api',
      connection_type: 'both',
      instrument_id: 'XAU/USD',
      canonical_symbol: 'XAUUSD',
      data_capabilities: {
        ohlc: 'VERIFIED',
        tick: 'VERIFIED',
        orderbook: 'UNKNOWN',
        volume: 'UNKNOWN',
        news: 'UNKNOWN',
      },
      timestamp_semantics: 'event_time_utc',
      volume_semantics: 'UNKNOWN',
      historical_coverage: {
        from: null,
        to: null,
        status: 'UNVERIFIED',
        verified_loaded_bars: 100,
      },
      rate_limits: {
        per_minute: 8,
        per_day: 800,
        status: 'UNVERIFIED',
      },
      license_and_retention: {
        commercial_use: 'UNVERIFIED',
        redistribution: 'UNVERIFIED',
        notes: 'Free-tier documented limits; commercial terms not reviewed',
      },
      config_version: '1.0.0',
      verification_notes: [
        'OHLC loaded successfully (100+ bars per timeframe)',
        'Live tick verified via WebSocket price events',
        'Volume always 0 ó no forex volume from this source',
        'Rate limit 8/min hit (429 observed on burst)',
      ],
    };
  }

  /**
   * ß4 + ß2.9: Binance PAXG/USDT
   * VERIFIED at runtime:
   *   - OHLC loaded 100+ bars (1m)
   *   - Live tick via WebSocket
   *   - Volume is TICK (trade count, not physical gold volume)
   * NOT VERIFIED:
   *   - Orderbook (never consumed by FALK)
   *   - 1200/min rate limit (never stress-tested)
   *   - Historical start 2020 (only loaded recent 100 bars)
   *   - License terms
   */
  private defaultBinancePaxg(): SourceCapability {
    return {
      source_id: 'binance-paxg',
      source_name: 'Binance PAXG/USDT',
      source_type: 'broker',
      connection_type: 'both',
      instrument_id: 'PAXGUSDT',
      canonical_symbol: 'XAUUSD',
      data_capabilities: {
        ohlc: 'VERIFIED',
        tick: 'VERIFIED',
        orderbook: 'UNVERIFIED',
        volume: 'VERIFIED',
        news: 'UNKNOWN',
      },
      timestamp_semantics: 'event_time_utc',
      volume_semantics: 'TICK',
      historical_coverage: {
        from: null,
        to: null,
        status: 'UNVERIFIED',
        verified_loaded_bars: 100,
      },
      rate_limits: {
        per_minute: 1200,
        per_day: 100000,
        status: 'UNVERIFIED',
      },
      license_and_retention: {
        commercial_use: 'UNVERIFIED',
        redistribution: 'UNVERIFIED',
        notes: 'Binance terms; PAXG volume is tick count, not physical gold volume',
      },
      config_version: '1.0.0',
      verification_notes: [
        'OHLC loaded successfully (100 bars)',
        'Live tick verified via combined stream',
        'Volume identified as TICK (trade count)',
        'Orderbook capability exists but not consumed by FALK',
      ],
    };
  }

  /**
   * ß4: xaus.com backup REST API
   * Barely used ó most capabilities UNKNOWN
   */
  private defaultXausApi(): SourceCapability {
    return {
      source_id: 'xaus-api',
      source_name: 'xaus.com REST API',
      source_type: 'api',
      connection_type: 'rest',
      instrument_id: 'XAUUSD',
      canonical_symbol: 'XAUUSD',
      data_capabilities: {
        ohlc: 'UNKNOWN',
        tick: 'UNVERIFIED',
        orderbook: 'UNKNOWN',
        volume: 'UNKNOWN',
        news: 'UNKNOWN',
      },
      timestamp_semantics: 'unknown',
      volume_semantics: 'UNKNOWN',
      historical_coverage: {
        from: null,
        to: null,
        status: 'UNKNOWN',
      },
      rate_limits: {
        per_minute: null,
        per_day: null,
        status: 'UNKNOWN',
      },
      license_and_retention: {
        commercial_use: 'UNVERIFIED',
        redistribution: 'UNVERIFIED',
        notes: 'Free public API; terms not reviewed',
      },
      config_version: '1.0.0',
      verification_notes: [
        'Used only as failover backup',
        'Not tested extensively',
      ],
    };
  }

  /**
   * ß4: H3 aggregated from 3◊ 1h (derived, not external)
   * VERIFIED at runtime:
   *   - Aggregation works (33 H3 candles produced)
   *   - Boundary-aligned to 3-hour marks
   *   - Gap detection prevents incomplete H3
   */
  private defaultH3Aggregated(): SourceCapability {
    return {
      source_id: 'h3-aggregated',
      source_name: 'XAUUSD H3 Aggregated (3x 1h)',
      source_type: 'api',
      connection_type: 'rest',
      instrument_id: 'XAU/USD',
      canonical_symbol: 'XAUUSD',
      data_capabilities: {
        ohlc: 'VERIFIED',
        tick: 'UNKNOWN',
        orderbook: 'UNKNOWN',
        volume: 'UNVERIFIED',
        news: 'UNKNOWN',
      },
      timestamp_semantics: 'event_time_utc',
      volume_semantics: 'UNKNOWN',
      historical_coverage: {
        from: null,
        to: 'now',
        status: 'VERIFIED',
        verified_loaded_bars: 33,
      },
      rate_limits: {
        per_minute: null,
        per_day: null,
        status: 'UNKNOWN',
      },
      license_and_retention: {
        commercial_use: 'UNVERIFIED',
        redistribution: 'UNVERIFIED',
        notes: 'Derived from 1h candles - inherits TwelveData terms',
      },
      config_version: '1.0.0',
      verification_notes: [
        'Aggregated 33 H3 candles from 99 1h candles at runtime',
        'Boundary-aligned: 00:00, 03:00, ..., 21:00 UTC',
        'Gap detection verified (incomplete H3 not emitted)',
      ],
    };
  }
}