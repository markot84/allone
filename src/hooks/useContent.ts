import { useQuery } from '@tanstack/react-query';
import { ContentService } from '../services/firestore';
import { useBrand } from './useBrand';
import { contentItems as mockContentItems } from '../data/mockContent';

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
  });

  const contentItems = firestoreContent.length > 0 ? (firestoreContent as ContentItem[]) : mockContentItems;
  return {
    contentItems,
    hasImported: firestoreContent.length > 0,
    isLoading: isPending,
  };
}
