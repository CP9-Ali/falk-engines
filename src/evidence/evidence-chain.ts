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
  /** آ§Evidence: ط¨ظ†ط§ط، ط³ظ„ط³ظ„ط© ط§ظ„ط£ط¯ظ„ط© ظ…ظ† raw â†’ normalized â†’ feature */
  build(
    feature: FeatureComputeResult,
    canonical: CanonicalCandle,
  ): EvidenceChain {
    const nodes: EvidenceNode[] = [];

    // 1. raw node â€” ظ†طھط­ظ‚ظ‚ ظ…ظ† ظˆط¬ظˆط¯ ط§ظ„ظ…ظ„ظپ
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
/**
 * §12: Evidence Snapshot — لقطة أدلة موحّدة لشمعة واحدة.
 * تجمع كل السلاسل (لكل feature) في أثر واحد قابل للحفظ.
 */
export interface EvidenceSnapshot {
  readonly snapshot_id: string;
  readonly candle_fingerprint: string;
  readonly timeframe: string;
  readonly event_time_utc: string;
  readonly chains: ReadonlyArray<EvidenceChain>;
  readonly chains_complete: number;
  readonly chains_incomplete: number;
  readonly complete: boolean;
  readonly captured_at_utc: string;
}

export function buildEvidenceSnapshot(
  candleFingerprint: string,
  timeframe: string,
  eventTimeUtc: string,
  chains: ReadonlyArray<EvidenceChain>,
): EvidenceSnapshot {
  const completeCount = chains.filter(c => c.complete).length;
  const incompleteCount = chains.length - completeCount;
  return {
    snapshot_id: 'esnap-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    candle_fingerprint: candleFingerprint,
    timeframe,
    event_time_utc: eventTimeUtc,
    chains,
    chains_complete: completeCount,
    chains_incomplete: incompleteCount,
    complete: chains.length > 0 && incompleteCount === 0,
    captured_at_utc: new Date().toISOString(),
  };
}