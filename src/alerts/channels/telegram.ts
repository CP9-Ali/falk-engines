import type { AlertChannel, Alert, DeliveryResult } from '../types';
import type { FetchLike } from './webhook';

export interface TelegramOptions {
  readonly botToken: string;
  readonly chatId: string;
  readonly fetchFn?: FetchLike;
  readonly timeoutMs?: number;
}

function formatMessage(alert: Alert): string {
  const parts = [
    '[' + alert.severity + '] ' + alert.category,
    alert.message,
    'id: ' + alert.id,
    'raised: ' + alert.raised_at,
  ];
  if (alert.metadata) {
    const entries = Object.entries(alert.metadata);
    if (entries.length > 0) {
      parts.push('meta: ' + entries.map(([k, v]) => k + '=' + String(v)).join(', '));
    }
  }
  return parts.join('\n');
}

export function createTelegramChannel(opts: TelegramOptions): AlertChannel {
  if (!opts.botToken) throw new Error('telegram: botToken required');
  if (!opts.chatId) throw new Error('telegram: chatId required');
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof fetchFn !== 'function') {
    throw new Error('telegram: fetch not available; pass fetchFn explicitly');
  }
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const url = 'https://api.telegram.org/bot' + opts.botToken + '/sendMessage';

  return {
    name: 'telegram',
    async send(alert: Alert): Promise<DeliveryResult> {
      const sentAt = new Date().toISOString();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const body = JSON.stringify({
          chat_id: opts.chatId,
          text: formatMessage(alert),
          disable_notification: alert.severity !== 'CRITICAL',
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('telegram timeout after ' + timeoutMs + 'ms')), timeoutMs);
        });
        const fetchPromise = fetchFn(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
        const res = await Promise.race([fetchPromise, timeoutPromise]);
        if (res.ok) {
          return { channel: 'telegram', alert_id: alert.id, ok: true, sent_at: sentAt };
        }
        const text = await res.text().catch(() => '');
        return {
          channel: 'telegram',
          alert_id: alert.id,
          ok: false,
          sent_at: sentAt,
          error: 'HTTP ' + res.status + (text ? ' ' + text.slice(0, 200) : ''),
        };
      } catch (err) {
        return {
          channel: 'telegram',
          alert_id: alert.id,
          ok: false,
          sent_at: sentAt,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };
}
