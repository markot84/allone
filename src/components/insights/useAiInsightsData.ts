import { useMemo } from 'react';
import { useSegments } from '../../hooks/useSegments';
import { useProducts } from '../../hooks/useProducts';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { scenarios } from '../../data';
import { generateInsightsFromData } from '../../services/insights';

/**
 * @param options.skipOrderHydration — Dashboard context: ΜΗΝ τραβάς 400ήμερο raw order history
 *   για client-side RFM (παγώνει το main thread σε brands με χιλιάδες orders). Χρησιμοποιεί
 *   imported/aggregate segments — ίδια πηγή με το dashboard segment grid.
 */
export function useAiInsightsData(options: { skipOrderHydration?: boolean } = {}) {
  const { segments } = useSegments({ skipOrderHydration: options.skipOrderHydration });
  const { products } = useProducts();
  const { suppliers } = useSuppliers();
  const ecomm = useEcommerceSummary();
  const { activeStrategy } = useActiveStrategy();

  const supplierTodMap = useMemo(() => {
    const m = new Map<string, number>();
    suppliers.forEach(s => m.set(s.name, s.tod));
    return m;
  }, [suppliers]);

  // Εξάγουμε τα AI-επιλεγμένα segments από την ενεργή στρατηγική ώστε τα insights
  // να ευθυγραμμίζονται με το Channel Activation (single AI voice για τον χρήστη).
  const strategyContext = useMemo(() => {
    const rec = activeStrategy?.activationRecommendation ?? activeStrategy?.channelRecommendation;
    const targetSegments = rec?.targetSegments;
    if (!targetSegments || targetSegments.length === 0) return null;
    // Φιλτράρουμε μόνο ideal+good (ίδια λογική με Channel Activation recommendedSegments)
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
        products,
        segments,
        supplierTodMap,
        {
          hasData: ecomm.orderCount > 0 || ecomm.totalRevenue > 0,
          hasConnector: ecomm.connectedPlatforms.length > 0,
          totalRevenue: ecomm.totalRevenue,
          orderCount: ecomm.orderCount,
          aov: ecomm.aov,
          platformBreakdown: ecomm.platformBreakdown,
        },
        strategyContext,
      ),
    [
      products,
      segments,
      supplierTodMap,
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
