import { useQuery, useQueryClient } from '@tanstack/react-query';
import { collection, query, orderBy, where, getDocsFromCache } from 'firebase/firestore';
import { db } from '../config/firebase';
import { CampaignsService } from '../services/firestore';
import { useBrand } from './useBrand';
import type { Campaign } from '../types';

export function useCampaigns() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();
  const queryKey = ['campaigns', brandId] as const;

  const { data: campaigns = [], isPending } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!brandId) return [] as Campaign[];

      // If in-memory data already exists, this is a post-sync invalidation refetch.
      // Go to network to get the freshly-imported campaigns.
      const inMemory = queryClient.getQueryData(queryKey);
      if (inMemory) {
        return CampaignsService.getAll(brandId) as Promise<Campaign[]>;
      }

      // No in-memory data (page refresh or first-ever load).
      // Try Firestore's local IndexedDB cache first — returns instantly, no network round-trip.
      try {
        const q = query(
          collection(db, 'campaigns'),
          where('brandId', '==', brandId),
          orderBy('createdAt', 'desc')
        );
        const cachedSnap = await getDocsFromCache(q);
        if (!cachedSnap.empty) {
          return cachedSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Campaign[];
        }
      } catch {
        // Cache miss (first load or IndexedDB cleared) — fall through to network.
      }

      return CampaignsService.getAll(brandId) as Promise<Campaign[]>;
    },
    enabled: !!brandId,
    // Never stale — only invalidated explicitly after sync or delete.
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return {
    campaigns,
    count: campaigns.length,
    isLoading: isPending,
    hasImported: campaigns.length > 0,
  };
}
