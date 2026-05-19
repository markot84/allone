import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import {
  deleteCommercialAction,
  listCommercialActions,
  saveCommercialAction,
  type CommercialAction,
} from '../services/commercialActions';

export function useCommercialActions() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['commercial_actions', brandId],
    queryFn: () => (brandId ? listCommercialActions(brandId) : Promise.resolve([])),
    enabled: !!brandId,
    staleTime: 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: (action: Parameters<typeof saveCommercialAction>[1]) =>
      brandId ? saveCommercialAction(brandId, action) : Promise.reject(new Error('No brand')),
    onSuccess: () => {
      if (brandId) queryClient.invalidateQueries({ queryKey: ['commercial_actions', brandId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (actionId: string) => deleteCommercialAction(actionId),
    onSuccess: () => {
      if (brandId) queryClient.invalidateQueries({ queryKey: ['commercial_actions', brandId] });
    },
  });

  return {
    actions: query.data ?? [],
    isLoading: query.isPending,
    saveAction: saveMutation.mutateAsync,
    deleteAction: deleteMutation.mutateAsync,
    isSaving: saveMutation.isPending,
  };
}

export type { CommercialAction };
