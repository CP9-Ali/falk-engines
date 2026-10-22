# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅        |

## Reporting a Vulnerability

**Do NOT** open a public GitHub issue for security vulnerabilities.

Send a private email to: **security@falk-engines.local**
- Include: description, steps to reproduce, potential impact
- Response time: 48 hours
- Disclosure: 90 days coordinated disclosure

## Architecture

### Authentication (§11)
- Production: OIDC/JWT (see `src/security/oidc-auth.ts`)
- All requests must carry a verified token
- mTLS required between internal services

### Authorization (§11)
- RBAC with 5 roles: VIEWER, ANALYST, ENGINEER, APPROVER, AUDITOR
- Principle of least privilege enforced in `src/security/permissions.ts`
- Every decision (grant/deny) is audited

### Secrets Management (§11)
- **Never** commit secrets
- Use `SecretsManager` abstraction (`src/security/secrets.ts`)
- Production: AWS Secrets Manager or HashiCorp Vault
- Access to secrets is logged (name only, not value)

### Audit Logging (§10)
- HashChainAuditLog: tamper-evident
- Every security event is recorded with actor, timestamp, and content hash
- Retained according to §12 backup policy

### Backup & Recovery (§12)
- S3 Object Lock (COMPLIANCE mode, 7 years)
- Payload integrity verified via SHA-256
- Restore test required before production

### Data Protection (§12)
- Encryption at rest: SSE-S3 / KMS
- Encryption in transit: TLS 1.3
- No PII in logs

## Dependency Security

- `npm audit` runs in CI on every push
- Dependabot alerts enabled
- Critical/high vulnerabilities block merge

## Known Limitations (Testing Phase)

- OIDC verification implemented but Keycloak not yet deployed
- S3 WORM supported but not connected (in-memory offsite used in tests)
- Rate limiting not yet implemented

## Compliance

- Design follows FALK_Engine_Architecture §10, §11, §12
- Acceptance criteria: §18.1 (separation), §18.2 (traceability), §18.7 (security tested)
