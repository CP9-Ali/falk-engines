import type { Timestamp } from './types';

export class FalkError extends Error {
  constructor(message: string, readonly code: string) {
    super(message); this.name = 'FalkError';
  }
}

export class LookaheadLeakageError extends FalkError {
  constructor(readonly leaks: ReadonlyArray<{ sourceId: string; availableAt: Timestamp; cutoff: Timestamp }>) {
    super(`Lookahead leakage: ${leaks.length} point(s) were not available at cutoff`, 'LOOKAHEAD_LEAKAGE');
    this.name = 'LookaheadLeakageError';
  }
}

export class ConflictUnresolvedError extends FalkError {
  constructor(detail: string) {
    super(`Source conflict could not be resolved: ${detail}`, 'CONFLICT_UNRESOLVED');
    this.name = 'ConflictUnresolvedError';
  }
}

export class IllegalTransitionError extends FalkError {
  constructor(from: string, to: string) {
    super(`Illegal transition ${from} -> ${to}`, 'ILLEGAL_TRANSITION');
    this.name = 'IllegalTransitionError';
  }
}