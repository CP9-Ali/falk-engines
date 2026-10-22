import { createHash } from 'crypto';
import { newId } from '../core/ids';
import type { Id, Timestamp, VersionBundle } from '../core/types';

export interface AuditEventInput {
  readonly eventType: string;
  readonly engine: string;
  readonly eventTime: Timestamp;
  readonly recordTime: Timestamp;
  readonly actor: string;
  readonly traceId?: string;
  readonly refs: Record<string, string>;
  readonly versions: VersionBundle;
  readonly payload: Record<string, unknown>;
}

export interface AuditEvent extends AuditEventInput {
  readonly eventId: Id;
  readonly previousHash?: string;
  readonly hash: string;
}

export interface AuditLog {
  append(event: AuditEventInput): void;
  readAll(): ReadonlyArray<AuditEvent>;
}

export class HashChainAuditLog implements AuditLog {
  private events: AuditEvent[] = [];
  private lastHash?: string;

  append(event: AuditEventInput): void {
    const eventId = newId('audit');
    const body = { ...event, eventId, previousHash: this.lastHash };
    const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    this.events.push({ ...body, hash });
    this.lastHash = hash;
  }

  readAll(): ReadonlyArray<AuditEvent> { return [...this.events]; }
}