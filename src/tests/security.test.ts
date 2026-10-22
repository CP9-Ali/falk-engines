import { describe, it, expect } from 'vitest';
import { HashChainAuditLog } from '../audit/audit-log';
import { AuthorizationService, type Principal } from '../security/permissions';

describe('§11 Security & Permissions', () => {
  const analyst: Principal = { principalId: 'a', roles: ['ANALYST'] };
  const engineer: Principal = { principalId: 'e', roles: ['ENGINEER'] };
  const approver: Principal = { principalId: 'p', roles: ['APPROVER'] };

  it('separates propose from approve', () => {
    const auth = new AuthorizationService(new HashChainAuditLog());
    expect(auth.check(engineer, 'PROPOSE_CONFIG').allowed).toBe(true);
    expect(auth.check(engineer, 'APPROVE_CONFIG').allowed).toBe(false);
    expect(auth.check(approver, 'APPROVE_CONFIG').allowed).toBe(true);
  });

  it('only APPROVER may modify sources', () => {
    const auth = new AuthorizationService(new HashChainAuditLog());
    expect(auth.check(analyst, 'MODIFY_SOURCES').allowed).toBe(false);
    expect(auth.check(engineer, 'MODIFY_SOURCES').allowed).toBe(false);
    expect(auth.check(approver, 'MODIFY_SOURCES').allowed).toBe(true);
  });

  it('denied attempts are audited', () => {
    const audit = new HashChainAuditLog();
    const auth = new AuthorizationService(audit);
    expect(() => auth.enforce(analyst, 'APPROVE_CONFIG')).toThrow();
    const denials = audit.readAll().filter(e => e.eventType === 'AUTHZ_DENIED');
    expect(denials.length).toBeGreaterThan(0);
  });
});