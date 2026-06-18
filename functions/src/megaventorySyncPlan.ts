/** Pure, unit-testable decision logic for the resumable, multi-pass Megaventory sync: a checkpointed
 * state machine (INGESTION → PROCESSING, one sub-stage per bounded <30min pass via `processingStage`). */

export type ProcessingStage = 'gapfill' | 'rfm' | 'procurement' | 'stockmovement';

/** Ordered processing sub-stages, one heavy module per bounded pass: procurement and
 * stock-movement are split because bundled they overran the budget on heavy brands. */
export const PROCESSING_ORDER: ProcessingStage[] = ['gapfill', 'rfm', 'procurement', 'stockmovement'];

/** Legacy persisted value (pre-split) — resume it at the first of its two halves. */
const LEGACY_FINALIZE = 'finalize';

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

/** After the ingestion catalog fetch, decide catalog-state persistence and whether to run
 * processing inline (enough budget) or defer it to a fresh pass. */
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

/** Which processing sub-stage runs on this pass and what comes next; `next === null`
 * means this was the last sub-stage and the whole sync is done after it. */
export function planProcessing(current: ProcessingStage | string | null | undefined): {
  run: ProcessingStage;
  next: ProcessingStage | null;
} {
  // legacy pre-split checkpoint: 'finalize' meant procurement+stock-movement → resume at procurement
  const normalized = current === LEGACY_FINALIZE ? 'procurement' : current;
  const known = normalized && PROCESSING_ORDER.includes(normalized as ProcessingStage);
  const idx = known ? PROCESSING_ORDER.indexOf(normalized as ProcessingStage) : 0;
  const run = PROCESSING_ORDER[idx];
  const next = PROCESSING_ORDER[idx + 1] ?? null;
  return { run, next };
}

/** A job stuck `running` past the stale threshold MUST resolve to `failed` (never inherit a prior
 * pass's `success`); reset flags clear connector state so the brand isn't livelocked next sync. */
/** Max times a stale (killed-mid-pass) job is re-enqueued to resume from its checkpoints before we
 * give up and fail it. Bounds livelock; each resume makes forward progress (catalog-complete +
 * invoice/deleted cursors persist across passes). */
export const MAX_STALE_RESUMES = 6;

export type StaleRecovery =
  | { action: 'resume' }
  | { action: 'fail'; status: 'failed'; error: string; resetCatalogState: true };

/** A pass stale ≥40min is past the 30min hard cap ⇒ definitely dead (no concurrent writer), so it is
 * safe to RESUME from checkpoints instead of failing outright. Bounded by MAX_STALE_RESUMES; once
 * exhausted, fail + reset so a stuck brand can't livelock and never inherits a prior pass success. */
export function decideStaleRecovery(staleRecoveryAttempts = 0): StaleRecovery {
  if (staleRecoveryAttempts < MAX_STALE_RESUMES) {
    return { action: 'resume' };
  }
  return {
    action: 'fail',
    status: 'failed',
    error: 'Megaventory sync timed out before job finalization',
    resetCatalogState: true,
  };
}

/** Guards a zombie-finalization race: a pass may finalize the job ONLY while it still owns it —
 * status still `running` AND claimToken matches this pass's claim (a re-claim rotates the token). */
export function isJobWriteOwned(args: {
  currentStatus: unknown;
  currentClaimToken: unknown;
  claimToken: string;
}): boolean {
  return args.currentStatus === 'running' && args.currentClaimToken === args.claimToken;
}

/** True when the resumable connector flags should be deleted: on a non-clean pass the state must be
 * cleared so the next sync re-ingests from scratch instead of being stuck productCatalogComplete=true. */
export function shouldResetCatalogState(outcome: {
  success: boolean;
  needsContinuation: boolean;
}): boolean {
  // Reset on a clean full completion (so the next sync starts fresh) OR on failure (so we don't get
  // stuck). Keep state only while the sync is legitimately mid-flight (success && needsContinuation).
  if (!outcome.success) return true;
  return !outcome.needsContinuation;
}
