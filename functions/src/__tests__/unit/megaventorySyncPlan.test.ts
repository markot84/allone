/** Tests for the pure sync-plan decisions (false-completion, stuck state, processing split). */
import { describe, it, expect } from 'vitest';
import {
  isProcessingPass,
  isJobWriteOwned,
  planAfterCatalog,
  planProcessing,
  decideStaleRecovery,
  shouldResetCatalogState,
  PROCESSING_ORDER,
  type ProcessingStage,
} from '../../megaventorySyncPlan';

const RESERVE = 12 * 60 * 1000;

describe('isProcessingPass', () => {
  it('ingestion pass when catalog not yet complete', () => {
    expect(isProcessingPass({ productCatalogComplete: false })).toBe(false);
  });
  it('processing pass once catalog is complete', () => {
    expect(isProcessingPass({ productCatalogComplete: true })).toBe(true);
  });
});

describe('planAfterCatalog', () => {
  it('catalog cut short by budget → resume next pass (not complete, needs continuation)', () => {
    expect(planAfterCatalog({ catalogExhausted: false, budgetRemainingMs: 5 * 60_000, reserveMs: RESERVE }))
      .toEqual({ catalogComplete: false, startProcessingNow: false, needsContinuation: true });
  });
  it('small brand: catalog done with plenty of budget → run processing inline, one pass', () => {
    expect(planAfterCatalog({ catalogExhausted: true, budgetRemainingMs: 20 * 60_000, reserveMs: RESERVE }))
      .toEqual({ catalogComplete: true, startProcessingNow: true, needsContinuation: false });
  });
  it('heavy brand: catalog done but <reserve budget left → defer processing to a fresh pass', () => {
    expect(planAfterCatalog({ catalogExhausted: true, budgetRemainingMs: 4 * 60_000, reserveMs: RESERVE }))
      .toEqual({ catalogComplete: true, startProcessingNow: false, needsContinuation: true });
  });
  it('exactly at reserve boundary → runs inline (>=)', () => {
    expect(planAfterCatalog({ catalogExhausted: true, budgetRemainingMs: RESERVE, reserveMs: RESERVE }).startProcessingNow).toBe(true);
  });
});

describe('planProcessing (sub-stage split)', () => {
  it('undefined → starts at gapfill, next rfm', () => {
    expect(planProcessing(undefined)).toEqual({ run: 'gapfill', next: 'rfm' });
  });
  it('null → starts at gapfill', () => {
    expect(planProcessing(null)).toEqual({ run: 'gapfill', next: 'rfm' });
  });
  it('gapfill → next rfm', () => {
    expect(planProcessing('gapfill')).toEqual({ run: 'gapfill', next: 'rfm' });
  });
  it('rfm → next procurement', () => {
    expect(planProcessing('rfm')).toEqual({ run: 'rfm', next: 'procurement' });
  });
  it('procurement → next stockmovement', () => {
    expect(planProcessing('procurement')).toEqual({ run: 'procurement', next: 'stockmovement' });
  });
  it('stockmovement → next null (whole sync done after this)', () => {
    expect(planProcessing('stockmovement')).toEqual({ run: 'stockmovement', next: null });
  });
  it("legacy persisted 'finalize' resumes at procurement (pre-split checkpoint compat)", () => {
    expect(planProcessing('finalize')).toEqual({ run: 'procurement', next: 'stockmovement' });
  });
  it('unknown value falls back to the first stage (no crash / stuck)', () => {
    expect(planProcessing('bogus' as ProcessingStage)).toEqual({ run: 'gapfill', next: 'rfm' });
  });
  it('walks the full chain exactly once each', () => {
    const seen: ProcessingStage[] = [];
    let cur: ProcessingStage | null = undefined as unknown as ProcessingStage;
    for (let i = 0; i < 10; i++) {
      const { run, next } = planProcessing(cur);
      seen.push(run);
      if (next === null) break;
      cur = next;
    }
    expect(seen).toEqual(PROCESSING_ORDER);
  });
});

describe('decideStaleRecovery (false-completion bug)', () => {
  it('ALWAYS marks a timed-out stale job failed — never inherits a prior pass success', () => {
    const d = decideStaleRecovery();
    expect(d.status).toBe('failed');
    expect(d.resetCatalogState).toBe(true);
    expect(d.error).toMatch(/timed out/i);
  });
});

describe('shouldResetCatalogState (stuck-state bug)', () => {
  it('clean full completion → reset (next sync starts fresh)', () => {
    expect(shouldResetCatalogState({ success: true, needsContinuation: false })).toBe(true);
  });
  it('legitimately mid-flight (success + needs continuation) → keep state', () => {
    expect(shouldResetCatalogState({ success: true, needsContinuation: true })).toBe(false);
  });
  it('failure → reset so the brand is not stuck in processing-only mode', () => {
    expect(shouldResetCatalogState({ success: false, needsContinuation: false })).toBe(true);
    expect(shouldResetCatalogState({ success: false, needsContinuation: true })).toBe(true);
  });
});

describe('isJobWriteOwned (zombie-finalization race)', () => {
  const claimToken = 'tok-abc';
  it('owned: still running with our claim token', () => {
    expect(isJobWriteOwned({ currentStatus: 'running', currentClaimToken: 'tok-abc', claimToken })).toBe(true);
  });
  it('NOT owned after the stale sweep marked it failed (the observed live race)', () => {
    expect(isJobWriteOwned({ currentStatus: 'failed', currentClaimToken: 'tok-abc', claimToken })).toBe(false);
  });
  it('NOT owned after a newer pass re-claimed (token rotated)', () => {
    expect(isJobWriteOwned({ currentStatus: 'running', currentClaimToken: 'tok-xyz', claimToken })).toBe(false);
  });
  it('NOT owned when the job has no token (legacy doc / sweep-cleared)', () => {
    expect(isJobWriteOwned({ currentStatus: 'running', currentClaimToken: undefined, claimToken })).toBe(false);
  });
  it('NOT owned when the job was completed elsewhere', () => {
    expect(isJobWriteOwned({ currentStatus: 'completed', currentClaimToken: 'tok-abc', claimToken })).toBe(false);
  });
});
