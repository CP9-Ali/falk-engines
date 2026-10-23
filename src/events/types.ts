import type { Timestamp } from '../core/types';

export type EventImpact = 'LOW' | 'MEDIUM' | 'HIGH';
export type EventCategory = 'economic' | 'news' | 'geopolitical';

/** §11: فصل واضح بين الأنواع الثلاثة من الوقت */
export interface EconomicEvent {
  readonly event_id: string;
  readonly source_id: string;
  readonly category: EventCategory;
  readonly title: string;
  readonly currency_or_region: string;
  readonly impact: EventImpact;

  /** وقت حدوث الحدث الفعلي (مثلاً 12:30 UTC لإصدار NFP) */
  readonly event_time_utc: Timestamp;

  /** وقت النشر من المصدر (قد يتأخر عن event_time) */
  readonly published_at_utc: Timestamp;

  /** وقت استلامنا (قد يتأخر أكثر) */
  readonly received_at_utc: Timestamp;

  readonly actual_value?: string | null;
  readonly forecast_value?: string | null;
  readonly previous_value?: string | null;
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
}

export interface EventFeatures {
  readonly is_high_impact_active: boolean;
  readonly minutes_since_last_high: number | null;
  readonly minutes_until_next_high: number | null;
  readonly last_high_event_title: string | null;
  readonly last_high_event_time_utc: Timestamp | null;
}