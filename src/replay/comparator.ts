import type { EngineResultEntry } from './engine-results';

/**
 * §13: "إعادة التشغيل المطابقة"
 * يقارن نتائج replay مع النتائج الأصلية على نفس البيانات.
 */

export interface ComparisonRow {
  readonly candle_fingerprint: string;
  readonly timeframe: string;
  readonly engine: string;
  readonly old_status: string;
  readonly new_status: string;
  readonly old_value_summary: string;
  readonly new_value_summary: string;
  readonly match: boolean;
  readonly drift_reason: string;
}

export interface ReplayComparisonReport {
  readonly old_run_id: string;
  readonly new_run_id: string;
  readonly compared_at_utc: string;
  readonly total_entries: number;
  readonly matches: number;
  readonly divergences: number;
  readonly match_rate: number;
  readonly rows: ReadonlyArray<ComparisonRow>;
}

function summarize(v: Record<string, unknown>): string {
  const keys = Object.keys(v).sort();
  if (keys.length === 0) return '{}';
  const parts: string[] = [];
  for (const k of keys.slice(0, 3)) {
    const val = v[k];
    parts.push(k + '=' + (typeof val === 'number' ? val.toFixed(2) : String(val).slice(0, 20)));
  }
  if (keys.length > 3) parts.push('...');
  return parts.join(',');
}

/**
 * يقارن سجلي محرك (نفس engine + timeframe + fingerprint).
 * المطابقة = status متطابق + value "متقارب" (نفس البصمة الموجزة).
 */
export function compareEngineResults(
  oldRunId: string,
  oldEntries: ReadonlyArray<EngineResultEntry>,
  newRunId: string,
  newEntries: ReadonlyArray<EngineResultEntry>,
): ReplayComparisonReport {
  const newIndex = new Map<string, EngineResultEntry>();
  for (const e of newEntries) {
    const key = e.engine + '|' + e.timeframe + '|' + e.candle_fingerprint;
    newIndex.set(key, e);
  }

  const rows: ComparisonRow[] = [];
  let matches = 0;
  let divergences = 0;

  for (const o of oldEntries) {
    const key = o.engine + '|' + o.timeframe + '|' + o.candle_fingerprint;
    const n = newIndex.get(key);
    if (!n) continue;

    const oldSummary = summarize(o.value);
    const newSummary = summarize(n.value);
    const match = o.status === n.status && oldSummary === newSummary;
    if (match) matches++;
    else divergences++;

    rows.push({
      candle_fingerprint: o.candle_fingerprint,
      timeframe: o.timeframe,
      engine: o.engine,
      old_status: o.status,
      new_status: n.status,
      old_value_summary: oldSummary,
      new_value_summary: newSummary,
      match,
      drift_reason: match ? 'identical' : (o.status !== n.status ? 'status changed' : 'value drift'),
    });
  }

  const total = rows.length;
  return {
    old_run_id: oldRunId,
    new_run_id: newRunId,
    compared_at_utc: new Date().toISOString(),
    total_entries: total,
    matches,
    divergences,
    match_rate: total > 0 ? matches / total : 0,
    rows,
  };
}