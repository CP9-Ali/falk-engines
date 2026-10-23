import { describe, it, expect } from 'vitest';
import { EventIntelligence } from '../events/event-intelligence';
import type { NewsItem } from '../events/finnhub-news';

function mkNews(over: Partial<NewsItem>): NewsItem {
  return {
    news_id: 'n1',
    source_id: 'finnhub',
    headline: 'Gold surges on weak dollar',
    summary: '',
    url: '',
    published_at_utc: '2026-10-23T12:00:00.000Z',
    received_at_utc: '2026-10-23T12:00:01.000Z',
    direction: 'BULLISH',
    relevance: 'xau',
    sentiment_method: 'heuristic_v1',
    ...over,
  };
}

describe('News Features (§11)', () => {
  it('empty news returns neutral', () => {
    const ei = new EventIntelligence();
    const f = ei.computeNewsFeatures({
      asOfCutoff: '2026-10-23T13:00:00.000Z',
      eventTimeUtc: '2026-10-23T13:00:00.000Z',
    });
    expect(f.news_count_1h).toBe(0);
    expect(f.news_bias).toBe('NEUTRAL');
    expect(f.last_news_minutes_ago).toBeNull();
  });

  it('bullish news in last hour', () => {
    const ei = new EventIntelligence();
    (ei as any).news = [mkNews({ published_at_utc: '2026-10-23T12:30:00.000Z', direction: 'BULLISH' })];
    const f = ei.computeNewsFeatures({
      asOfCutoff: '2026-10-23T13:00:00.000Z',
      eventTimeUtc: '2026-10-23T13:00:00.000Z',
    });
    expect(f.news_count_1h).toBe(1);
    expect(f.news_bias).toBe('BULLISH');
    expect(f.last_news_minutes_ago).toBe(30);
  });

  it('mixed bull/bear = MIXED', () => {
    const ei = new EventIntelligence();
    (ei as any).news = [
      mkNews({ news_id: 'n1', published_at_utc: '2026-10-23T12:20:00.000Z', direction: 'BULLISH' }),
      mkNews({ news_id: 'n2', published_at_utc: '2026-10-23T12:40:00.000Z', direction: 'BEARISH' }),
    ];
    const f = ei.computeNewsFeatures({
      asOfCutoff: '2026-10-23T13:00:00.000Z',
      eventTimeUtc: '2026-10-23T13:00:00.000Z',
    });
    expect(f.news_bias).toBe('MIXED');
  });

  it('lookahead-safe: news published after cutoff excluded', () => {
    const ei = new EventIntelligence();
    (ei as any).news = [mkNews({ published_at_utc: '2026-10-23T13:00:01.000Z', direction: 'BULLISH' })];
    const f = ei.computeNewsFeatures({
      asOfCutoff: '2026-10-23T13:00:00.000Z',
      eventTimeUtc: '2026-10-23T13:00:00.000Z',
    });
    expect(f.news_count_1h).toBe(0);
  });
});