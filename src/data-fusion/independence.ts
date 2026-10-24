export interface SourceRef {
  sourceId: string;
}

export interface IndependenceGroup {
  key: string;
  sourceIds: readonly string[];
}

export function resolveIndependenceKey(
  sourceId: string,
  independenceKeys: Readonly<Record<string, string>>,
): string {
  return independenceKeys[sourceId] ?? sourceId;
}

export function groupSourcesByIndependence(
  sources: ReadonlyArray<SourceRef>,
  independenceKeys: Readonly<Record<string, string>> = {},
): IndependenceGroup[] {
  const map = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const s of sources) {
    if (seen.has(s.sourceId)) {
      throw new Error('duplicate sourceId in independence grouping: ' + s.sourceId);
    }
    seen.add(s.sourceId);
    const key = resolveIndependenceKey(s.sourceId, independenceKeys);
    const arr = map.get(key);
    if (arr === undefined) map.set(key, [s.sourceId]);
    else arr.push(s.sourceId);
  }
  return Array.from(map.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, sourceIds]) => ({ key, sourceIds: sourceIds.slice().sort() }));
}

export function independentPairCount(groups: ReadonlyArray<IndependenceGroup>): number {
  const n = groups.length;
  if (n < 2) return 0;
  return (n * (n - 1)) / 2;
}
