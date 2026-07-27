import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';

export interface SearchTerm {
  term: string;
  campaign: string;
  adGroup: string;
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number;
  conversionValue: number;
}

export interface Keyword {
  keyword: string;
  matchType: string;
  qualityScore: number | null;
  campaign: string;
  adGroup: string;
  status: string;
  impressions: number;
  clicks: number;
  conversions: number;
  cost: number;
  conversionValue: number;
}

interface SearchIntelligenceData {
  searchTerms: SearchTerm[];
  keywords: Keyword[];
  syncedAt: any;
  dateRange: { start: string; end: string };
}

async function fetchData(brandId: string): Promise<SearchIntelligenceData | null> {
  const snap = await getDoc(doc(db, 'search_intelligence', brandId));
  if (!snap.exists()) return null;
  return snap.data() as SearchIntelligenceData;
}

export function useSearchIntelligence() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['search_intelligence', brandId],
    queryFn: () => (brandId ? fetchData(brandId) : Promise.resolve(null)),
    enabled: !!brandId,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return {
    searchTerms: data?.searchTerms ?? [],
    keywords: data?.keywords ?? [],
    syncedAt: data?.syncedAt,
    dateRange: data?.dateRange,
    isLoading: isPending,
    hasData: !!data,
  };
}
