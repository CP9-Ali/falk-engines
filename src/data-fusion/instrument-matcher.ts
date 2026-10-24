export type InstrumentMatcher = (a: string | undefined, b: string | undefined) => boolean;

/**
 * ?8.5B ? Default matcher: literal equality.
 * Both undefined ? match (backward compat).
 * One undefined ? match (no info, no conflict).
 * Caller may override to wrap areInstrumentsEquivalent() from canonical.ts.
 */
export const literalInstrumentMatcher: InstrumentMatcher = (a, b) => {
  if (a === undefined || b === undefined) return true;
  return a === b;
};
