import { execSync } from 'node:child_process';
import { buildFullReport } from './gates/acceptance';

const line = '='.repeat(60);
console.log(`\n${line}\n FALK — Acceptance Report  (§15 + §18)\n${line}\n`);
console.log('[1/2] Running test suite...\n');

try {
  execSync('npx vitest run --reporter=dot', { stdio: 'inherit', env: process.env });
} catch {
  console.error('\n[FAIL] Test suite failed. CERTIFICATE REVOKED.');
  process.exit(1);
}

console.log('\n[2/2] Generating certificate from verified gates...\n');
const report = buildFullReport();

console.log('§15 — Release Gates:\n');
for (const g of report.gates) {
  console.log(`${g.passed ? '[PASS]' : '[FAIL]'} ${g.gateId} ${g.name}`);
  console.log(`        -> ${g.evidence}`);
}

console.log(`\n§18 — Design Acceptance Criteria:\n`);
for (const c of report.criteria) {
  console.log(`${c.satisfied ? '[PASS]' : '[FAIL]'} ${c.id} ${c.name}`);
  console.log(`        -> ${c.evidence}`);
}

console.log(`\n${line}`);
if (report.allGatesPassed && report.allCriteriaMet) {
  console.log('[CERTIFIED] All §15 gates and §18 criteria satisfied');
} else {
  console.log('[NOT CERTIFIED] Review items marked [FAIL]');
}
console.log(`${line}\n`);

process.exit(report.allGatesPassed && report.allCriteriaMet ? 0 : 1);