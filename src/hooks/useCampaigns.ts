import { useQuery } from '@tanstack/react-query';
import { CampaignsService } from '../services/firestore';
import { useBrand } from './useBrand';

export function useCampaigns() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: campaigns = [], isPending } = useQuery({
    queryKey: ['campaigns', brandId],
    queryFn: () => (brandId ? CampaignsService.getAll(brandId) : Promise.resolve([])),
  });

  return {
    campaigns,
    count: campaigns.length,
    isLoading: isPending,
    hasImported: campaigns.length > 0,
  };
}
