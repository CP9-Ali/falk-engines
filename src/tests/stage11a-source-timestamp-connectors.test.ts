import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILES = [
  'src/ingestion/binance-live.ts',
  'src/ingestion/twelvedata-ws.ts',
  'src/ingestion/h3-aggregator.ts',
  'src/ingestion/binance-history.ts',
  'src/ingestion/twelvedata-xau.ts',
];

describe('Stage 11A — connectors preserve sourceTimestamp', () => {
  for (const f of FILES) {
    it(f + ' sets sourceTimestamp on RawDataPoint', () => {
      const content = readFileSync(resolve(f), 'utf8');
      expect(content).toMatch(/sourceTimestamp:/);
    });
  }

  it('h3-aggregator propagates upstream sourceTimestamp', () => {
    const content = readFileSync(resolve('src/ingestion/h3-aggregator.ts'), 'utf8');
    expect(content).toMatch(/sourceTimestamp:\s*first\.sourceTimestamp/);
  });

  it('every sourceTimestamp: appears in an object that also has eventTime:', () => {
    for (const f of FILES) {
      const content = readFileSync(resolve(f), 'utf8');
      // Each sourceTimestamp must be preceded by eventTime within 3 lines
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (ln && ln.includes('sourceTimestamp:')) {
          const window = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
          expect(window).toMatch(/eventTime:/);
        }
      }
    }
  });
});
