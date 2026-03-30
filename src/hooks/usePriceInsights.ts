import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';

export interface PriceInsight {
  productId: string;
  title: string;
  brand: string;
  currency: string;
  currentPrice: number;
  suggestedPrice: number;
  priceDiffPercent: number;
  predictedImpressionsChange: number;
  predictedClicksChange: number;
  predictedConversionsChange: number;
}

interface PriceInsightsData {
  items: PriceInsight[];
  count: number;
  syncedAt: any;
}

async function fetchInsights(brandId: string): Promise<PriceInsightsData | null> {
  const snap = await getDoc(doc(db, 'price_insights', brandId));
  if (!snap.exists()) return null;
  return snap.data() as PriceInsightsData;
}

export function usePriceInsights() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['priceInsights', brandId],
    queryFn: () => (brandId ? fetchInsights(brandId) : Promise.resolve(null)),
    staleTime: 10 * 60 * 1000,
    enabled: !!brandId,
  });

  const items = data?.items ?? [];
  const withSuggestion = items.filter(i => i.suggestedPrice > 0 && i.suggestedPrice !== i.currentPrice);
  const avgConvLift = withSuggestion.length > 0
    ? Math.round(withSuggestion.reduce((s, i) => s + i.predictedConversionsChange, 0) / withSuggestion.length * 100)
    : 0;

  return {
    insights: items,
    isLoading: isPending,
    hasData: !!data,
    count: items.length,
    withSuggestionCount: withSuggestion.length,
    avgConvLift,
    syncedAt: data?.syncedAt,
  };
}
