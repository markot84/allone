import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { FeedSourcesService } from '../services/feedSources';
import type { FeedSource } from '../types';

export function useFeedSources() {
  const { currentBrand } = useBrand();
  const queryClient = useQueryClient();
  const brandId = currentBrand?.id ?? null;

  const query = useQuery({
    queryKey: ['feed_sources', brandId],
    queryFn: () => FeedSourcesService.getAll(brandId),
    enabled: !!brandId,
  });

  const createMutation = useMutation({
    mutationFn: (data: Omit<FeedSource, 'id' | 'createdAt' | 'updatedAt'>) =>
      FeedSourcesService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed_sources', brandId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FeedSource> }) =>
      FeedSourcesService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed_sources', brandId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => FeedSourcesService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feed_sources', brandId] });
    },
  });

  return {
    feedSources: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    create: createMutation.mutateAsync,
    update: updateMutation.mutateAsync,
    remove: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isDeleting: deleteMutation.isPending,
  };
}
