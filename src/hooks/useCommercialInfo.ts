import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuth } from 'firebase/auth';
import { useBrand } from './useBrand';
import {
  listCommercialInfo,
  createCommercialInfo,
  updateCommercialInfo,
  deleteCommercialInfo,
  structureCommercialInfo,
  type CommercialInfo,
  type CommercialInfoStructured,
  type CommercialInfoStatus,
  type MarkDialogueContext,
} from '../services/commercialInfo';

const STALE = 5 * 60 * 1000;

/** Λίστα εμπορικών πληροφοριών του ενεργού brand + mutations. Brand-scoped queryKey. */
export function useCommercialInfo() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['commercial_info', brandId],
    queryFn: () => listCommercialInfo(brandId as string),
    enabled: !!brandId,
    staleTime: STALE,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['commercial_info', brandId] });

  const addInfo = useMutation({
    mutationFn: async (input: {
      rawText: string;
      structured: CommercialInfoStructured;
      source?: 'owner' | 'mark' | 'nilia';
      markContext?: MarkDialogueContext;
    }) => {
      if (!brandId) throw new Error('Δεν έχει επιλεγεί brand');
      const uid = getAuth().currentUser?.uid ?? null;
      return createCommercialInfo({
        brandId,
        rawText: input.rawText,
        structured: input.structured,
        source: input.source ?? 'owner',
        createdBy: uid,
        markContext: input.markContext,
      });
    },
    onSuccess: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: async (input: { id: string; status: CommercialInfoStatus }) =>
      updateCommercialInfo(input.id, { status: input.status }),
    onSuccess: invalidate,
  });

  const editInfo = useMutation({
    mutationFn: async (input: {
      id: string;
      rawText?: string;
      structured?: Partial<CommercialInfoStructured>;
    }) => updateCommercialInfo(input.id, { rawText: input.rawText, structured: input.structured }),
    onSuccess: invalidate,
  });

  const removeInfo = useMutation({
    mutationFn: async (id: string) => deleteCommercialInfo(id),
    onSuccess: invalidate,
  });

  return {
    items: (query.data ?? []) as CommercialInfo[],
    isLoading: query.isLoading,
    isError: query.isError,
    brandId,
    brandName: currentBrand?.name ?? null,
    refetch: query.refetch,
    addInfo,
    setStatus,
    editInfo,
    removeInfo,
    structure: structureCommercialInfo,
  };
}
