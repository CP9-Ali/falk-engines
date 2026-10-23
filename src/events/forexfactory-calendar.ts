import 'dotenv/config';
import type { EconomicEvent, EventImpact } from './types';

const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

interface FFRawEvent {
  title?: string;
  country?: string;
  date?: string;
  impact?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

function parseImpact(raw?: string): EventImpact {
  const s = (raw || '').toLowerCase();
  if (s === 'high') return 'HIGH';
  if (s === 'medium') return 'MEDIUM';
  return 'LOW';
}

export async function fetchForexFactoryCalendar(): Promise<EconomicEvent[]> {
  const res = await fetch(CALENDAR_URL, {
    headers: { 'User-Agent': 'falk-engines/1.0' },
  });
  if (!res.ok) throw new Error('ForexFactory HTTP ' + res.status);
  const raw = (await res.json()) as FFRawEvent[];
  if (!Array.isArray(raw)) return [];

  const now = new Date().toISOString();
  const out: EconomicEvent[] = [];

  for (const r of raw) {
    if (!r.title || !r.date) continue;
    const eventTime = new Date(r.date).toISOString();
    const title = r.title;
    const country = r.country || 'GLOBAL';
    out.push({
      event_id: 'ff-' + country + '-' + new Date(r.date).getTime() + '-' + title.replace(/\s+/g, '_'),
      source_id: 'forexfactory',
      category: 'economic',
      title,
      currency_or_region: country,
      impact: parseImpact(r.impact),
      event_time_utc: eventTime,
      published_at_utc: eventTime,
      received_at_utc: now,
      actual_value: r.actual ?? null,
      forecast_value: r.forecast ?? null,
      previous_value: r.previous ?? null,
      revision: 1,
      source_reference: CALENDAR_URL,
      data_vintage: 'ff-weekly',
    });
  }

  return out;
}