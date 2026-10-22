import { describe, it, expect } from 'vitest';
import { runAllScenarios } from '../scenarios/appendix-b';

describe('Appendix B — all 8 scenarios', () => {
  const results = runAllScenarios();
  for (const r of results) {
    it(r.name, () => expect(r.passed, r.details).toBe(true));
  }
});