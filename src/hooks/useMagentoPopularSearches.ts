import { useQuery } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';

export interface MagentoPopularSearchTerm {
  term: string;
  hits: number;
  results?: number;
}

export type MagentoPopularSearchesProvenance =
  | 'magento_searchTerms_rest'
  | 'magento_admin_csv'
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
): Promise<{
  terms: MagentoPopularSearchTerm[];
  termsProvenance: MagentoPopularSearchesProvenance;
  syncedAt: Date | null;
}> {
  const snap = await getDoc(doc(db, 'magento_popular_searches', brandId));
  if (!snap.exists()) return { terms: [], termsProvenance: null, syncedAt: null };
  const data = snap.data() as MagentoPopularSearchesDoc;
  const rawTerms = Array.isArray(data.terms) ? data.terms : [];
  const terms = rawTerms
    .map((t) => ({
      term: String(t?.term ?? '').trim(),
      hits: Number(t?.hits ?? 0) || 0,
      results: typeof t?.results === 'number' ? t.results : undefined,
    }))
    .filter((t) => t.term.length > 0)
    .sort((a, b) => b.hits - a.hits);
  const termsProvenance =
    data.termsProvenance ??
    (data.source === 'magento_orders_line_items' ? 'magento_orders_line_items' : null);
  let syncedAt: Date | null = null;
  const sa = data.syncedAt as { toDate?: () => Date } | Date | undefined;
  if (sa instanceof Date) syncedAt = sa;
  else if (sa && typeof (sa as { toDate?: () => Date }).toDate === 'function') {
    syncedAt = (sa as { toDate: () => Date }).toDate();
  }
  return { terms, termsProvenance, syncedAt };
}

export function useMagentoPopularSearches() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending } = useQuery({
    queryKey: ['magento_popular_searches', brandId],
    queryFn: () =>
      brandId
        ? fetchMagentoPopularSearches(brandId)
        : Promise.resolve({ terms: [], termsProvenance: null, syncedAt: null }),
    staleTime: 60 * 1000,
    refetchOnMount: 'always',
    enabled: !!brandId,
  });

  return {
    terms: data?.terms ?? [],
    termsProvenance: data?.termsProvenance ?? null,
    syncedAt: data?.syncedAt ?? null,
    isLoading: isPending,
    hasData: (data?.terms?.length ?? 0) > 0,
  };
}
