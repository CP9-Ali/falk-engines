const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// CRITICAL: ensure parent dirs exist before any writeFileSync
fs.mkdirSync('src/alerts/channels', { recursive: true });

// ????????? [1/5] console channel ?????????
fs.writeFileSync('src/alerts/channels/console.ts', `import type { AlertChannel, Alert, DeliveryResult } from '../types';

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
`, 'utf8');
ok('channels/console.ts');

// ????????? [2/5] memory channel ?????????
fs.writeFileSync('src/alerts/channels/memory.ts', `import type { AlertChannel, Alert, DeliveryResult } from '../types';

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
`, 'utf8');
ok('channels/memory.ts');

// ????????? [3/5] webhook channel ?????????
fs.writeFileSync('src/alerts/channels/webhook.ts', `import type { AlertChannel, Alert, DeliveryResult } from '../types';

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
`, 'utf8');
ok('channels/webhook.ts');

// ????????? [4/5] telegram channel ?????????
fs.writeFileSync('src/alerts/channels/telegram.ts', `import type { AlertChannel, Alert, DeliveryResult } from '../types';
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
  return parts.join('\\n');
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
`, 'utf8');
ok('channels/telegram.ts');

// ????????? [5/5] tests ?????????
fs.writeFileSync('src/tests/alerts-channels.test.ts', `import { describe, it, expect, vi } from 'vitest';
import { createConsoleChannel } from '../alerts/channels/console';
import { createMemoryChannel } from '../alerts/channels/memory';
import { createWebhookChannel } from '../alerts/channels/webhook';
import { createTelegramChannel } from '../alerts/channels/telegram';
import type { Alert } from '../alerts/types';

function mkAlert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a-1',
    severity: 'WARNING',
    category: 'custom',
    message: 'hello',
    dedup_key: 'dedup-1',
    raised_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('?10.1 ? console channel', () => {
  it('logs each alert and returns ok', async () => {
    const lines: unknown[][] = [];
    const ch = createConsoleChannel({ log: (...args: unknown[]) => { lines.push(args); } });
    const r = await ch.send(mkAlert());
    expect(r.ok).toBe(true);
    expect(r.channel).toBe('console');
    expect(lines).toHaveLength(1);
    expect(String(lines[0]![0])).toContain('[WARNING][custom] hello');
  });

  it('captures errors from the sink (never throws)', async () => {
    const ch = createConsoleChannel({ log: () => { throw new Error('boom'); } });
    const r = await ch.send(mkAlert());
    expect(r.ok).toBe(false);
    expect(r.error).toBe('boom');
  });
});

describe('?10.1 ? memory channel', () => {
  it('stores alerts and reports ok', async () => {
    const ch = createMemoryChannel();
    const r = await ch.send(mkAlert());
    expect(r.ok).toBe(true);
    expect(ch.received()).toHaveLength(1);
    expect(ch.received()[0]!.id).toBe('a-1');
  });

  it('hasDedupKey detects known keys', async () => {
    const ch = createMemoryChannel();
    await ch.send(mkAlert({ dedup_key: 'k-1' }));
    expect(ch.hasDedupKey('k-1')).toBe(true);
    expect(ch.hasDedupKey('k-2')).toBe(false);
  });

  it('reset clears state', async () => {
    const ch = createMemoryChannel();
    await ch.send(mkAlert());
    ch.reset();
    expect(ch.received()).toHaveLength(0);
  });

  it('respects custom name', async () => {
    const ch = createMemoryChannel('custom-mem');
    const r = await ch.send(mkAlert());
    expect(ch.name).toBe('custom-mem');
    expect(r.channel).toBe('custom-mem');
  });
});

describe('?10.1 ? webhook channel', () => {
  it('POSTs the alert JSON and returns ok on 2xx', async () => {
    const captured: { url: string; body: string }[] = [];
    const fetchFn = vi.fn(async (url: string, init: any) => {
      captured.push({ url, body: init.body });
      return { ok: true, status: 200, text: async () => '' };
    });
    const ch = createWebhookChannel({ url: 'https://example.test/hook', fetchFn: fetchFn as any });
    const r = await ch.send(mkAlert());
    expect(r.ok).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe('https://example.test/hook');
    expect(JSON.parse(captured[0]!.body).id).toBe('a-1');
  });

  it('returns ok:false on non-2xx with status in error', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 503, text: async () => 'down' }));
    const ch = createWebhookChannel({ url: 'https://example.test/hook', fetchFn: fetchFn as any });
    const r = await ch.send(mkAlert());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('HTTP 503');
  });

  it('returns ok:false on fetch throw (network)', async () => {
    const fetchFn = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const ch = createWebhookChannel({ url: 'https://example.test/hook', fetchFn: fetchFn as any });
    const r = await ch.send(mkAlert());
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ECONNREFUSED');
  });

  it('times out when fetch hangs', async () => {
    const fetchFn = vi.fn(() => new Promise<any>(() => {}));
    const ch = createWebhookChannel({ url: 'https://example.test/hook', fetchFn: fetchFn as any, timeoutMs: 20 });
    const r = await ch.send(mkAlert());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/timeout/);
  });
});

describe('?10.1 ? telegram channel', () => {
  it('requires botToken', () => {
    expect(() => createTelegramChannel({ botToken: '', chatId: '1' })).toThrow(/botToken/);
  });

  it('requires chatId', () => {
    expect(() => createTelegramChannel({ botToken: 'tok', chatId: '' })).toThrow(/chatId/);
  });

  it('posts to bot API with chat_id and text', async () => {
    let captured: { url: string; body: any } | undefined;
    const fetchFn = vi.fn(async (url: string, init: any) => {
      captured = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 200, text: async () => '' };
    });
    const ch = createTelegramChannel({ botToken: 'TKN', chatId: '42', fetchFn: fetchFn as any });
    const r = await ch.send(mkAlert({ severity: 'CRITICAL', message: 'big fire' }));
    expect(r.ok).toBe(true);
    expect(captured!.url).toBe('https://api.telegram.org/botTKN/sendMessage');
    expect(captured!.body.chat_id).toBe('42');
    expect(captured!.body.text).toContain('big fire');
    expect(captured!.body.disable_notification).toBe(false);
  });

  it('WARNING alerts use disable_notification: true', async () => {
    let body: any;
    const fetchFn = vi.fn(async (_url: string, init: any) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => '' };
    });
    const ch = createTelegramChannel({ botToken: 'T', chatId: '1', fetchFn: fetchFn as any });
    await ch.send(mkAlert({ severity: 'WARNING' }));
    expect(body.disable_notification).toBe(true);
  });

  it('returns ok:false on failure', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false, status: 400, text: async () => 'bad' }));
    const ch = createTelegramChannel({ botToken: 'T', chatId: '1', fetchFn: fetchFn as any });
    const r = await ch.send(mkAlert());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('HTTP 400');
  });
});
`, 'utf8');
ok('alerts-channels.test.ts');

console.log('\nDONE. ?10.1 files written.');
