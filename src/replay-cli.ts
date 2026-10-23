import 'dotenv/config';
import { ReplayEngine } from './replay/replay-engine';           
async function main() {
  const engine = new ReplayEngine();
  const available = engine.listAvailable();

  console.log('\n=== FALK Replay ===\n');
  console.log('Available raw snapshots:');
  for (const a of available) {
    console.log('  ' + a.source + '/' + a.timeframe + ' : ' + a.count + ' files');
  }

  const source = process.argv[2];
  const tf = process.argv[3];
  const limit = process.argv[4] ? parseInt(process.argv[4]) : 20;

  if (!source || !tf) {
    console.log('\nUsage: npm run replay -- <source> <timeframe> [limit]');
    console.log('Example: npm run replay -- twelvedata-ws 1m 30\n');
    return;
  }

  const records = engine.load({ source_id: source, timeframe: tf, limit });
  console.log('\nLoaded ' + records.length + ' records from ' + source + '/' + tf);

  for (const r of records.slice(0, 5)) {
    const candle = engine.toCandle(r);
    console.log('  ' + r.event_time_utc + ' → ' + (candle ? 'C=' + candle.value.close.toFixed(2) : 'unparseable') + ' [lineage=' + r.lineage_id.slice(0, 8) + ']');
  }
  if (records.length > 5) {
    console.log('  ... and ' + (records.length - 5) + ' more');
  }
}

main().catch(console.error);