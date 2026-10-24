import { createHash } from 'crypto';

export type FeatureStatus = 'final' | 'provisional' | 'missing' | 'failed';

export interface FeatureLineage {
  readonly sources: readonly string[];
  readonly derived_from: readonly string[];
}

export interface FeatureMetadata {
  readonly feature_id: string;
  readonly feature_version: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly value: number | null;
  readonly unit: string;
  readonly calculated_at_utc: string;
  readonly valid_at_utc: string;
  readonly parameters_hash: string;
  readonly data_snapshot_id: string;
  readonly status: FeatureStatus;
  readonly warnings: readonly string[];
  readonly lineage: FeatureLineage;
}

export interface BuildMetadataInput {
  feature_id: string;
  feature_version: string;
  symbol: string;
  timeframe: string;
  value: number | null;
  unit: string;
  calculated_at_utc: string;
  valid_at_utc: string;
  parameters: Record<string, unknown>;
  data_snapshot_id: string;
  status: FeatureStatus;
  warnings?: readonly string[];
  lineage?: Partial<FeatureLineage>;
}

export function computeParametersHash(parameters: Record<string, unknown>): string {
  const sorted = Object.keys(parameters).sort().map((k) => [k, parameters[k]] as const);
  const canonical = JSON.stringify(sorted);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function buildMetadata(input: BuildMetadataInput): FeatureMetadata {
  const warnings = input.warnings ? [...input.warnings] : [];
  if (input.value === null && input.status === 'final') {
    warnings.push('value_null_but_final');
  }
  return {
    feature_id: input.feature_id,
    feature_version: input.feature_version,
    symbol: input.symbol,
    timeframe: input.timeframe,
    value: input.value,
    unit: input.unit,
    calculated_at_utc: input.calculated_at_utc,
    valid_at_utc: input.valid_at_utc,
    parameters_hash: computeParametersHash(input.parameters),
    data_snapshot_id: input.data_snapshot_id,
    status: input.status,
    warnings,
    lineage: {
      sources: input.lineage?.sources ? [...input.lineage.sources] : [],
      derived_from: input.lineage?.derived_from ? [...input.lineage.derived_from] : [],
    },
  };
}

export function isFinal(metadata: FeatureMetadata): boolean {
  return metadata.status === 'final' && metadata.value !== null;
}

export function assertNoLookahead(metadata: FeatureMetadata): void {
  const valid = Date.parse(metadata.valid_at_utc);
  const calc = Date.parse(metadata.calculated_at_utc);
  if (Number.isNaN(valid) || Number.isNaN(calc)) {
    throw new Error('invalid timestamps on ' + metadata.feature_id);
  }
  if (calc < valid) {
    throw new Error('lookahead: ' + metadata.feature_id + ' calculated_at < valid_at');
  }
}

export function missingFeature(input: {
  feature_id: string;
  feature_version: string;
  symbol: string;
  timeframe: string;
  calculated_at_utc: string;
  valid_at_utc: string;
  parameters: Record<string, unknown>;
  data_snapshot_id: string;
  warnings: readonly string[];
}): FeatureMetadata {
  return buildMetadata({
    ...input,
    value: null,
    unit: '',
    status: 'missing',
  });
}

export function assertReproducible(a: FeatureMetadata, b: FeatureMetadata): void {
  if (a.feature_id !== b.feature_id) throw new Error('feature_id mismatch');
  if (a.parameters_hash !== b.parameters_hash) throw new Error('parameters_hash mismatch');
  if (a.value !== b.value) throw new Error('value mismatch');
  if (a.valid_at_utc !== b.valid_at_utc) throw new Error('valid_at_utc mismatch');
}
