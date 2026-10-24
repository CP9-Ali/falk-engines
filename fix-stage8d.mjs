import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const F = 'src/tests/stage8d-pipeline-time-blocking.test.ts';
if (!existsSync(F)) {
  console.error('❌ test file not found');
  process.exit(1);
}
let s = readFileSync(F, 'utf8');

// 1) Constructor: pass audit
s = s.replace(
  'const auth = new AuthorizationService();',
  'const auth = new AuthorizationService(audit);'
);

// 2) Remove .grant() line (doesn't exist)
s = s.replace(/^\s*auth\.grant\([^\n]*\);\s*$/m, '');

// 3) Collapse double blank lines
s = s.replace(/\n\n\n+/g, '\n\n');

writeFileSync(F, s, 'utf8');
console.log('✅ stage8d test fixed (constructor arg + removed grant)');

console.log('\n=== TSC ===');
try {
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
  console.log('✅ tsc passed');
} catch { console.error('❌ tsc failed'); process.exit(2); }

console.log('\n=== TEST (stage8d only) ===');
try {
  execSync('npx vitest run src/tests/stage8d-pipeline-time-blocking.test.ts', { stdio: 'inherit' });
  console.log('✅ stage8d tests passed');
} catch { console.error('❌ stage8d tests failed'); process.exit(3); }

console.log('\n🎉 Stage 8D fixed. Run full suite: npm test');
