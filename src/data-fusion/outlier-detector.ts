export interface OutlierInput {
  sourceId: string;
  value: number;
}

export interface OutlierVerdict extends OutlierInput {
  mad: number;
  modifiedZScore: number;
  isOutlier: boolean;
}

export interface OutlierResult {
  outliers: OutlierVerdict[];
  inliers: OutlierVerdict[];
  median: number | null;
  mad: number | null;
}

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function detectOutliersMAD(
  inputs: ReadonlyArray<OutlierInput>,
  threshold: number = 3.5,
): OutlierResult {
  if (inputs.length < 3) {
    const verdicts: OutlierVerdict[] = inputs.map((v) => ({
      sourceId: v.sourceId,
      value: v.value,
      mad: 0,
      modifiedZScore: 0,
      isOutlier: false,
    }));
    return { outliers: [], inliers: verdicts, median: null, mad: null };
  }

  const sorted = inputs.map((v) => v.value).slice().sort((a, b) => a - b);
  const median = medianOf(sorted);
  const deviationsSorted = inputs
    .map((v) => Math.abs(v.value - median))
    .slice()
    .sort((a, b) => a - b);
  const mad = medianOf(deviationsSorted);

  if (mad === 0) {
    const verdicts: OutlierVerdict[] = inputs.map((v) => ({
      sourceId: v.sourceId,
      value: v.value,
      mad: 0,
      modifiedZScore: 0,
      isOutlier: false,
    }));
    return { outliers: [], inliers: verdicts, median, mad: 0 };
  }

  const K = 0.6745;
  const verdicts: OutlierVerdict[] = inputs.map((v) => {
    const mz = (K * (v.value - median)) / mad;
    return {
      sourceId: v.sourceId,
      value: v.value,
      mad,
      modifiedZScore: mz,
      isOutlier: Math.abs(mz) > threshold,
    };
  });

  return {
    outliers: verdicts.filter((v) => v.isOutlier),
    inliers: verdicts.filter((v) => !v.isOutlier),
    median,
    mad,
  };
}
