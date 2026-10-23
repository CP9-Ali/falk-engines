import type { AlertManager } from './alerts';
import type { HealthMonitor, HealthSnapshot } from './health-monitor';

export interface AlertBridgeConfig {
  readonly pollMs?: number;
  readonly degradedLevel?: 'WARNING' | 'HIGH' | 'CRITICAL';
  readonly unhealthyLevel?: 'WARNING' | 'HIGH' | 'CRITICAL';
}

/**
 * §17: جسر بين HealthMonitor و AlertManager.
 * عند DEGRADED → HIGH alert. عند UNHEALTHY → CRITICAL alert.
 * عند العودة لـ HEALTHY → resolve كل تنبيهات health.
 */
export class AlertBridge {
  private timer?: NodeJS.Timeout;
  private readonly pollMs: number;
  private readonly degradedLevel: 'WARNING' | 'HIGH' | 'CRITICAL';
  private readonly unhealthyLevel: 'WARNING' | 'HIGH' | 'CRITICAL';
  private lastState: HealthSnapshot['state'] | null = null;

  constructor(
    private readonly health: HealthMonitor,
    private readonly alerts: AlertManager,
    private readonly actor: string = 'alert-bridge',
    cfg: AlertBridgeConfig = {},
  ) {
    this.pollMs = cfg.pollMs ?? 30_000;
    this.degradedLevel = cfg.degradedLevel ?? 'HIGH';
    this.unhealthyLevel = cfg.unhealthyLevel ?? 'CRITICAL';
  }

  start(): void {
    if (this.timer) return;
    this.check();
    this.timer = setInterval(() => this.check(), this.pollMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  /** فحص فوري — يرجع snapshot ويطلق/يحلّ التنبيهات */
  check(): HealthSnapshot {
    const snapshot = this.health.check();

    if (snapshot.state === 'UNHEALTHY') {
      for (const reason of snapshot.reasons) {
        const key = 'health-unhealthy:' + reason;
        this.alerts.raise(this.unhealthyLevel, 'health', reason, key, this.actor);
      }
    } else if (snapshot.state === 'DEGRADED') {
      for (const reason of snapshot.reasons) {
        const key = 'health-degraded:' + reason;
        this.alerts.raise(this.degradedLevel, 'health', reason, key, this.actor);
      }
    }

    // إذا خرجنا من حالة سيئة → resolve كل تنبيهات health
    if (snapshot.state === 'HEALTHY' && this.lastState !== null && this.lastState !== 'HEALTHY') {
      const active = this.alerts.active().filter(a => a.category === 'health');
      for (const a of active) {
        this.alerts.resolve(a.dedupKey);
      }
    }

    this.lastState = snapshot.state;
    return snapshot;
  }
}