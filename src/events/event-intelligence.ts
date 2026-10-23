import 'dotenv/config';
import type { Timestamp } from '../core/types';
import type { EconomicEvent, EventFeatures } from './types';
import { fetchForexFactoryCalendar } from './forexfactory-calendar';

/** §11: يجب فصل event_time عن published_at عن received_at */
export interface EventQuery {
  readonly asOfCutoff: Timestamp;
  readonly eventTimeUtc: Timestamp;
}

export interface EventIntelligenceConfig {
  readonly pollMs?: number;
  readonly highImpactWindowMs?: number;
}

export class EventIntelligence {
  private events: EconomicEvent[] = [];
  private lastFetchAt = 0;
  private readonly pollMs: number;
  private readonly highImpactWindowMs: number;

  constructor(cfg: EventIntelligenceConfig = {}) {
    this.pollMs = cfg.pollMs ?? 5 * 60_000;
    this.highImpactWindowMs = cfg.highImpactWindowMs ?? 30 * 60_000;
  }

  async refreshIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastFetchAt < this.pollMs && this.events.length > 0) return;
    try {
      const events = await fetchForexFactoryCalendar();
      this.events = events;
      this.lastFetchAt = now;
      console.log('[EVENTS] Loaded ' + events.length + ' economic events');
    } catch (e) {
      console.warn('[EVENTS] Refresh failed:', (e as Error).message);
    }
  }

  /**
   * §2 / §5.4: فقط الأحداث التي كانت متاحة فعلياً عند asOfCutoff.
   * الحقل الحاسم هو published_at_utc (وليس event_time_utc).
   */
  availableAt(cutoff: Timestamp): EconomicEvent[] {
    const cutMs = new Date(cutoff).getTime();
    return this.events.filter(e => new Date(e.published_at_utc).getTime() <= cutMs);
  }

  /** §11: ميزات مرتبطة بالأحداث، محسوبة فقط من المعلومة المتاحة */
  computeFeatures(query: EventQuery): EventFeatures {
    const available = this.availableAt(query.asOfCutoff);
    const t = new Date(query.eventTimeUtc).getTime();
    const window = this.highImpactWindowMs;

    const highs = available.filter(e => e.impact === 'HIGH');

    let activeHigh: EconomicEvent | null = null;
    for (const e of highs) {
      const et = new Date(e.event_time_utc).getTime();
      if (et >= t - window && et <= t + window) {
        activeHigh = e;
        break;
      }
    }

    const pastHighs = highs
      .filter(e => new Date(e.event_time_utc).getTime() <= t)
      .sort((a, b) =>
        new Date(b.event_time_utc).getTime() - new Date(a.event_time_utc).getTime());

    const futureHighs = highs
      .filter(e => new Date(e.event_time_utc).getTime() > t)
      .sort((a, b) =>
        new Date(a.event_time_utc).getTime() - new Date(b.event_time_utc).getTime());

    const lastHigh = pastHighs[0] || null;
    const nextHigh = futureHighs[0] || null;

    return {
      is_high_impact_active: activeHigh !== null,
      minutes_since_last_high: lastHigh
        ? Math.round((t - new Date(lastHigh.event_time_utc).getTime()) / 60_000)
        : null,
      minutes_until_next_high: nextHigh
        ? Math.round((new Date(nextHigh.event_time_utc).getTime() - t) / 60_000)
        : null,
      last_high_event_title: lastHigh ? lastHigh.title : null,
      last_high_event_time_utc: lastHigh ? lastHigh.event_time_utc : null,
    };
  }

  getAll(): ReadonlyArray<EconomicEvent> {
    return this.events;
  }
}