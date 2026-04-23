import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';

export interface MagentoPopularSearchTerm {
  term: string;
  hits: number;
}

export type MagentoPopularSearchesProvenance =
  | 'magento_searchTerms_rest'
  | 'magento_orders_line_items'
  | null;

interface MagentoPopularSearchesDoc {
  terms?: MagentoPopularSearchTerm[];
  syncedAt?: unknown;
  termsProvenance?: MagentoPopularSearchesProvenance;
  source?: string;
}

async function fetchMagentoPopularSearches(
  brandId: string
): Promise<{ terms: MagentoPopularSearchTerm[]; termsProvenance: MagentoPopularSearchesProvenance }> {
  const snap = await getDoc(doc(db, 'magento_popular_searches', brandId));
  if (!snap.exists()) return { terms: [], termsProvenance: null };
  const data = snap.data() as MagentoPopularSearchesDoc;
  const terms = Array.isArray(data.terms) ? data.terms : [];
  const termsProvenance =
    data.termsProvenance ??
    (data.source === 'magento_orders_line_items' ? 'magento_orders_line_items' : null);
  return { terms, termsProvenance };
}

export function useMagentoPopularSearches() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['magento_popular_searches', brandId],
    queryFn: () => (brandId ? fetchMagentoPopularSearches(brandId) : Promise.resolve({ terms: [], termsProvenance: null })),
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    enabled: !!brandId,
  });

  return {
    terms: data?.terms ?? [],
    termsProvenance: data?.termsProvenance ?? null,
    isLoading: isPending,
    hasData: (data?.terms?.length ?? 0) > 0,
  };
}
