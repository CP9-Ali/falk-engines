import { describe, it, expect } from 'vitest';
import { ReferenceFetcher } from '../ingestion/reference-fetcher';

describe('ReferenceFetcher (§5.1)', () => {
  it('registers TwelveData spec', () => {
    const rf = new ReferenceFetcher();
    const spec = rf.registerTwelveData();
    expect(spec.source_id).toBe('twelvedata-ws');
    expect(spec.status).toBe('VERIFIED');
    expect(spec.decimal_places).toBe(5);
  });

  it('registers H3 spec', () => {
    const rf = new ReferenceFetcher();
    const spec = rf.registerH3();
    expect(spec.source_id).toBe('h3-aggregated');
    expect(spec.status).toBe('VERIFIED');
  });

  it('get returns registered spec', () => {
    const rf = new ReferenceFetcher();
    rf.registerTwelveData();
    expect(rf.get('twelvedata-ws')).not.toBeNull();
    expect(rf.get('unknown')).toBeNull();
  });

  it('all returns all specs', () => {
    const rf = new ReferenceFetcher();
    rf.registerTwelveData();
    rf.registerH3();
    expect(rf.all().length).toBe(2);
  });

  it('fetchBinancePaxg returns UNVERIFIED on network failure', async () => {
    // Mock fetch to fail
    const origFetch = global.fetch;
    (global as any).fetch = async () => ({ ok: false, status: 500 });
    const rf = new ReferenceFetcher();
    const spec = await rf.fetchBinancePaxg();
    expect(spec.status).toBe('UNVERIFIED');
    expect(spec.notes).toContain('fetch failed');
    (global as any).fetch = origFetch;
  });
});