import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBrand } from './useBrand';
import { MarketBriefsService } from '../services/firestore';
import { generateMarketBrief, type MarketBrief } from '../services/aiMarketBrief';
import type { MarketBriefPromptContext } from '../data/marketBriefPrompt';

export type MarketBriefListItem = {
  id: string;
  brandId: string;
  countryCode: string;
  countryName: string;
  verticalFocus?: string;
  brief: MarketBrief;
  createdAt?: string;
  updatedAt?: string;
};

export function useMarketBriefs() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['marketBriefs', brandId],
    queryFn: async (): Promise<MarketBriefListItem[]> => {
      if (!brandId) return [];
      const rows = await MarketBriefsService.getAll(brandId);
      const valid = rows.filter((r) => r && (r as { brief?: unknown }).brief && typeof (r as { brief?: unknown }).brief === 'object');
      const sorted = [...valid].sort((a, b) => {
        const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
        const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
        return tb - ta;
      });
      return sorted as MarketBriefListItem[];
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  const saveMutation = useMutation({
    mutationFn: async (params: { ctx: MarketBriefPromptContext }): Promise<string> => {
      if (!brandId) throw new Error('No brand');
      const brief = await generateMarketBrief(params.ctx);
      return MarketBriefsService.save(
        brandId,
        params.ctx.countryName,
        params.ctx.countryCode,
        params.ctx.verticalFocus,
        brief
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketBriefs', brandId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (docId: string) => {
      await MarketBriefsService.delete(docId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['marketBriefs', brandId] });
    },
  });

  return {
    brandId,
    briefs: listQuery.data ?? [],
    isLoadingList: listQuery.isPending,
    listError: listQuery.error,
    generateBrief: saveMutation.mutateAsync,
    isGenerating: saveMutation.isPending,
    generateError: saveMutation.error,
    deleteBrief: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
}
