export interface RawBarShape {
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume: number;
  readonly timestamp_ms: number;
}

export interface MappedBar extends RawBarShape {
  readonly schema_source: string;
  readonly field_map_used: Record<string, string>;
}

interface SchemaRule {
  readonly name: string;
  readonly detect: (raw: any) => boolean;
  readonly map: (raw: any) => MappedBar | null;
}

const RULES: ReadonlyArray<SchemaRule> = [
  // 1. TwelveData: { datetime, open, high, low, close }
  {
    name: 'twelvedata',
    detect: (r) => r && typeof r.datetime === 'string' && r.open !== undefined,
    map: (r) => {
      const t = new Date(String(r.datetime).replace(' ', 'T') + 'Z').getTime();
      if (!Number.isFinite(t)) return null;
      const o = parseFloat(r.open), h = parseFloat(r.high), l = parseFloat(r.low), c = parseFloat(r.close);
      if (!Number.isFinite(o) || !Number.isFinite(c)) return null;
      const fieldMap: Record<string, string> = {
        datetime: 'timestamp',
        open: 'open',
        high: 'high',
        low: 'low',
        close: 'close',
      };
      return {
        open: o, high: h, low: l, close: c,
        volume: r.volume !== undefined ? parseFloat(r.volume) || 0 : 0,
        timestamp_ms: t,
        schema_source: 'twelvedata',
        field_map_used: fieldMap,
      };
    },
  },
  // 2. Binance kline: array or object
  {
    name: 'binance-kline',
    detect: (r) => r && (r.t !== undefined || Array.isArray(r)) && (r.o !== undefined || Array.isArray(r)),
    map: (r) => {
      const data = Array.isArray(r)
        ? { t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }
        : r;
      const t = Number(data.t);
      if (!Number.isFinite(t)) return null;

      const fieldMap: Record<string, string> = Array.isArray(r)
        ? { '0': 'timestamp', '1': 'open', '2': 'high', '3': 'low', '4': 'close', '5': 'volume' }
        : { t: 'timestamp', o: 'open', h: 'high', l: 'low', c: 'close', v: 'volume' };

      return {
        open: parseFloat(data.o), high: parseFloat(data.h),
        low: parseFloat(data.l), close: parseFloat(data.c),
        volume: parseFloat(data.v || '0'),
        timestamp_ms: t,
        schema_source: 'binance-kline',
        field_map_used: fieldMap,
      };
    },
  },
  // 3. FCSAPI: { '1': o, '2': h, '3': l, '4': c, t: timestamp }
  {
    name: 'fcsapi',
    detect: (r) => r && r['1'] !== undefined && r['4'] !== undefined,
    map: (r) => {
      const raw_t = r.t || r.time || r.timestamp || r.date;
      const t = typeof raw_t === 'string'
        ? new Date(raw_t.replace(' ', 'T') + 'Z').getTime()
        : Number(raw_t) * 1000;
      if (!Number.isFinite(t)) return null;

      const fieldMap: Record<string, string> = {
        t: 'timestamp', '1': 'open', '2': 'high', '3': 'low', '4': 'close', '5': 'volume',
      };

      return {
        open: parseFloat(r['1']), high: parseFloat(r['2']),
        low: parseFloat(r['3']), close: parseFloat(r['4']),
        volume: parseFloat(r['5'] || '0'),
        timestamp_ms: t,
        schema_source: 'fcsapi',
        field_map_used: fieldMap,
      };
    },
  },
];

export function mapSchema(raw: any): MappedBar | null {
  for (const rule of RULES) {
    if (rule.detect(raw)) {
      return rule.map(raw);
    }
  }
  return null;
}

export function explainMapping(raw: any): { detected: string; mapped: boolean } {
  for (const rule of RULES) {
    if (rule.detect(raw)) {
      return { detected: rule.name, mapped: rule.map(raw) !== null };
    }
  }
  return { detected: 'unknown', mapped: false };
}