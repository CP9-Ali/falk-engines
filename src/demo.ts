import { runAllScenarios } from './scenarios/appendix-b';

const results = runAllScenarios();
console.log('\n=== FALK — Appendix B scenarios ===\n');
for (const r of results) {
  console.log(`${r.passed ? '✓' : '✗'} ${r.name}  —  ${r.details}`);
}
const failed = results.filter(r => !r.passed).length;
console.log(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed === 0 ? 0 : 1);