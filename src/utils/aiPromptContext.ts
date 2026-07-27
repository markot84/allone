/** Pure helpers turning triage origin and source coverage into compact context
 * objects for the Gemini prompts; clamps percentages and caps SKUs. */
import type { TriageOrigin } from '../hooks/useActiveStrategy';
import { BUCKET_DEFS, type BucketId } from './decisionBuckets';

const MAX_TOP_SKUS = 5;

export interface TriagePromptShape {
  bucketLabel: string;
  bucketDescription?: string;
  skuCount: number;
  tiedCapital?: number;
  topSkus?: string[];
}

export interface ProvenancePromptShape {
  connectorPct: number;
  movementPct: number;
  procurementPct: number;
  importPct: number;
  totalProducts: number;
}

/** Build triage prompt context from a stored TriageOrigin (active_strategies);
 * passes the bucket description so the LLM understands the root problem. */
export function buildTriagePromptContext(
  origin: TriageOrigin | null | undefined
): TriagePromptShape | undefined {
  if (!origin || !origin.bucket) return undefined;
  const def = BUCKET_DEFS[origin.bucket as BucketId];
  return {
    bucketLabel: origin.label || def?.label || origin.bucket,
    bucketDescription: def?.description,
    skuCount: Array.isArray(origin.skus) ? origin.skus.length : 0,
    ...(typeof origin.tiedCapital === 'number' && origin.tiedCapital > 0
      ? { tiedCapital: origin.tiedCapital }
      : {}),
    ...(Array.isArray(origin.skus) && origin.skus.length > 0
      ? { topSkus: origin.skus.slice(0, MAX_TOP_SKUS) }
      : {}),
  };
}

/** Build provenance snapshot from useProductSignals.coverage. */
export function buildProvenancePromptContext(
  coverage: { connector: number; movement: number; procurement: number; import: number } | null | undefined,
  totalProducts: number | null | undefined
): ProvenancePromptShape | undefined {
  if (!coverage || !totalProducts || totalProducts <= 0) return undefined;
  const pct = (n: number) => Math.max(0, Math.min(100, Math.round((n / totalProducts) * 100)));
  return {
    connectorPct: pct(coverage.connector),
    movementPct: pct(coverage.movement),
    procurementPct: pct(coverage.procurement),
    importPct: pct(coverage.import),
    totalProducts,
  };
}
