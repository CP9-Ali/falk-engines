import type { Timestamp } from '../core/types';

export type EventImpact = 'LOW' | 'MEDIUM' | 'HIGH';
export type EventCategory = 'economic' | 'news' | 'geopolitical';

export interface EconomicEvent {
  readonly event_id: string;
  readonly source_id: string;
  readonly category: EventCategory;
  readonly title: string;
  readonly currency_or_region: string;
  readonly impact: EventImpact;

  readonly event_time_utc: Timestamp;
  readonly published_at_utc: Timestamp;
  readonly received_at_utc: Timestamp;

  readonly actual_value?: string | null;
  readonly forecast_value?: string | null;
  readonly previous_value?: string | null;

  readonly revision?: number;
  readonly source_reference?: string;
  readonly data_vintage?: string;
}

export interface NewsItem {
  readonly news_id: string;
  readonly source_id: string;
  readonly headline: string;
  readonly summary: string;
  readonly url: string;
  readonly published_at_utc: Timestamp;
  readonly received_at_utc: Timestamp;
  readonly relevance: 'xau' | 'usd' | 'macro' | 'other';

  readonly revision?: number;
  readonly source_reference?: string;
  readonly data_vintage?: string;
}

export interface EventFeatures {
  readonly is_high_impact_active: boolean;
  readonly minutes_since_last_high: number | null;
  readonly minutes_until_next_high: number | null;
  readonly last_high_event_title: string | null;
  readonly last_high_event_time_utc: Timestamp | null;
}