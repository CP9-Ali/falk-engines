import { LocalWormOffsite } from './backup/local-worm-offsite';
import { BackupManager } from './backup/backup-manager';
import { HashChainAuditLog } from './audit/audit-log';

console.log('\n=== FALK Local WORM Demo ===\n');

const sink = new LocalWormOffsite({ rootDir: 'backups', retentionDays: 2555 });
const mgr = new BackupManager(
  new HashChainAuditLog(),
  { rpoMs: 60_000, rtoMs: 10_000, offsiteRequired: true },
  sink,
);

const s = mgr.takeSnapshot('FULL', 'Hello from FALK!', 'demo');
console.log(`✓ Snapshot created: ${s.snapshotId}`);
console.log(`  Hash:             ${s.payloadHash}`);
console.log(`  Locked for:       7 years`);
console.log(`  Location:         backups/snapshots/${s.snapshotId}.json`);

const r = mgr.testRestore(s.snapshotId, 'demo');
console.log(`\n✓ Restore tested:`);
console.log(`  OK:               ${r.ok}`);
console.log(`  Integrity:        ${r.integrityOk}`);
console.log(`  RTO:              ${r.rtoActualMs}ms (limit: 10000ms)`);

const report = sink.verifyAll();
console.log(`\n✓ Integrity report:`);
console.log(`  Total:            ${report.totalCount}`);
console.log(`  Locked:           ${report.lockedCount}`);
console.log(`  Violations:       ${report.violations.length}`);

try {
  sink.store(s);
  console.log(`\n❌ WORM violated — overwrite succeeded!`);
} catch (e: any) {
  console.log(`\n✓ WORM protection:`);
  console.log(`  Overwrite refused: ${e.message}`);
}

console.log(`\n📁 Check:`);
console.log(`  backups/manifest.json`);
console.log(`  backups/snapshots/${s.snapshotId}.json`);
console.log('');