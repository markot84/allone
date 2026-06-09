/**
 * PER-60: pure decision logic for the resumable, multi-pass Megaventory sync.
 *
 * Extracted out of fetchMegaventoryData / processMegaventorySyncJobs so the stage/recovery
 * decisions — where the bugs live — are deterministic and exhaustively unit-testable without the
 * Firestore emulator or the live Megaventory API.
 *
 * The sync runs as a checkpointed state machine across bounded (<30min) invocations:
 *   INGESTION  → documents + resumable catalog + stock + suppliers   (productCatalogComplete=false)
 *   PROCESSING → customReport+normalize, then gap-fill → rfm → finalize, one sub-stage per pass
 *                (productCatalogComplete=true, advanced by `processingStage`)
 * Each pass either finishes a stage and re-enqueues, or completes the whole sync and resets state.
 */

export type ProcessingStage = 'gapfill' | 'rfm' | 'finalize';

/** Ordered processing sub-stages — each runs in its own bounded pass for very heavy brands. */
export const PROCESSING_ORDER: ProcessingStage[] = ['gapfill', 'rfm', 'finalize'];

export interface SyncPersistedState {
  /** Catalog has been fully fetched (ingestion done); we're in the processing stage. */
  productCatalogComplete: boolean;
  /** Current processing sub-stage; undefined/null = start at the first (`gapfill`). */
  processingStage?: ProcessingStage | null;
}

/** Is this invocation a processing pass (ingestion already complete) or an ingestion pass? */
export function isProcessingPass(s: SyncPersistedState): boolean {
  return s.productCatalogComplete === true;
}

/**
 * After the ingestion pass's catalog fetch, decide catalog-state persistence and whether to run the
 * processing inline (small brands, plenty of budget) or defer it to a fresh pass (heavy brands).
 */
export function planAfterCatalog(rt: {
  catalogExhausted: boolean;
  budgetRemainingMs: number;
  reserveMs: number;
}): { catalogComplete: boolean; startProcessingNow: boolean; needsContinuation: boolean } {
  if (!rt.catalogExhausted) {
    // catalog cut short by the budget — persist the cursor and resume next pass
    return { catalogComplete: false, startProcessingNow: false, needsContinuation: true };
  }
  // catalog fully fetched this pass — run processing inline only if a full reserve remains
  const startNow = rt.budgetRemainingMs >= rt.reserveMs;
  return { catalogComplete: true, startProcessingNow: startNow, needsContinuation: !startNow };
}

/**
 * Which processing sub-stage runs on this pass, and what comes next.
 * `next === null` means this was the last sub-stage → the whole sync is done after it.
 */
export function planProcessing(current: ProcessingStage | null | undefined): {
  run: ProcessingStage;
  next: ProcessingStage | null;
} {
  const known = current && PROCESSING_ORDER.includes(current);
  const idx = known ? PROCESSING_ORDER.indexOf(current as ProcessingStage) : 0;
  const run = PROCESSING_ORDER[idx];
  const next = PROCESSING_ORDER[idx + 1] ?? null;
  return { run, next };
}

/**
 * FIX (stale-recovery false-completion): a job stuck `running` past the stale threshold timed out
 * before it could finalize itself. It MUST resolve to `failed` — never inherit a prior pass's stored
 * `success` result (that masked real failures as success). Reset flags clear the resumable connector
 * state so the brand isn't livelocked in "processing-only" mode on the next sync.
 */
export function decideStaleRecovery(): {
  status: 'failed';
  error: string;
  resetCatalogState: true;
} {
  return {
    status: 'failed',
    error: 'Megaventory sync timed out before job finalization',
    resetCatalogState: true,
  };
}

/**
 * FIX (reset-on-failure): when a pass ends not-clean (error, or killed/recovered), the resumable
 * state must be cleared so the next sync re-ingests from scratch instead of being stuck with
 * productCatalogComplete=true forever. Returns true when the connector flags should be deleted.
 */
export function shouldResetCatalogState(outcome: {
  success: boolean;
  needsContinuation: boolean;
}): boolean {
  // Reset on a clean full completion (so the next sync starts fresh) OR on failure (so we don't get
  // stuck). Keep state only while the sync is legitimately mid-flight (success && needsContinuation).
  if (!outcome.success) return true;
  return !outcome.needsContinuation;
}
