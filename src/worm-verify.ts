import { LocalWormOffsite } from './backup/local-worm-offsite';

const sink = new LocalWormOffsite({ rootDir: 'backups' });
const report = sink.verifyAll();

console.log('\n=== WORM Integrity Report ===\n');
console.log(`Total snapshots: ${report.totalCount}`);
console.log(`Locked:          ${report.lockedCount}`);
console.log(`Violations:      ${report.violations.length}`);

if (report.ok) {
  console.log('\n✅ All snapshots intact\n');
  process.exit(0);
} else {
  console.log('\n❌ Violations detected:\n');
  for (const v of report.violations) console.log(`  - ${v}`);
  process.exit(1);
}