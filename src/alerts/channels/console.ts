import type { AlertChannel, Alert, DeliveryResult } from '../types';

export interface ConsoleLike {
  log(...args: unknown[]): void;
}

export function createConsoleChannel(out: ConsoleLike = console): AlertChannel {
  return {
    name: 'console',
    async send(alert: Alert): Promise<DeliveryResult> {
      const sentAt = new Date().toISOString();
      try {
        out.log(
          '[' + alert.severity + '][' + alert.category + '] ' + alert.message,
          { id: alert.id, dedup_key: alert.dedup_key, raised_at: alert.raised_at },
        );
        return { channel: 'console', alert_id: alert.id, ok: true, sent_at: sentAt };
      } catch (err) {
        return {
          channel: 'console',
          alert_id: alert.id,
          ok: false,
          sent_at: sentAt,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
