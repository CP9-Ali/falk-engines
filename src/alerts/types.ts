// ?10.0 ? Alerting interfaces (no runtime deps, no coupling to monitoring/)

export type AlertSeverity = 'WARNING' | 'HIGH' | 'CRITICAL';

export type AlertCategory =
  | 'health'
  | 'quality'
  | 'fusion'
  | 'backtest'
  | 'custom';

export interface Alert {
  readonly id: string;
  readonly severity: AlertSeverity;
  readonly category: AlertCategory;
  /** Human-readable one-liner. */
  readonly message: string;
  /**
   * Deduplication key. Two alerts with the same dedup_key
   * represent the same underlying condition and must not
   * both be delivered to the same channel.
   */
  readonly dedup_key: string;
  /** When the condition was observed (ISO 8601 UTC). */
  readonly raised_at: string;
  /** Optional structured context (backtest metrics, fusion report ids, etc.). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DeliveryResult {
  readonly channel: string;
  readonly alert_id: string;
  readonly ok: boolean;
  readonly sent_at: string;
  readonly error?: string;
}

export interface AlertChannel {
  readonly name: string;
  send(alert: Alert): Promise<DeliveryResult>;
}

export interface RouterConfig {
  /** Channel name -> channel instance. */
  readonly channels: Readonly<Record<string, AlertChannel>>;
  /** Severity -> channel names. Missing severity -> no routing. */
  readonly routes: Readonly<Record<AlertSeverity, ReadonlyArray<string>>>;
  /**
   * When true, a channel that appears in multiple severities is
   * still called once per alert. Default true.
   */
  readonly dedupe_per_channel?: boolean;
}
