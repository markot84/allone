import { useQuery } from '@tanstack/react-query';
import { ContentService } from '../services/firestore';
import { useBrand } from './useBrand';

export interface ContentItem {
  id: string;
  title?: string;
  type?: string;
  week?: number;
  topic?: string;
  formats?: string[];
  target_segments?: string[];
  products_featured?: number | string[];
  status?: string;
  segment?: string;
  scheduled?: string;
  is_aligned?: boolean;
  strategy_match?: string;
  alignment_warning?: string;
  suggestion?: string;
  performance?: { opens?: number; clicks?: number; conversions?: number };
}

export function useContent() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: firestoreContent = [], isPending } = useQuery({
    queryKey: ['content', brandId],
    queryFn: () => (brandId ? ContentService.getAll(brandId) : Promise.resolve([])) as Promise<ContentItem[]>,
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });

  // When brandId is set: show real data only. When no brand: empty (no mock).
  const contentItems = (brandId ? (firestoreContent as ContentItem[]) : []) as ContentItem[];
  return {
    contentItems,
    hasImported: firestoreContent.length > 0,
    isLoading: isPending,
  };
}
