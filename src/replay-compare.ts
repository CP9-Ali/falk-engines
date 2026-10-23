import 'dotenv/config';
import { EngineResultsLog } from './replay/engine-results';
import { compareEngineResults } from './replay/comparator';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npm run replay-compare -- <old_run_id> <new_run_id>');
    console.error('Example: npm run replay-compare -- run-A run-B');
    process.exit(1);
  }
  const [oldId, newId] = args;
  const log = new EngineResultsLog('.backup/engine-runs');
  const oldEntries = log.list(oldId!);
  const newEntries = log.list(newId!);

  console.log('\n=== FALK Replay Comparator ===\n');
  console.log('Old run: ' + oldId + ' (' + oldEntries.length + ' entries)');
  console.log('New run: ' + newId + ' (' + newEntries.length + ' entries)');

  if (oldEntries.length === 0) { console.error('\n[FAIL] Old run has no entries'); process.exit(1); }
  if (newEntries.length === 0) { console.error('\n[FAIL] New run has no entries'); process.exit(1); }

  const report = compareEngineResults(oldId!, oldEntries, newId!, newEntries);

  console.log('\n--- Summary ---');
  console.log('Total compared: ' + report.total_entries);
  console.log('Matches:        ' + report.matches);
  console.log('Divergences:    ' + report.divergences);
  console.log('Match rate:     ' + (report.match_rate * 100).toFixed(2) + '%');

  if (report.divergences > 0) {
    console.log('\n--- First 10 divergences ---');
    const drifted = report.rows.filter(r => !r.match).slice(0, 10);
    for (const r of drifted) {
      console.log('  ' + r.timeframe + '/' + r.engine + '/' + r.candle_fingerprint.slice(0, 16));
      console.log('    ' + r.old_status + ' (' + r.old_value_summary + ')');
      console.log('    -> ' + r.new_status + ' (' + r.new_value_summary + ')');
      console.log('    reason: ' + r.drift_reason);
    }
    if (report.divergences > 10) {
      console.log('\n  ... and ' + (report.divergences - 10) + ' more');
    }
  }

  if (report.match_rate === 1) {
    console.log('\n[CERTIFIED] 100% match — replay is reproducible');
  } else if (report.match_rate >= 0.95) {
    console.log('\n[WARN] Match rate >= 95% — mostly reproducible with minor drift');
  } else {
    console.log('\n[FAIL] Match rate < 95% — non-determinism detected');
  }

  process.exit(report.match_rate === 1 ? 0 : 2);
}

main().catch(console.error);