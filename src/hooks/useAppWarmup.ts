import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { doc, getDoc, limit, orderBy } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useBrand } from './useBrand';
import { fetchBrandSyncVersion } from '../services/brandSyncVersion';
import { FirestoreService, ProductsService, SuppliersService } from '../services/firestore';
import { AutomationAlertsService, AutomationSettingsService } from '../services/automationSettings';
import { FeedSourcesService } from '../services/feedSources';
import { fetchEcommerceSummary } from './useEcommerceSummary';
import { fetchBusinessRevenueSummary } from './useBusinessRevenueSummary';
import type { ActiveStrategy } from './useActiveStrategy';

type IdleHandle = number;

function scheduleIdle(callback: () => void, timeout = 2000): IdleHandle {
  if (typeof window === 'undefined') return 0;
  const w = window as Window & {
    requestIdleCallback?: (cb: IdleRequestCallback, opts?: IdleRequestOptions) => number;
  };
  if (typeof w.requestIdleCallback === 'function') {
    return w.requestIdleCallback(() => callback(), { timeout });
  }
  return window.setTimeout(callback, Math.min(timeout, 1200));
}

function cancelIdle(handle: IdleHandle): void {
  if (!handle || typeof window === 'undefined') return;
  const w = window as Window & { cancelIdleCallback?: (id: number) => void };
  if (typeof w.cancelIdleCallback === 'function') {
    w.cancelIdleCallback(handle);
  } else {
    window.clearTimeout(handle);
  }
}

async function fetchAggregate<T>(brandId: string, type: string): Promise<T | null> {
  const snap = await getDoc(doc(db, 'brands', brandId, 'aggregates', type));
  return snap.exists() ? (snap.data() as T) : null;
}

async function fetchActiveStrategy(brandId: string): Promise<ActiveStrategy | null> {
  try {
    const rows = await FirestoreService.getDocuments<ActiveStrategy>(
      'active_strategies',
      [orderBy('updatedAt', 'desc'), limit(1)],
      brandId
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export function useAppWarmup() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!brandId || typeof window === 'undefined') return;
    let cancelled = false;
    const prefetch = (task: () => Promise<unknown>) => {
      if (cancelled) return;
      task().catch(() => {
        // Warm-up is opportunistic; feature pages still own visible errors.
      });
    };

    const phaseOne = window.setTimeout(() => {
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['brandSyncVersion', brandId],
          queryFn: () => fetchBrandSyncVersion(brandId),
          staleTime: 60 * 1000,
        })
      );
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['aggregates', 'products', brandId],
          queryFn: () => fetchAggregate(brandId, 'products'),
          staleTime: 10 * 60 * 1000,
        })
      );
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['aggregates', 'segments', brandId],
          queryFn: () => fetchAggregate(brandId, 'segments'),
          staleTime: 10 * 60 * 1000,
        })
      );
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['aggregates', 'campaigns', brandId],
          queryFn: () => fetchAggregate(brandId, 'campaigns'),
          staleTime: 10 * 60 * 1000,
        })
      );
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['activeStrategy', brandId],
          queryFn: () => fetchActiveStrategy(brandId),
          staleTime: 10 * 60 * 1000,
        })
      );
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['business_revenue_summary', brandId],
          queryFn: () => fetchBusinessRevenueSummary(brandId),
          staleTime: 10 * 60 * 1000,
        })
      );
    }, 0);

    const phaseTwo = scheduleIdle(() => {
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['ecommerce_summary', brandId],
          queryFn: () => fetchEcommerceSummary(brandId),
          staleTime: 10 * 60 * 1000,
        })
      );
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['suppliers', brandId],
          queryFn: () => SuppliersService.getAll(brandId),
          staleTime: 5 * 60 * 1000,
        })
      );
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['products', brandId, 'count'],
          queryFn: () => ProductsService.getCount(brandId),
          staleTime: 5 * 60 * 1000,
        })
      );
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['automation_settings', brandId],
          queryFn: () => AutomationSettingsService.get(brandId),
          staleTime: 5 * 60 * 1000,
        })
      );
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['automation_alerts', brandId],
          queryFn: () => AutomationAlertsService.getAll(brandId),
          staleTime: 60 * 1000,
        })
      );
      prefetch(() =>
        queryClient.prefetchQuery({
          queryKey: ['feed_sources', brandId],
          queryFn: () => FeedSourcesService.getAll(brandId),
          staleTime: 5 * 60 * 1000,
        })
      );
    }, 3500);

    return () => {
      cancelled = true;
      window.clearTimeout(phaseOne);
      cancelIdle(phaseTwo);
    };
  }, [brandId, queryClient]);
}
