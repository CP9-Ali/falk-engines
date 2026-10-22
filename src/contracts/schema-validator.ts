import type { MessageEnvelope } from './messages';

export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: ReadonlyArray<ValidationError>;
}

export class SchemaValidator {
  private readonly knownVersions = new Set<string>(['1.0']);

  validate(env: MessageEnvelope): ValidationResult {
    const errors: ValidationError[] = [];

    if (!env.messageId) errors.push({ field: 'messageId', message: 'required' });
    if (!env.requestId) errors.push({ field: 'requestId', message: 'required' });
    if (!env.traceId) errors.push({ field: 'traceId', message: 'required' });
    if (!env.sender) errors.push({ field: 'sender', message: 'required' });
    if (!env.recipient) errors.push({ field: 'recipient', message: 'required' });
    if (!env.policyVersion) errors.push({ field: 'policyVersion', message: 'required' });

    if (!this.knownVersions.has(env.schemaVersion)) {
      errors.push({ field: 'schemaVersion', message: `unknown version ${env.schemaVersion}` });
    }

    if (!env.dataReference?.snapshotId || !env.dataReference?.contentFingerprint) {
      errors.push({ field: 'dataReference', message: 'snapshotId and contentFingerprint required' });
    }

    if (!env.timeContext?.eventTime || !env.timeContext?.arrivalTime ||
        !env.timeContext?.processingTime || !env.timeContext?.asOfCutoff) {
      errors.push({ field: 'timeContext', message: 'all four timestamps required' });
    }

    return { valid: errors.length === 0, errors };
  }

  registerVersion(version: string): void {
    this.knownVersions.add(version);
  }
}