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

/** Capacity matrix — which source is verified for which use case */
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
  delta_cvd: () => ({ allowed: false, reason: 'requires trades with bid/ask — not available' }),
  order_flow: () => ({ allowed: false, reason: 'requires level-2 order book — not available' }),
  news_analysis: (cap) => {
    if (cap.data_capabilities.news !== 'VERIFIED') {
      return { allowed: false, reason: 'news capability not verified' };
    }
    return { allowed: true, reason: 'news verified' };
  },
};

/**
 * Registry of data sources with their capabilities (§4).
 * Conservative: only VERIFIED when proven in code/docs.
 * Everything else = UNVERIFIED or UNKNOWN.
 */
export class SourceRegistry {
  private readonly sources = new Map<string, SourceCapability>();
  private readonly runtime = new Map<string, RuntimeStatus>();

  constructor() {
    this.register(this.defaultTwelveData());
    this.register(this.defaultBinancePaxg());
    this.register(this.defaultXausApi());
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

  /** هل هذا المصدر صالح لاستخدام معين؟ */
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

  /** تقرير كامل — للحفظ في .backup/registry/ */
  snapshot(): Record<string, unknown> {
    return {
      generated_at: new Date().toISOString(),
      registry_version: '1.0.0',
      sources: this.all().map((cap) => ({
        ...cap,
        runtime: this.runtimeStatus(cap.source_id),
      })),
    };
  }

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
        volume: 'UNVERIFIED',
        news: 'UNKNOWN',
      },
      timestamp_semantics: 'event_time_utc',
      volume_semantics: 'UNKNOWN',
      historical_coverage: {
        from: '2000-01-01',
        to: 'now',
        status: 'UNVERIFIED',
      },
      rate_limits: {
        per_minute: 8,
        per_day: 800,
        status: 'UNVERIFIED',
      },
      license_and_retention: {
        commercial_use: 'UNVERIFIED',
        redistribution: 'UNVERIFIED',
        notes: 'Free tier documented limits; commercial terms require confirmation',
      },
      config_version: '1.0.0',
    };
  }

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
        orderbook: 'VERIFIED',
        volume: 'VERIFIED',
        news: 'UNKNOWN',
      },
      timestamp_semantics: 'event_time_utc',
      volume_semantics: 'TICK',
      historical_coverage: {
        from: '2020-09-01',
        to: 'now',
        status: 'VERIFIED',
      },
      rate_limits: {
        per_minute: 1200,
        per_day: 100000,
        status: 'VERIFIED',
      },
      license_and_retention: {
        commercial_use: 'UNVERIFIED',
        redistribution: 'UNVERIFIED',
        notes: 'Binance terms; PAXG = tick volume, not physical gold volume',
      },
      config_version: '1.0.0',
    };
  }

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
    };
  }
}