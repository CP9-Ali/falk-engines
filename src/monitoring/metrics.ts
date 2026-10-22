export interface MetricSnapshot {
    readonly counters: Readonly<Record<string, number>>;
    readonly histograms: Readonly<Record<string, { readonly count: number; readonly min: number; readonly max: number; readonly mean: number }>>;
  }
  
  export class MetricsRegistry {
    private readonly counters = new Map<string, number>();
    private readonly histograms = new Map<string, number[]>();
  
    increment(name: string, by = 1): void {
      this.counters.set(name, (this.counters.get(name) ?? 0) + by);
    }
  
    observe(name: string, value: number): void {
      const list = this.histograms.get(name) ?? [];
      list.push(value);
      this.histograms.set(name, list);
    }
  
    snapshot(): MetricSnapshot {
      const counters: Record<string, number> = {};
      for (const [k, v] of this.counters) counters[k] = v;
      const histograms: Record<string, { count: number; min: number; max: number; mean: number }> = {};
      for (const [k, list] of this.histograms) {
        const sum = list.reduce((a, b) => a + b, 0);
        histograms[k] = {
          count: list.length,
          min: Math.min(...list),
          max: Math.max(...list),
          mean: list.length > 0 ? sum / list.length : 0,
        };
      }
      return { counters, histograms };
    }
  }