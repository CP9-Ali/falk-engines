import 'dotenv/config';

export type NewsDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type NewsRelevance = 'xau' | 'usd' | 'macro' | 'other';

export interface NewsItem {
  readonly news_id: string;
  readonly source_id: string;
  readonly headline: string;
  readonly summary: string;
  readonly url: string;
  readonly published_at_utc: string;
  readonly received_at_utc: string;
  readonly direction: NewsDirection;
  readonly relevance: NewsRelevance;
  readonly sentiment_method: 'heuristic_v1';
  readonly revision?: number;
  readonly source_reference?: string;
  readonly data_vintage?: string;
}

const BULLISH_KW = [
  'surge', 'rally', 'soar', 'gain', 'rise', 'jump', 'climb',
  'record high', 'all-time high', 'safe haven', 'risk-off',
  'weak dollar', 'inflation rise', 'gold up',
];
const BEARISH_KW = [
  'plunge', 'fall', 'drop', 'tumble', 'slump', 'decline', 'sink',
  'risk-on', 'strong dollar', 'sell-off', 'selloff', 'crash',
  'gold down',
];
const XAU_RELEVANT = ['gold', 'xau', 'precious metal', 'bullion'];

function classifyDirection(text: string): NewsDirection {
  const t = text.toLowerCase();
  let bull = 0, bear = 0;
  for (const k of BULLISH_KW) if (t.includes(k)) bull++;
  for (const k of BEARISH_KW) if (t.includes(k)) bear++;
  if (bull > bear) return 'BULLISH';
  if (bear > bull) return 'BEARISH';
  return 'NEUTRAL';
}

function classifyRelevance(text: string): NewsRelevance {
  const t = text.toLowerCase();
  for (const k of XAU_RELEVANT) if (t.includes(k)) return 'xau';
  if (t.includes('dollar') || t.includes('usd') || t.includes('fed')) return 'usd';
  if (t.includes('cpi') || t.includes('inflation') || t.includes('nfp') || t.includes('fomc')) return 'macro';
  return 'other';
}

interface FinnhubNewsRaw {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  related?: string;
  source?: string;
  summary?: string;
  url?: string;
}

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

export async function fetchFinnhubForexNews(apiKey: string): Promise<NewsItem[]> {
  const url = FINNHUB_BASE + '/news?category=forex&token=' + encodeURIComponent(apiKey);
  const res = await fetch(url, { headers: { 'User-Agent': 'falk-engines/1.0' } });
  if (!res.ok) throw new Error('Finnhub news HTTP ' + res.status);
  const raw = (await res.json()) as FinnhubNewsRaw[];
  if (!Array.isArray(raw)) return [];

  const nowIso = new Date().toISOString();
  const out: NewsItem[] = [];

  for (const r of raw) {
    if (!r.headline || !r.datetime) continue;
    const publishedMs = r.datetime * 1000;
    const text = r.headline + ' ' + (r.summary || '');
    out.push({
      news_id: 'fh-' + (r.id ?? publishedMs),
      source_id: 'finnhub',
      headline: r.headline,
      summary: r.summary || '',
      url: r.url || '',
      published_at_utc: new Date(publishedMs).toISOString(),
      received_at_utc: nowIso,
      direction: classifyDirection(text),
      relevance: classifyRelevance(text),
      sentiment_method: 'heuristic_v1',
      revision: 1,
      source_reference: r.url || FINNHUB_BASE,
      data_vintage: 'fh-latest',
    });
  }

  return out;
}