import { existsSync, readFileSync } from 'node:fs';
import type { CanonicalCandle } from '../normalization/canonical';
import type { FeatureComputeResult } from '../feature-engineering/types';

export interface EvidenceNode {
  readonly stage: 'raw' | 'normalized' | 'feature' | 'fusion';
  readonly ref_id: string;
  readonly description: string;
  readonly payload_hash: string;
  readonly created_at_utc: string;
}

export interface EvidenceChain {
  readonly feature_id: string;
  readonly lineage_id: string;
  readonly nodes: ReadonlyArray<EvidenceNode>;
  readonly complete: boolean;
}

export class EvidenceBuilder {
  /** §Evidence: بناء سلسلة الأدلة من raw → normalized → feature */
  build(
    feature: FeatureComputeResult,
    canonical: CanonicalCandle,
  ): EvidenceChain {
    const nodes: EvidenceNode[] = [];

    // 1. raw node — نتحقق من وجود الملف
    const rawExists = existsSync(canonical.raw_payload_ref);
    let rawHash = 'unknown';
    if (rawExists) {
      try {
        const rawData = JSON.parse(readFileSync(canonical.raw_payload_ref, 'utf-8'));
        rawHash = rawData.payload_hash || 'unknown';
      } catch {
        rawHash = 'corrupt';
      }
    }
    nodes.push({
      stage: 'raw',
      ref_id: canonical.lineage_id,
      description: 'source=' + canonical.source_id + ' symbol=' + canonical.source_symbol,
      payload_hash: rawHash,
      created_at_utc: canonical.arrival_time_utc,
    });

    // 2. normalized node
    nodes.push({
      stage: 'normalized',
      ref_id: canonical.lineage_id,
      description: 'canonical=' + canonical.canonical_symbol + ' tf=' + canonical.timeframe +
        ' vol=' + canonical.volume_semantics + ' v=' + canonical.normalization_version,
      payload_hash: canonical.raw_fingerprint,
      created_at_utc: canonical.availability_time_utc,
    });

    // 3. feature node
    nodes.push({
      stage: 'feature',
      ref_id: feature.featureId + '@' + feature.definitionVersion,
      description: 'status=' + feature.status + ' value=' + (feature.value === null ? 'null' : String(feature.value)),
      payload_hash: feature.fusionPolicyVersion,
      created_at_utc: feature.computedAt,
    });

    const complete = rawExists && feature.status === 'VALID';
    return {
      feature_id: feature.featureId,
      lineage_id: canonical.lineage_id,
      nodes,
      complete,
    };
  }
}