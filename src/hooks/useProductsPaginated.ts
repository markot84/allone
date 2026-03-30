import { useState, useCallback } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { ProductsService } from '../services/firestore';
import { useBrand } from './useBrand';
import type { Product } from '../types';
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore';

const DEFAULT_PAGE_SIZE = 50;

export function useProductsPaginated(pageSize = DEFAULT_PAGE_SIZE) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<(QueryDocumentSnapshot<DocumentData> | null)[]>([null]);

  const { data, isPending } = useQuery({
    queryKey: ['products_paginated', brandId, page, pageSize],
    queryFn: () => {
      if (!brandId) return Promise.resolve({ items: [] as Product[], lastDoc: null, totalCount: 0 });
      return ProductsService.getPaginated(brandId, pageSize, cursors[page]);
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    placeholderData: keepPreviousData,
    enabled: !!brandId,
  });

  const products = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const hasNextPage = page < totalPages - 1;
  const hasPrevPage = page > 0;

  const goNext = useCallback(() => {
    if (!hasNextPage || !data?.lastDoc) return;
    const nextPage = page + 1;
    setCursors(prev => {
      const copy = [...prev];
      copy[nextPage] = data.lastDoc;
      return copy;
    });
    setPage(nextPage);
  }, [hasNextPage, data?.lastDoc, page]);

  const goPrev = useCallback(() => {
    if (!hasPrevPage) return;
    const prevPage = page - 1;
    setPage(prevPage);
  }, [hasPrevPage, page, cursors]);

  const goFirst = useCallback(() => {
    setPage(0);
  }, []);

  return {
    products,
    totalCount,
    page,
    totalPages,
    hasNextPage,
    hasPrevPage,
    goNext,
    goPrev,
    goFirst,
    isLoading: isPending,
    pageSize,
  };
}
