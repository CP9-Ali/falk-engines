import type { AuditLog } from '../audit/audit-log';
import { now } from '../core/time';

const V = { schemaVersion: '1.0', policyVersion: 'security-v1', configVersion: '1.0', engineVersion: '1.0' };

export interface ConfigChange {
  readonly key: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string;
  readonly changedBy: string;
  readonly changedAt: string;
}

export class ConfigChangeLog {
  constructor(private readonly audit: AuditLog) {}

  record(change: Omit<ConfigChange, 'changedAt'>): ConfigChange {
    const full: ConfigChange = { ...change, changedAt: now() };
    this.audit.append({
      eventType: 'CONFIG_CHANGED',
      engine: 'Security',
      eventTime: full.changedAt, recordTime: now(),
      actor: full.changedBy,
      refs: { key: full.key },
      versions: V,
      payload: { key: full.key, before: full.before, after: full.after, reason: full.reason },
    });
    return full;
  }
}