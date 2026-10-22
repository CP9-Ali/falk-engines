import { BinanceLiveSource } from './ingestion/binance-live';
import { MemoryBuffer } from './ingestion/memory-buffer';

const buffer = new MemoryBuffer(1000);

console.log('\n=== FALK — Live Binance Feed ===\n');
console.log('Symbol: btcusdt @ 1h klines');
console.log('Mode:   closed candles only (no lookahead)');
console.log('Stop:   Ctrl+C\n');

const source = new BinanceLiveSource({
  symbol: 'btcusdt',
  emitInProgress: true,
  onPoint: async (p) => {
    buffer.push(p);
    const stats = buffer.stats();
    const mark = p.fingerprint.endsWith('closed') ? '[CLOSED]' : '[open]  ';
    console.log(
      `${mark} ${p.eventTime} close=${p.value.close.toFixed(2)} ` +
      `vol=${p.value.volume.toFixed(2)} | buffer size=${stats.size} produced=${stats.produced}`
    );
  },
});

source.start().catch((e) => {
  console.error('Failed to start:', e);
  process.exit(1);
});

process.on('SIGINT', async () => {
  console.log('\n\nShutting down...');
  await source.stop();
  const stats = buffer.stats();
  console.log(`\nFinal stats:`);
  console.log(`  Produced: ${stats.produced}`);
  console.log(`  Consumed: ${stats.consumed}`);
  console.log(`  Dropped:  ${stats.dropped}`);
  console.log(`  In buffer: ${stats.size}`);
  process.exit(0);
});