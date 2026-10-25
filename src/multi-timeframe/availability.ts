export type CandleSource = 'source' | 'derived';

export interface AvailabilityReport {
  readonly timeframe: string;
  readonly open_utc: string;
  readonly close_utc: string;
  readonly available_at_utc: string;
  readonly is_final: boolean;
  readonly source: CandleSource;
  readonly missing_children: number;
  readonly conflicts: readonly string[];
}

const TF_MS: Record<string, number> = {
  // Canonical (uppercase + digit)
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  M30: 30 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
  W1: 7 * 24 * 60 * 60_000,
  // Aliases used by live-gold / TwelveData
  '1m': 60_000,
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  H3: 3 * 60 * 60_000,
  '3h': 3 * 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
  '1w': 7 * 24 * 60 * 60_000,
};

export function timeframeMs(tf: string): number {
  const v = TF_MS[tf];
  if (!v) throw new Error('unknown timeframe: ' + tf);
  return v;
}

export function alignOpen(utc: string, tf: string, calendarOffsetMs = 0): string {
  const t = Date.parse(utc);
  if (Number.isNaN(t)) throw new Error('invalid utc: ' + utc);
  const size = timeframeMs(tf);
  const aligned = Math.floor((t - calendarOffsetMs) / size) * size + calendarOffsetMs;
  return new Date(aligned).toISOString();
}

export function computeAvailability(input: {
  timeframe: string;
  open_utc: string;
  now_utc: string;
  source: CandleSource;
  missingChildren?: number;
  conflicts?: readonly string[];
}): AvailabilityReport {
  const size = timeframeMs(input.timeframe);
  const openMs = Date.parse(input.open_utc);
  if (Number.isNaN(openMs)) throw new Error('invalid open_utc: ' + input.open_utc);
  const closeMs = openMs + size;
  const nowMs = Date.parse(input.now_utc);
  if (Number.isNaN(nowMs)) throw new Error('invalid now_utc: ' + input.now_utc);
  const isFinal = nowMs >= closeMs;
  return {
    timeframe: input.timeframe,
    open_utc: new Date(openMs).toISOString(),
    close_utc: new Date(closeMs).toISOString(),
    available_at_utc: new Date(closeMs).toISOString(),
    is_final: isFinal,
    source: input.source,
    missing_children: input.missingChildren ?? 0,
    conflicts: input.conflicts ? [...input.conflicts] : [],
  };
}

export function canUseHigherTf(
  report: AvailabilityReport,
  policy: 'closed-only' | 'allow-live'
): boolean {
  if (report.is_final) return true;
  return policy === 'allow-live';
}

export function assertClosedOrReject(
  report: AvailabilityReport,
  policy: 'closed-only' | 'allow-live'
): void {
  if (!canUseHigherTf(report, policy)) {
    throw new Error('higher timeframe ' + report.timeframe + ' not closed');
  }
}

export function detectMissingChildren(
  childOpenUtcList: readonly string[],
  parent: { timeframe: string; open_utc: string },
  childTf: string
): string[] {
  const parentSize = timeframeMs(parent.timeframe);
  const childSize = timeframeMs(childTf);
  if (parentSize % childSize !== 0) {
    throw new Error('incompatible: ' + parent.timeframe + ' not multiple of ' + childTf);
  }
  const expected = parentSize / childSize;
  const present = new Set(childOpenUtcList.map((u) => alignOpen(u, childTf)));
  const missing: string[] = [];
  const start = Date.parse(parent.open_utc);
  for (let i = 0; i < expected; i++) {
    const childOpen = new Date(start + i * childSize).toISOString();
    if (!present.has(childOpen)) missing.push(childOpen);
  }
  return missing;
}

export function sourceTag(r: AvailabilityReport): string {
  return r.timeframe + ':' + r.source;
}

export function assertNoSourceMix(a: AvailabilityReport, b: AvailabilityReport): void {
  if (a.timeframe === b.timeframe && a.source !== b.source) {
    throw new Error('source/derived mix on ' + a.timeframe + ' must be tagged separately');
  }
}
