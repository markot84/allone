import { useQuery } from '@tanstack/react-query';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';

/** PER-307: slim server-precomputed {childSku → parentSku} map; missing doc ≡ empty ⇒ identity grouping, self-heals on the next Magento sync. */
export function useMagentoParentLinks(): { links: Record<string, string>; isLoading: boolean } {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data, isPending, isFetching } = useQuery({
    queryKey: ['magento_parent_links', brandId],
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<Record<string, string>> => {
      const snap = await getDocs(collection(db, 'magento_parent_links', brandId!, 'chunks'));
      const merged: Record<string, string> = {};
      for (const d of snap.docs) {
        const json = (d.data() as { skuStatsJson?: string }).skuStatsJson;
        if (!json) continue;
        try {
          const partial = JSON.parse(json);
          for (const k of Object.keys(partial)) {
            if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
            if (typeof partial[k] === 'string') merged[k] = partial[k];
          }
        } catch { /* corrupt chunk — skip, identity grouping covers it */ }
      }
      return merged;
    },
  });

  return { links: data ?? {}, isLoading: isPending && isFetching };
}
