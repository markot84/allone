import { describe, expect, it } from 'vitest';
import { parseMarketingPlanMessage } from './marketingPlanMessage';
import { buildFallbackCoreMessage } from './marketingPlanEngine';
import type { MarketingPlanInsight } from './marketingPlanInsights';

describe('marketingPlanMessage', () => {
  it('parses strict AI JSON into a core message', () => {
    const parsed = parseMarketingPlanMessage(JSON.stringify({
      headline: 'Καλοκαιρινή ώθηση στα running',
      campaignAngle: 'Εστιάζουμε στα running γιατί πέρυσι είχαν υψηλή ζήτηση.',
      proofPoints: ['120 τεμάχια πέρυσι', '€4.500 τζίρος'],
      ctaIdeas: ['Δείτε τη συλλογή'],
    }));

    expect(parsed).toMatchObject({
      headline: 'Καλοκαιρινή ώθηση στα running',
      source: 'ai',
    });
    expect(parsed?.proofPoints).toHaveLength(2);
  });

  it('builds deterministic fallback from top reorder evidence', () => {
    const fallback = buildFallbackCoreMessage({
      period: { presetId: 'next_month', periodLabel: 'Επόμενος μήνας', fromDate: '2026-06-01', toDate: '2026-06-30' },
      evidence: { lastYearFromDate: '2025-06-01', lastYearToDate: '2025-06-30', revenue: 1000, orders: 10, units: 20, aov: 100, lines: 10, matchedLines: 10 },
      reorderPlan: [{
        key: 'Shoes',
        category: 'Shoes',
        subcategory: 'Running',
        brand: 'Brand A',
        lastYearRevenue: 1000,
        lastYearUnits: 20,
        currentStock: 5,
        currentStockValue: 50,
        estimatedReorderQty: 17,
        estimatedReorderValue: 170,
        action: 'increase',
        confidence: 'high',
        rationale: 'test',
      }],
      skuSuggestions: [],
      dataQuality: { level: 'strong', lineItemCoveragePct: 100, inventoryCoveragePct: 100, notes: [] },
    } satisfies MarketingPlanInsight);

    expect(fallback.source).toBe('fallback');
    expect(fallback.headline).toContain('Running');
    expect(fallback.proofPoints.join(' ')).toContain('20');
  });
});
