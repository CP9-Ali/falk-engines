import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

export interface XauSource {
  readonly name: string;
  start(): void;
  stop(): void;
  isHealthy(now?: number): boolean;
}

export interface SourceManagerConfig {
  switchAfterMs: number;
  cooldownMs: number;
}

interface ManagedSource {
  source: XauSource;
  priority: number;
  active: boolean;
  healthy: boolean;
  lastSwitchAt: number;
}

export class XauSourceManager {
  private sources: ManagedSource[] = [];
  private activeIndex = -1;
  private checkTimer?: NodeJS.Timeout;
  private lastActiveTickAt = 0;
  private readonly cfg: SourceManagerConfig;

  constructor(
    cfg: Partial<SourceManagerConfig> = {},
    private readonly onActiveChange: (name: string) => void = () => {},
  ) {
    this.cfg = {
      switchAfterMs: cfg.switchAfterMs ?? 30000,
      cooldownMs: cfg.cooldownMs ?? 300000,
    };
  }

  register(source: XauSource, priority: number): void {
    this.sources.push({ source, priority, active: false, healthy: false, lastSwitchAt: 0 });
    this.sources.sort((a, b) => a.priority - b.priority);
  }

  start(): void {
    if (this.sources.length === 0) throw new Error('No sources registered');
    this.activate(0);
    this.checkTimer = setInterval(() => this.checkHealth(), 5000);
  }

  stop(): void {
    if (this.checkTimer) { clearInterval(this.checkTimer); this.checkTimer = undefined; }
    for (const s of this.sources) { try { s.source.stop(); } catch { /* ignore */ } }
  }

  notifyTick(sourceName: string): void {
    const idx = this.sources.findIndex(s => s.source.name === sourceName);
    if (idx < 0) return;
    if (idx === this.activeIndex) this.lastActiveTickAt = Date.now();
    this.sources[idx]!.healthy = true;
  }

  private activate(index: number): void {
    if (index < 0 || index >= this.sources.length) return;
    const prev = this.activeIndex >= 0 ? this.sources[this.activeIndex]?.source.name : null;
    this.activeIndex = index;
    this.sources.forEach((s, i) => { s.active = i === index; });
    const current = this.sources[index]!;
    try { current.source.start(); } catch (e) { console.error('[' + current.source.name + '] start failed:', (e as Error).message); }
    current.lastSwitchAt = Date.now();
    this.lastActiveTickAt = Date.now();
    console.log('[Failover] Active source: ' + current.source.name + (prev ? ' (was ' + prev + ')' : ''));
    this.onActiveChange(current.source.name);
  }

  private checkHealth(): void {
    if (this.activeIndex < 0) return;
    const now = Date.now();
    const active = this.sources[this.activeIndex]!;
    if (!active.healthy) {
      console.warn('[Failover] ' + active.source.name + ' reports unhealthy');
    }
    const stale = now - this.lastActiveTickAt > this.cfg.switchAfterMs;
    if (!stale) return;

    // Find first healthy alternate with no cooldown
    for (let i = 0; i < this.sources.length; i++) {
      if (i === this.activeIndex) continue;
      const cand = this.sources[i]!;
      if (cand.lastSwitchAt > 0 && now - cand.lastSwitchAt < this.cfg.cooldownMs) continue;
      if (cand.source.isHealthy(now)) {
        console.warn('[Failover] switching ' + active.source.name + ' -> ' + cand.source.name);
        try { active.source.stop(); } catch { /* ignore */ }
        this.activate(i);
        return;
      }
    }

    // No healthy alternate — force switch to next
    const nextIdx = (this.activeIndex + 1) % this.sources.length;
    if (nextIdx !== this.activeIndex) {
      console.warn('[Failover] no healthy source, forcing ' + this.sources[nextIdx]!.source.name);
      try { active.source.stop(); } catch { /* ignore */ }
      this.activate(nextIdx);
    }
  }
}