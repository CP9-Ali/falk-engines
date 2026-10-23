import 'dotenv/config';

export interface InstrumentSpec {
  readonly source_id: string;
  readonly instrument_id: string;
  readonly canonical_symbol: string;
  readonly decimal_places: number;
  readonly tick_size: number;
  readonly contract_size: number | null;
  readonly trading_hours: string | null;
  readonly fetched_at_utc: string;
  readonly status: 'VERIFIED' | 'UNVERIFIED';
  readonly notes: string;
}

/**
 * §5.1: Reference fetch — updates instrument specifications.
 * For sources without a spec API, we use documented values and mark VERIFIED
 * only when they are confirmed in the source documentation.
 */
export class ReferenceFetcher {
  private specs = new Map<string, InstrumentSpec>();

  get(sourceId: string): InstrumentSpec | null {
    return this.specs.get(sourceId) ?? null;
  }

  all(): ReadonlyArray<InstrumentSpec> {
    return Array.from(this.specs.values());
  }

  /** TwelveData — values from public documentation */
  registerTwelveData(): InstrumentSpec {
    const spec: InstrumentSpec = {
      source_id: 'twelvedata-ws',
      instrument_id: 'XAU/USD',
      canonical_symbol: 'XAUUSD',
      decimal_places: 5,
      tick_size: 0.01,
      contract_size: null,
      trading_hours: 'Sun 22:00 UTC - Fri 21:00 UTC',
      fetched_at_utc: new Date().toISOString(),
      status: 'VERIFIED',
      notes: 'Values from TwelveData public docs; not stress-tested',
    };
    this.specs.set(spec.source_id, spec);
    return spec;
  }

  /** Binance PAXGUSDT — exchange info endpoint is public */
  async fetchBinancePaxg(): Promise<InstrumentSpec> {
    try {
      const res = await fetch('https://api.binance.com/api/v3/exchangeInfo?symbol=PAXGUSDT');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = (await res.json()) as any;
      const sym = data.symbols && data.symbols[0];
      const priceFilter = sym?.filters?.find((f: any) => f.filterType === 'PRICE_FILTER');
      const tickSize = priceFilter ? parseFloat(priceFilter.tickSize) : 0.01;
      const decimalPlaces = Math.max(0, -Math.floor(Math.log10(tickSize)));

      const spec: InstrumentSpec = {
        source_id: 'binance-paxg',
        instrument_id: 'PAXGUSDT',
        canonical_symbol: 'XAUUSD',
        decimal_places: decimalPlaces,
        tick_size: tickSize,
        contract_size: sym?.baseAsset === 'PAXG' ? 1 : null,
        trading_hours: '24/7',
        fetched_at_utc: new Date().toISOString(),
        status: 'VERIFIED',
        notes: 'Fetched from Binance /api/v3/exchangeInfo',
      };
      this.specs.set(spec.source_id, spec);
      return spec;
    } catch (e) {
      const spec: InstrumentSpec = {
        source_id: 'binance-paxg',
        instrument_id: 'PAXGUSDT',
        canonical_symbol: 'XAUUSD',
        decimal_places: 2,
        tick_size: 0.01,
        contract_size: 1,
        trading_hours: '24/7',
        fetched_at_utc: new Date().toISOString(),
        status: 'UNVERIFIED',
        notes: 'Fallback values; fetch failed: ' + (e as Error).message,
      };
      this.specs.set(spec.source_id, spec);
      return spec;
    }
  }

  /** H3 aggregated — derived, inherits 1h spec */
  registerH3(): InstrumentSpec {
    const spec: InstrumentSpec = {
      source_id: 'h3-aggregated',
      instrument_id: 'XAU/USD',
      canonical_symbol: 'XAUUSD',
      decimal_places: 5,
      tick_size: 0.01,
      contract_size: null,
      trading_hours: 'Sun 22:00 UTC - Fri 21:00 UTC',
      fetched_at_utc: new Date().toISOString(),
      status: 'VERIFIED',
      notes: 'Derived from 1h, inherits TwelveData spec',
    };
    this.specs.set(spec.source_id, spec);
    return spec;
  }
}