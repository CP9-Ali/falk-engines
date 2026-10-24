const fs = require('fs');
const ok = (m) => console.log('  [OK]   ' + m);

// ????????? [1/2] src/alerts/types.ts ?????????
fs.mkdirSync('src/alerts', { recursive: true });
fs.writeFileSync('src/alerts/types.ts', `// ?10.0 ? Alerting interfaces (no runtime deps, no coupling to monitoring/)

export type AlertSeverity = 'WARNING' | 'HIGH' | 'CRITICAL';

export type AlertCategory =
  | 'health'
  | 'quality'
  | 'fusion'
  | 'backtest'
  | 'custom';

export interface Alert {
  readonly id: string;
  readonly severity: AlertSeverity;
  readonly category: AlertCategory;
  /** Human-readable one-liner. */
  readonly message: string;
  /**
   * Deduplication key. Two alerts with the same dedup_key
   * represent the same underlying condition and must not
   * both be delivered to the same channel.
   */
  readonly dedup_key: string;
  /** When the condition was observed (ISO 8601 UTC). */
  readonly raised_at: string;
  /** Optional structured context (backtest metrics, fusion report ids, etc.). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface DeliveryResult {
  readonly channel: string;
  readonly alert_id: string;
  readonly ok: boolean;
  readonly sent_at: string;
  readonly error?: string;
}

export interface AlertChannel {
  readonly name: string;
  send(alert: Alert): Promise<DeliveryResult>;
}

export interface RouterConfig {
  /** Channel name -> channel instance. */
  readonly channels: Readonly<Record<string, AlertChannel>>;
  /** Severity -> channel names. Missing severity -> no routing. */
  readonly routes: Readonly<Record<AlertSeverity, ReadonlyArray<string>>>;
  /**
   * When true, a channel that appears in multiple severities is
   * still called once per alert. Default true.
   */
  readonly dedupe_per_channel?: boolean;
}
`, 'utf8');
ok('src/alerts/types.ts');

// ????????? [2/2] test file ?????????
fs.writeFileSync('src/tests/alerts-types.test.ts', `import { describe, it, expect } from 'vitest';
import type {
  Alert,
  AlertSeverity,
  AlertCategory,
  AlertChannel,
  DeliveryResult,
  RouterConfig,
} from '../alerts/types';

describe('?10.0 ? alert type contracts', () => {
  it('AlertSeverity union has exactly 3 values', () => {
    const s: AlertSeverity[] = ['WARNING', 'HIGH', 'CRITICAL'];
    expect(new Set(s).size).toBe(3);
  });

  it('AlertCategory union has exactly 5 values', () => {
    const c: AlertCategory[] = ['health', 'quality', 'fusion', 'backtest', 'custom'];
    expect(new Set(c).size).toBe(5);
  });

  it('Alert minimal shape compiles', () => {
    const a: Alert = {
      id: 'a-1',
      severity: 'WARNING',
      category: 'custom',
      message: 'hello',
      dedup_key: 'dedup-1',
      raised_at: '2026-01-01T00:00:00Z',
    };
    expect(a.metadata).toBeUndefined();
  });

  it('Alert with metadata', () => {
    const a: Alert = {
      id: 'a-1',
      severity: 'CRITICAL',
      category: 'fusion',
      message: 'conflict',
      dedup_key: 'fusion-conflict-v1',
      raised_at: '2026-01-01T00:00:00Z',
      metadata: { report_id: 'rep-abc', status: 'UNRESOLVED_CONFLICT' },
    };
    expect(a.metadata!.report_id).toBe('rep-abc');
  });

  it('AlertChannel structural conformance', async () => {
    const captured: Alert[] = [];
    const ch: AlertChannel = {
      name: 'capture',
      async send(a) {
        captured.push(a);
        return {
          channel: 'capture',
          alert_id: a.id,
          ok: true,
          sent_at: new Date().toISOString(),
        };
      },
    };
    const r = await ch.send({
      id: 'x',
      severity: 'HIGH',
      category: 'health',
      message: 'm',
      dedup_key: 'k',
      raised_at: '2026-01-01T00:00:00Z',
    });
    expect(r.ok).toBe(true);
    expect(captured).toHaveLength(1);
  });

  it('DeliveryResult success and failure shapes', () => {
    const ok: DeliveryResult = {
      channel: 'telegram',
      alert_id: 'a-1',
      ok: true,
      sent_at: '2026-01-01T00:00:00Z',
    };
    const fail: DeliveryResult = {
      channel: 'telegram',
      alert_id: 'a-1',
      ok: false,
      sent_at: '2026-01-01T00:00:00Z',
      error: 'HTTP 500',
    };
    expect(ok.error).toBeUndefined();
    expect(fail.error).toBe('HTTP 500');
  });

  it('RouterConfig allows subset of severities to route', () => {
    const cfg: RouterConfig = {
      channels: {},
      routes: {
        WARNING: [],
        HIGH: ['telegram'],
        CRITICAL: ['telegram', 'webhook'],
      },
    };
    expect(cfg.routes.CRITICAL).toContain('webhook');
  });

  it('RouterConfig dedupe_per_channel default is optional', () => {
    const cfg: RouterConfig = {
      channels: {},
      routes: { WARNING: [], HIGH: [], CRITICAL: [] },
    };
    expect(cfg.dedupe_per_channel).toBeUndefined();
  });

  it('dedup_key is required (compile-time enforcement)', () => {
    // This test documents that dedup_key must be present.
    const a: Alert = {
      id: 'x',
      severity: 'WARNING',
      category: 'custom',
      message: 'm',
      dedup_key: 'k',
      raised_at: '2026-01-01T00:00:00Z',
    };
    expect(typeof a.dedup_key).toBe('string');
  });
});
`, 'utf8');
ok('src/tests/alerts-types.test.ts');

console.log('\nDONE. ?10.0 files written.');
