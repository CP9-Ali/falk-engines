import { describe, it, expect } from 'vitest';
import { EventIntelligence } from '../events/event-intelligence';
import type { EconomicEvent } from '../events/types';

function mkEvent(over: Partial<EconomicEvent>): EconomicEvent {
  return {
    event_id: 'e1',
    source_id: 'test',
    category: 'economic',
    title: 'NFP',
    currency_or_region: 'USD',
    impact: 'HIGH',
    event_time_utc: '2026-10-23T12:30:00.000Z',
    published_at_utc: '2026-10-23T12:30:00.000Z',
    received_at_utc: '2026-10-23T12:31:00.000Z',
    actual_value: null,
    forecast_value: null,
    previous_value: null,
    ...over,
  };
}

describe('EventIntelligence (§11)', () => {
  it('no events available before publish time', () => {
    const ei = new EventIntelligence();
    (ei as any).events = [
      mkEvent({ event_time_utc: '2026-10-23T13:00:00.000Z', published_at_utc: '2026-10-23T13:00:00.000Z' }),
    ];
    expect(ei.availableAt('2026-10-23T12:59:00.000Z').length).toBe(0);
    expect(ei.availableAt('2026-10-23T13:00:00.000Z').length).toBe(1);
  });

  it('is_high_impact_active within 30min window', () => {
    const ei = new EventIntelligence();
    (ei as any).events = [
      mkEvent({ event_time_utc: '2026-10-23T12:30:00.000Z' }),
    ];
    const f = ei.computeFeatures({
      asOfCutoff: '2026-10-23T13:00:00.000Z',
      eventTimeUtc: '2026-10-23T12:45:00.000Z',
    });
    expect(f.is_high_impact_active).toBe(true);
  });

  it('minutes_since_last_high computed correctly', () => {
    const ei = new EventIntelligence();
    (ei as any).events = [
      mkEvent({ event_time_utc: '2026-10-23T12:00:00.000Z' }),
    ];
    const f = ei.computeFeatures({
      asOfCutoff: '2026-10-23T14:00:00.000Z',
      eventTimeUtc: '2026-10-23T13:00:00.000Z',
    });
    expect(f.minutes_since_last_high).toBe(60);
  });

  it('minutes_until_next_high computed correctly', () => {
    const ei = new EventIntelligence();
    (ei as any).events = [
      mkEvent({ event_time_utc: '2026-10-23T15:00:00.000Z' }),
    ];
    const f = ei.computeFeatures({
      asOfCutoff: '2026-10-23T15:00:00.000Z',
      eventTimeUtc: '2026-10-23T14:00:00.000Z',
    });
    expect(f.minutes_until_next_high).toBe(60);
  });

  it('non-HIGH events are ignored', () => {
    const ei = new EventIntelligence();
    (ei as any).events = [
      mkEvent({ event_time_utc: '2026-10-23T12:00:00.000Z', impact: 'LOW' }),
    ];
    const f = ei.computeFeatures({
      asOfCutoff: '2026-10-23T13:00:00.000Z',
      eventTimeUtc: '2026-10-23T12:30:00.000Z',
    });
    expect(f.is_high_impact_active).toBe(false);
    expect(f.minutes_since_last_high).toBeNull();
  });
});