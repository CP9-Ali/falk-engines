import type { AlertChannel, Alert, DeliveryResult } from '../types';

export interface FetchLike {
  (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface WebhookOptions {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly fetchFn?: FetchLike;
  readonly timeoutMs?: number;
}

export function createWebhookChannel(opts: WebhookOptions): AlertChannel {
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  if (typeof fetchFn !== 'function') {
    throw new Error('webhook: fetch not available; pass fetchFn explicitly');
  }
  const headers = { 'content-type': 'application/json', ...opts.headers };
  const timeoutMs = opts.timeoutMs ?? 5_000;

  return {
    name: 'webhook',
    async send(alert: Alert): Promise<DeliveryResult> {
      const sentAt = new Date().toISOString();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const body = JSON.stringify(alert);
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('webhook timeout after ' + timeoutMs + 'ms')), timeoutMs);
        });
        const fetchPromise = fetchFn(opts.url, { method: 'POST', headers, body });
        const res = await Promise.race([fetchPromise, timeoutPromise]);
        if (res.ok) {
          return { channel: 'webhook', alert_id: alert.id, ok: true, sent_at: sentAt };
        }
        const text = await res.text().catch(() => '');
        return {
          channel: 'webhook',
          alert_id: alert.id,
          ok: false,
          sent_at: sentAt,
          error: 'HTTP ' + res.status + (text ? ' ' + text.slice(0, 200) : ''),
        };
      } catch (err) {
        return {
          channel: 'webhook',
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
