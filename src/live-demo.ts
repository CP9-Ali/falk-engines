import { startBinanceFeed } from './ingestion/binance-ws';
import { startConsuming } from './ingestion/kafka-consumer';

async function main() {
  console.log('Starting consumer...');
  startConsuming(async (p) => {
    console.log(`[recv] ${p.sourceId} ${p.eventTime} close=${p.value.close}`);
  });

  console.log('Starting Binance feed...');
  await startBinanceFeed('btcusdt');
}

main().catch(console.error);
