import type { AuditLog } from '../audit/audit-log';
import { now } from '../core/time';
import { FalkError } from '../core/errors';

const V = { schemaVersion: '1.0', policyVersion: 'security-v1', configVersion: '1.0', engineVersion: '1.0' };

export interface SecretsBackend {
  get(name: string): string | null;
  set(name: string, value: string): void;
  has(name: string): boolean;
}

export class SecretsManager {
  constructor(
    private readonly backend: SecretsBackend,
    private readonly audit: AuditLog,
  ) {}

  get(name: string, actor: string): string {
    if (!this.backend.has(name)) {
      throw new FalkError(`Secret ${name} not found`, 'SECRET_NOT_FOUND');
    }
    this.audit.append({
      eventType: 'SECRET_ACCESSED',
      engine: 'Security',
      eventTime: now(), recordTime: now(),
      actor,
      refs: { secretName: name },
      versions: V,
      payload: { secretName: name },
    });
    return this.backend.get(name)!;
  }

  set(name: string, value: string, actor: string): void {
    this.backend.set(name, value);
    this.audit.append({
      eventType: 'SECRET_SET',
      engine: 'Security',
      eventTime: now(), recordTime: now(),
      actor,
      refs: { secretName: name },
      versions: V,
      payload: { secretName: name },
    });
  }
}

export class InMemorySecrets implements SecretsBackend {
  private readonly map = new Map<string, string>();
  get(name: string): string | null { return this.map.get(name) ?? null; }
  set(name: string, value: string): void { this.map.set(name, value); }
  has(name: string): boolean { return this.map.has(name); }
}