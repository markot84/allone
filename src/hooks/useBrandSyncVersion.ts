import { useQuery } from '@tanstack/react-query';
import { fetchBrandSyncVersion } from '../services/brandSyncVersion';

export function useBrandSyncVersion(brandId: string | null) {
  return useQuery({
    queryKey: ['brandSyncVersion', brandId],
    queryFn: () => (brandId ? fetchBrandSyncVersion(brandId) : Promise.resolve(null)),
    enabled: !!brandId,
    staleTime: 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
