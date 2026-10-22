import type { AuditLog } from '../audit/audit-log';
import { FalkError } from '../core/errors';
import { now } from '../core/time';

export type Role = 'VIEWER' | 'ANALYST' | 'ENGINEER' | 'APPROVER' | 'AUDITOR';

export type Action =
  | 'READ_RESULTS' | 'RUN_TASK'
  | 'PROPOSE_CONFIG' | 'APPROVE_CONFIG'
  | 'MODIFY_SOURCES' | 'READ_AUDIT'
  | 'BACKUP' | 'RESTORE';

export interface Principal {
  readonly principalId: string;
  readonly roles: ReadonlyArray<Role>;
}

export interface PermissionDecision {
  readonly allowed: boolean;
  readonly requiredRoles: ReadonlyArray<Role>;
  readonly reason: string;
}

const MATRIX: Record<Action, ReadonlyArray<Role>> = {
  READ_RESULTS:   ['VIEWER', 'ANALYST', 'ENGINEER', 'APPROVER', 'AUDITOR'],
  RUN_TASK:       ['ANALYST', 'ENGINEER', 'APPROVER'],
  PROPOSE_CONFIG: ['ENGINEER', 'APPROVER'],
  APPROVE_CONFIG: ['APPROVER'],
  MODIFY_SOURCES: ['APPROVER'],
  READ_AUDIT:     ['AUDITOR', 'APPROVER'],
  BACKUP:         ['APPROVER'],
  RESTORE:        ['APPROVER'],
};

const V = {
  schemaVersion: '1.0',
  policyVersion: 'security-v1',
  configVersion: '1.0',
  engineVersion: '1.0',
} as const;

export class AuthorizationService {
  constructor(private readonly audit: AuditLog) {}

  check(principal: Principal, action: Action): PermissionDecision {
    const required = MATRIX[action];
    const allowed = principal.roles.some(r => required.includes(r));
    const decision: PermissionDecision = {
      allowed,
      requiredRoles: required,
      reason: allowed ? `role grants ${action}` : `no role grants ${action}`,
    };
    this.audit.append({
      eventType: allowed ? 'AUTHZ_GRANTED' : 'AUTHZ_DENIED',
      engine: 'Security',
      eventTime: now(),
      recordTime: now(),
      actor: principal.principalId,
      refs: { principalId: principal.principalId },
      versions: V,
      payload: { action, allowed, requiredRoles: [...required] },
    });
    return decision;
  }

  enforce(principal: Principal, action: Action): void {
    const d = this.check(principal, action);
    if (!d.allowed) {
      throw new FalkError(
        `Principal ${principal.principalId} denied ${action}`,
        'AUTHORIZATION_DENIED',
      );
    }
  }
}