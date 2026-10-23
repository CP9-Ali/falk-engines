/**
 * §2.8: كل تغيير في القاعدة أو الإعداد أو المعادلة ينتج إصداراً جديداً.
 * نسخة منفصلة لكل محرك — ليست واحدة موحّدة.
 */
export const ENGINE_VERSIONS = {
  ingestion: '1.0.0',
  quality: '1.0.0',
  normalization: '1.0.0',
  fusion: '1.0.0',
  feature: '1.0.0',
  multi_timeframe: '1.0.0',
  event_intelligence: '1.0.0',
  evidence: '1.0.0',
  replay: '1.0.0',
} as const;

export const FALK_CODE_VERSION = '1.0.0';

export interface VersionRecord {
  readonly engine: string;
  readonly version: string;
  readonly changed_at_utc: string;
  readonly change_reason: string;
}

/** سجل تاريخي — كل تغيير يُسجَّل. لا تُمسح النسخ القديمة. */
export const VERSION_HISTORY: ReadonlyArray<VersionRecord> = [
  { engine: 'ingestion', version: '1.0.0', changed_at_utc: '2026-10-23T00:00:00Z', change_reason: 'initial' },
  { engine: 'quality', version: '1.0.0', changed_at_utc: '2026-10-23T00:00:00Z', change_reason: 'initial' },
  { engine: 'normalization', version: '1.0.0', changed_at_utc: '2026-10-23T00:00:00Z', change_reason: 'initial' },
  { engine: 'fusion', version: '1.0.0', changed_at_utc: '2026-10-23T00:00:00Z', change_reason: 'initial' },
  { engine: 'feature', version: '1.0.0', changed_at_utc: '2026-10-23T00:00:00Z', change_reason: 'initial' },
  { engine: 'multi_timeframe', version: '1.0.0', changed_at_utc: '2026-10-23T00:00:00Z', change_reason: 'initial' },
  { engine: 'event_intelligence', version: '1.0.0', changed_at_utc: '2026-10-23T00:00:00Z', change_reason: 'initial' },
  { engine: 'evidence', version: '1.0.0', changed_at_utc: '2026-10-23T00:00:00Z', change_reason: 'initial' },
  { engine: 'replay', version: '1.0.0', changed_at_utc: '2026-10-23T00:00:00Z', change_reason: 'initial' },
];

export function engineVersion(engine: keyof typeof ENGINE_VERSIONS): string {
  return ENGINE_VERSIONS[engine];
}

export function versionBundle(): {
  code: string;
  engines: typeof ENGINE_VERSIONS;
} {
  return { code: FALK_CODE_VERSION, engines: ENGINE_VERSIONS };
}