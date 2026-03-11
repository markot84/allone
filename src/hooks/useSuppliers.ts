import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { SuppliersService } from '../services/firestore';
import { useBrand } from './useBrand';
import type { Supplier } from '../types';

export function useSuppliers() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();

  const { data: suppliers = [], isPending } = useQuery({
    queryKey: ['suppliers', brandId],
    queryFn: () => (brandId ? SuppliersService.getAll(brandId) : Promise.resolve([])) as Promise<Supplier[]>,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const updateTod = useMutation({
    mutationFn: ({ id, tod }: { id: string; tod: number }) =>
      SuppliersService.update(id, { tod }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers', brandId] }),
  });

  const deleteSupplier = useMutation({
    mutationFn: (id: string) => SuppliersService.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['suppliers', brandId] }),
  });

  return {
    suppliers: brandId ? suppliers : [],
    isLoading: isPending,
    hasSuppliers: suppliers.length > 0,
    updateTod,
    deleteSupplier,
    invalidate: () => queryClient.invalidateQueries({ queryKey: ['suppliers', brandId] }),
  };
}
