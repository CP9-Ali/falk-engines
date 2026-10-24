import type { Alert, AlertChannel, DeliveryResult, RouterConfig, AlertSeverity } from './types';

export interface RouterDispatchResult {
  readonly alert_id: string;
  readonly results: ReadonlyArray<DeliveryResult>;
  readonly skipped_channels: ReadonlyArray<string>;
}

export interface AlertRouter {
  /** Deliver a single alert. Returns per-channel results. */
  dispatch(alert: Alert): Promise<RouterDispatchResult>;
  /** Deliver many alerts sequentially. */
  dispatchMany(alerts: ReadonlyArray<Alert>): Promise<ReadonlyArray<RouterDispatchResult>>;
  /** Full delivery log (chronological, oldest first). */
  log(): ReadonlyArray<DeliveryResult>;
  /** Forget all dedup state and clear log. */
  reset(): void;
  /** Whether a given dedup_key was already delivered (to any channel). */
  hasSeen(dedupKey: string): boolean;
}

export function createAlertRouter(cfg: RouterConfig): AlertRouter {
  const dedupe = cfg.dedupe_per_channel ?? true;
  const deliveredKeys = new Set<string>();          // global dedup
  const deliveredByChannel = new Map<string, Set<string>>();  // per-channel dedup
  const history: DeliveryResult[] = [];

  function channelsFor(severity: AlertSeverity): string[] {
    const names = cfg.routes[severity] ?? [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of names) {
      if (!seen.has(n)) { seen.add(n); out.push(n); }
    }
    return out;
  }

  function alreadyDelivered(channel: string, key: string): boolean {
    if (!dedupe) return false;
    const set = deliveredByChannel.get(channel);
    return set !== undefined && set.has(key);
  }

  function markDelivered(channel: string, key: string): void {
    let set = deliveredByChannel.get(channel);
    if (set === undefined) { set = new Set(); deliveredByChannel.set(channel, set); }
    set.add(key);
    deliveredKeys.add(key);
  }

  async function dispatch(alert: Alert): Promise<RouterDispatchResult> {
    const names = channelsFor(alert.severity);
    const results: DeliveryResult[] = [];
    const skipped: string[] = [];

    for (const name of names) {
      const ch: AlertChannel | undefined = cfg.channels[name];
      if (ch === undefined) {
        skipped.push(name);
        continue;
      }
      if (alreadyDelivered(name, alert.dedup_key)) {
        skipped.push(name);
        continue;
      }
      try {
        const res = await ch.send(alert);
        results.push(res);
        history.push(res);
        if (res.ok) markDelivered(name, alert.dedup_key);
      } catch (err) {
        // channel should not throw, but if it does, wrap it.
        const res: DeliveryResult = {
          channel: name,
          alert_id: alert.id,
          ok: false,
          sent_at: new Date().toISOString(),
          error: err instanceof Error ? err.message : String(err),
        };
        results.push(res);
        history.push(res);
      }
    }

    return { alert_id: alert.id, results, skipped_channels: skipped };
  }

  async function dispatchMany(alerts: ReadonlyArray<Alert>): Promise<ReadonlyArray<RouterDispatchResult>> {
    const out: RouterDispatchResult[] = [];
    for (const a of alerts) out.push(await dispatch(a));
    return out;
  }

  return {
    dispatch,
    dispatchMany,
    log: () => history.slice(),
    reset: () => { deliveredKeys.clear(); deliveredByChannel.clear(); history.length = 0; },
    hasSeen: (key) => deliveredKeys.has(key),
  };
}
