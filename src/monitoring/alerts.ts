import type { AuditLog } from '../audit/audit-log';
import { newId } from '../core/ids';
import { now } from '../core/time';

export type AlertLevel = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';

export interface Alert {
  readonly alertId: string;
  readonly level: AlertLevel;
  readonly category: string;
  readonly message: string;
  readonly raisedAt: string;
  readonly dedupKey: string;
  readonly count: number;
}

const V = { schemaVersion: '1.0', policyVersion: 'monitoring-v1', configVersion: '1.0', engineVersion: '1.0' };

export class AlertManager {
  private readonly active_ = new Map<string, Alert>();

  constructor(
    private readonly audit: AuditLog,
    readonly aggregationWindowMs = 5 * 60 * 1000,
  ) {}

  raise(level: AlertLevel, category: string, message: string, dedupKey: string, actor: string): Alert {
    const existing = this.active_.get(dedupKey);
    if (existing) {
      const updated: Alert = { ...existing, count: existing.count + 1 };
      this.active_.set(dedupKey, updated);
      return updated;
    }
    const a: Alert = {
      alertId: newId('alert'), level, category, message, dedupKey,
      raisedAt: now(), count: 1,
    };
    this.active_.set(dedupKey, a);
    this.audit.append({
      eventType: 'ALERT_RAISED',
      engine: 'Monitoring',
      eventTime: a.raisedAt, recordTime: now(),
      actor,
      refs: { alertId: a.alertId },
      versions: V,
      payload: { level, category, dedupKey },
    });
    return a;
  }

  resolve(dedupKey: string): void { this.active_.delete(dedupKey); }
  active(): ReadonlyArray<Alert> { return [...this.active_.values()]; }
  byLevel(level: AlertLevel): ReadonlyArray<Alert> { return this.active().filter(a => a.level === level); }
}