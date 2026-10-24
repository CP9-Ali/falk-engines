export interface PriceDelta {
  from: string;
  to: string;
  delta_p: number;
  delta_p_pct: number | null;
}

export interface PricePoint {
  sourceId: string;
  price: number;
}

export function computePairwiseDeltas(
  values: ReadonlyArray<PricePoint>,
  baseSourceId?: string,
): PriceDelta[] {
  if (values.length < 2) return [];

  const seen = new Set<string>();
  for (const v of values) {
    if (seen.has(v.sourceId)) {
      throw new Error('duplicate sourceId in pairwise delta: ' + v.sourceId);
    }
    seen.add(v.sourceId);
  }

  const deltas: PriceDelta[] = [];
  const emit = (a: PricePoint, b: PricePoint): void => {
    const delta_p = a.price - b.price;
    const delta_p_pct = b.price === 0 ? null : (delta_p / b.price) * 100;
    deltas.push({ from: a.sourceId, to: b.sourceId, delta_p, delta_p_pct });
  };

  if (baseSourceId !== undefined) {
    const base = values.find((v) => v.sourceId === baseSourceId);
    if (base === undefined) {
      throw new Error('baseSourceId not found: ' + baseSourceId);
    }
    for (const v of values) {
      if (v.sourceId === baseSourceId) continue;
      emit(v, base);
    }
    return deltas;
  }

  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      emit(values[i]!, values[j]!);
    }
  }
  return deltas;
}
