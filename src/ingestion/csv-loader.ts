import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

export interface CsvFormat {
  readonly timestampCol: string;
  readonly timestampUnit: 'ms' | 's' | 'iso';
  readonly timeframeMs: number;
  readonly sourceId: string;
}

function requireField(r: Record<string, string>, name: string, row: number): string {
  const v = r[name];
  if (v === undefined || v === '') {
    throw new Error(`Missing field "${name}" at row ${row}`);
  }
  return v;
}

export function loadCsv(filePath: string, fmt: CsvFormat): RawDataPoint<Candle>[] {
  const raw = readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '').replace(/^\uFEFF/, '');  const records = parse(raw, { columns: true, skip_empty_lines: true }) as Record<string, string>[];

  return records.map((r, idx) => {
    const tsValue = requireField(r, fmt.timestampCol, idx);
    const eventMs =
      fmt.timestampUnit === 'ms'  ? parseInt(tsValue, 10)
      : fmt.timestampUnit === 's' ? parseInt(tsValue, 10) * 1000
      : new Date(tsValue).getTime();
    const eventTime = new Date(eventMs).toISOString();
    const closedAt  = new Date(eventMs + fmt.timeframeMs).toISOString();

    return {
      sourceId: fmt.sourceId,
      value: {
        open:   parseFloat(requireField(r, 'open',   idx)),
        high:   parseFloat(requireField(r, 'high',   idx)),
        low:    parseFloat(requireField(r, 'low',    idx)),
        close:  parseFloat(requireField(r, 'close',  idx)),
        volume: parseFloat(requireField(r, 'volume', idx)),
      },
      eventTime,
      closedAt,
      arrivalTime: eventTime,
      availabilityTime: eventTime,
      version: 1,
      fingerprint: `${fmt.sourceId}-${eventMs}`,
    };
  });
}
