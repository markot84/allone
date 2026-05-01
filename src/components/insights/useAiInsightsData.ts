import { useMemo } from 'react';
import { useSegments } from '../../hooks/useSegments';
import { useProducts } from '../../hooks/useProducts';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { generateInsightsFromData } from '../../services/insights';

export function useAiInsightsData() {
  const { segments } = useSegments();
  const { products } = useProducts();
  const { suppliers } = useSuppliers();
  const ecomm = useEcommerceSummary();

  const supplierTodMap = useMemo(() => {
    const m = new Map<string, number>();
    suppliers.forEach(s => m.set(s.name, s.tod));
    return m;
  }, [suppliers]);

  const aiInsights = useMemo(
    () =>
      generateInsightsFromData(products, segments, supplierTodMap, {
        hasData: ecomm.orderCount > 0 || ecomm.totalRevenue > 0,
        hasConnector: ecomm.connectedPlatforms.length > 0,
        totalRevenue: ecomm.totalRevenue,
        orderCount: ecomm.orderCount,
        aov: ecomm.aov,
        platformBreakdown: ecomm.platformBreakdown,
      }),
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
    ]
  );

  return { aiInsights };
}
