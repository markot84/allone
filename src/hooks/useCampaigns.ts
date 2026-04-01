import { useQuery } from '@tanstack/react-query';
import { CampaignsService } from '../services/firestore';
import { useBrand } from './useBrand';

export function useCampaigns() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: campaigns = [], isPending } = useQuery({
    queryKey: ['campaigns', brandId],
    queryFn: () => (brandId ? CampaignsService.getAll(brandId) : Promise.resolve([])),
    enabled: !!brandId,
    // Μόνο manual invalidation (μετά sync / διαγραφή) — όχι refetch σε navigation, focus ή refresh (persist cache).
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
