import { useMemo } from 'react';
import { useSegments } from '../../hooks/useSegments';
import { useProductIntelligenceAggregateDoc } from '../../hooks/useProductIntelligenceAggregate';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { scenarios } from '../../data';
import { generateInsightsFromData, type InsightInventoryAggregate } from '../../services/insights';
import type { Product } from '../../types';

// Product cards are fed from the PI aggregate — no products read.
// Module-level so the reference stays stable for useMemo.
const EMPTY_PRODUCTS: Product[] = [];

// skipOrderHydration (Dashboard context): skip 400-day raw order history for client-side RFM
// (freezes main thread on large stores); use imported/aggregate segments instead.
export function useAiInsightsData(options: { skipOrderHydration?: boolean; useServerAggregate?: boolean } = {}) {
  const { segments } = useSegments({
    skipOrderHydration: options.skipOrderHydration,
    useServerAggregate: options.useServerAggregate,
  });
  const piAggregate = useProductIntelligenceAggregateDoc();
  // Summary-only — no SKU details / stock movement sheets; shares the Dashboard's
  // cache entry (the queryKey splits on the same options).
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const { activeStrategy } = useActiveStrategy();

  // Import-only stores: aggregate null ⇒ inventory null ⇒ with products: [] the product
  // cards are honestly absent (the insights.ts guards don't pass with zeroed values).
  const inventory = useMemo<InsightInventoryAggregate | null>(
    () =>
      piAggregate.aggregate
        ? {
            summary: piAggregate.aggregate.summary,
            categoriesCount: piAggregate.aggregate.categories?.length ?? 0,
            totalCount: piAggregate.aggregate.totalCount,
          }
        : null,
    [piAggregate.aggregate]
  );

  // Extract the AI-selected segments from the active strategy so insights
  // align with Channel Activation (single AI voice for the user).
  const strategyContext = useMemo(() => {
    const rec = activeStrategy?.activationRecommendation ?? activeStrategy?.channelRecommendation;
    const targetSegments = rec?.targetSegments;
    if (!targetSegments || targetSegments.length === 0) return null;
    // Keep only ideal+good (same logic as Channel Activation recommendedSegments)
    const names = targetSegments
      .filter((s) => !s.fit || s.fit === 'ideal' || s.fit === 'good')
      .map((s) => s.name);
    if (names.length === 0) return null;
    const scenarioName = activeStrategy?.scenarioId
      ? scenarios.find((sc) => sc.id === activeStrategy.scenarioId)?.name
      : undefined;
    return { name: scenarioName, targetSegmentNames: names };
  }, [activeStrategy]);

  const aiInsights = useMemo(
    () =>
      generateInsightsFromData(
        EMPTY_PRODUCTS,
        segments,
        undefined,
        {
          hasData: ecomm.orderCount > 0 || ecomm.totalRevenue > 0,
          hasConnector: ecomm.connectedPlatforms.length > 0,
          totalRevenue: ecomm.totalRevenue,
          orderCount: ecomm.orderCount,
          aov: ecomm.aov,
          platformBreakdown: ecomm.platformBreakdown,
        },
        strategyContext,
        inventory,
      ),
    [
      segments,
      inventory,
      ecomm.orderCount > 0 || ecomm.totalRevenue > 0,
      ecomm.connectedPlatforms.length > 0,
      ecomm.totalRevenue,
      ecomm.orderCount,
      ecomm.aov,
      ecomm.platformBreakdown,
      strategyContext,
    ]
  );

  return { aiInsights };
}
