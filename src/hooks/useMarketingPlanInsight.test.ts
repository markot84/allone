/** PER-157 — the freshness/readiness gate that decides server-doc vs local-compute fallback. */
import { describe, it, expect } from 'vitest';
import { processMarketingPlanInsightDoc } from './useMarketingPlanInsight';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const ts = (ms: number) => ({ toMillis: () => ms });
const blob = JSON.stringify({ next_month: { evidence: { orders: 5 }, reorderPlan: [], skuSuggestions: [] } });

describe('processMarketingPlanInsightDoc', () => {
  it('returns null for a missing doc', () => {
    expect(processMarketingPlanInsightDoc(null, NOW)).toBeNull();
  });

  it('is ready for a fresh, parseable, status=ready doc', () => {
    const r = processMarketingPlanInsightDoc(
      { status: 'ready', insightsJson: blob, productCount: 222634, signalCount: 766, sourceFingerprint: 'fp', computedAt: ts(NOW - DAY) },
      NOW,
    );
    expect(r?.ready).toBe(true);
    expect(r?.byPreset?.next_month).toBeTruthy();
    expect(r?.productCount).toBe(222634);
    expect(r?.fingerprint).toBe('fp');
  });

  it('is NOT ready when the doc is stale (>7d old) → caller falls back to local compute', () => {
    const r = processMarketingPlanInsightDoc(
      { status: 'ready', insightsJson: blob, computedAt: ts(NOW - 8 * DAY) },
      NOW,
    );
    expect(r?.ready).toBe(false);
    expect(r?.byPreset?.next_month).toBeTruthy(); // parsed, but not trusted
  });

  it('is ready exactly inside the 7-day boundary and not-ready just outside it', () => {
    const inside = processMarketingPlanInsightDoc({ status: 'ready', insightsJson: blob, computedAt: ts(NOW - (7 * DAY - 1000)) }, NOW);
    const outside = processMarketingPlanInsightDoc({ status: 'ready', insightsJson: blob, computedAt: ts(NOW - (7 * DAY + 1000)) }, NOW);
    expect(inside?.ready).toBe(true);
    expect(outside?.ready).toBe(false);
  });

  it('is NOT ready for status running/failed even when fresh', () => {
    for (const status of ['running', 'failed'] as const) {
      const r = processMarketingPlanInsightDoc({ status, insightsJson: blob, computedAt: ts(NOW - DAY) }, NOW);
      expect(r?.ready).toBe(false);
      expect(r?.status).toBe(status);
    }
  });

  it('is NOT ready when insightsJson is unparseable', () => {
    const r = processMarketingPlanInsightDoc({ status: 'ready', insightsJson: '{bad json', computedAt: ts(NOW - DAY) }, NOW);
    expect(r?.ready).toBe(false);
    expect(r?.byPreset).toBeNull();
  });

  it('is NOT ready when computedAt is missing (no freshness signal)', () => {
    const r = processMarketingPlanInsightDoc({ status: 'ready', insightsJson: blob, computedAt: null }, NOW);
    expect(r?.ready).toBe(false);
  });
});
