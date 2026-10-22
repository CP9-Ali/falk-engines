import { Kafka } from 'kafkajs';
import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

const kafka = new Kafka({ clientId: 'falk-consumer', brokers: ['localhost:9092'] });
const consumer = kafka.consumer({ groupId: 'falk-processors' });

export async function startConsuming(
  handler: (p: RawDataPoint<Candle>) => Promise<void>,
): Promise<void> {
  await consumer.connect();
  await consumer.subscribe({ topic: 'market-data', fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const point = JSON.parse(message.value.toString()) as RawDataPoint<Candle>;
      await handler(point);
    },
  });
}
