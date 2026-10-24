import type { AlertChannel, Alert, DeliveryResult } from '../types';

export interface MemoryChannel extends AlertChannel {
  received(): ReadonlyArray<Alert>;
  hasDedupKey(key: string): boolean;
  reset(): void;
}

export function createMemoryChannel(name: string = 'memory'): MemoryChannel {
  const captured: Alert[] = [];
  return {
    name,
    async send(alert: Alert): Promise<DeliveryResult> {
      captured.push(alert);
      return {
        channel: name,
        alert_id: alert.id,
        ok: true,
        sent_at: new Date().toISOString(),
      };
    },
    received() { return captured.slice(); },
    hasDedupKey(key) { return captured.some((a) => a.dedup_key === key); },
    reset() { captured.length = 0; },
  };
}
