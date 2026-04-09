import { useQuery } from '@tanstack/react-query';
import { CampaignsService } from '../services/firestore';
import { useBrand } from './useBrand';
import type { Campaign } from '../types';

export function useCampaigns() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryKey = ['campaigns', brandId] as const;

  const { data: campaigns = [], isPending } = useQuery({
    queryKey,
    queryFn: async () => {
      if (!brandId) return [] as Campaign[];
      // Server read: local Firestore cache can omit docs right after sync.
      return CampaignsService.getAll(brandId, { forceServer: true }) as Promise<Campaign[]>;
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
