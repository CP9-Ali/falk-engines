import type { RawDataPoint } from '../core/types';
import type { Candle } from '../data-quality/checks/base';

export interface BufferStats {
  readonly produced: number;
  readonly consumed: number;
  readonly dropped: number;
  readonly size: number;
}

/**
 * ß14: »œÌ· Œ›Ì› ·‹ Kafka ›Ì «· ÿÊÌ—.
 * - Ring buffer „⁄ Õœ √ﬁ’Ï
 * - Ì—„Ì «·√ﬁœ„ ⁄‰œ «·«„ ·«¡ (backpressure)
 * - ≈Õ’«¡«  ﬂ«„·…
 * - ‰›” Ê«ÃÂ… Producer/Consumer »„” ÊÏ √⁄·Ï
 */
export class MemoryBuffer {
  private items: RawDataPoint<Candle>[] = [];
  private producedCount = 0;
  private consumedCount = 0;
  private droppedCount = 0;

  constructor(private readonly maxSize = 10_000) {
    if (maxSize < 1) throw new Error('maxSize must be >= 1');
  }

  push(p: RawDataPoint<Candle>): void {
    if (this.items.length >= this.maxSize) {
      this.items.shift();
      this.droppedCount++;
    }
    this.items.push(p);
    this.producedCount++;
  }

  drain(): RawDataPoint<Candle>[] {
    const out = this.items;
    this.items = [];
    this.consumedCount += out.length;
    return out;
  }

  peek(): ReadonlyArray<RawDataPoint<Candle>> {
    return [...this.items];
  }

  stats(): BufferStats {
    return {
      produced: this.producedCount,
      consumed: this.consumedCount,
      dropped: this.droppedCount,
      size: this.items.length,
    };
  }

  clear(): void {
    this.items = [];
  }
}