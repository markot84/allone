import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { useAuth } from './useAuth';
import {
  getChannelActivations,
  saveChannelActivation,
  type ChannelActivationStatus,
} from '../services/channelActivationService';

export function useChannelActivations(strategyId: string | null) {
  const { currentBrand } = useBrand();
  const { user } = useAuth();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();

  const { data: activations = [], isLoading } = useQuery({
    queryKey: ['channelActivations', brandId],
    queryFn: () => getChannelActivations(brandId!),
    enabled: !!brandId,
    staleTime: 60_000,
  });

  const currentActivations = activations.filter(a => a.strategyId === strategyId);

  const updateActivation = useMutation({
    mutationFn: async (params: { channel: string; status?: ChannelActivationStatus['status']; note?: string }) => {
      if (!brandId || !strategyId) return;
      const docId = `${brandId}_${strategyId}_${params.channel.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const existing = currentActivations.find(a => a.channel === params.channel);
      const data: ChannelActivationStatus = {
        id: docId,
        brandId,
        strategyId,
        channel: params.channel,
        status: params.status ?? existing?.status ?? 'pending',
        note: params.note ?? existing?.note ?? '',
        updatedAt: new Date().toISOString(),
        updatedBy: user?.email || user?.uid || 'unknown',
      };
      await saveChannelActivation(data);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channelActivations', brandId] });
    },
  });

  function getStatus(channel: string): ChannelActivationStatus['status'] {
    return currentActivations.find(a => a.channel === channel)?.status ?? 'pending';
  }

  function getNote(channel: string): string {
    return currentActivations.find(a => a.channel === channel)?.note ?? '';
  }

  return {
    activations: currentActivations,
    isLoading,
    updateActivation: updateActivation.mutateAsync,
    isSaving: updateActivation.isPending,
    getStatus,
    getNote,
  };
}
