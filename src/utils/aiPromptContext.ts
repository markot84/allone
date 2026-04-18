/**
 * aiPromptContext — pure helpers που μετατρέπουν triage origin και source coverage
 * σε compact context objects για τα Gemini prompts (channel + content).
 *
 * Σχεδιαστική σημείωση:
 *   - DRY: τα `TriagePromptContext` (channel) και `TriageContentContext` (content)
 *     έχουν ίδια shape — ένας helper εξυπηρετεί και τα δύο.
 *   - Pure: καμία εξάρτηση από hooks. Τρέχει και από services/tests.
 *   - Defensive: clamp ποσοστά σε [0, 100], κόψιμο SKUs σε MAX_TOP_SKUS, καθαρισμός
 *     undefined fields για clean serialization.
 */
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

/**
 * Build triage prompt context από αποθηκευμένο TriageOrigin (από active_strategies).
 * Περνά το description του bucket (ώστε το LLM να καταλάβει τη ρίζα του προβλήματος).
 */
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

/**
 * Build provenance snapshot από useProductSignals.coverage.
 *
 * @param coverage πόσα SKUs εντοπίστηκαν ανά πηγή (μπορεί να επικαλύπτονται)
 * @param totalProducts σύνολο SKUs στο catalog
 */
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
