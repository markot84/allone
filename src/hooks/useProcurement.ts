import { useQueries, useQueryClient } from '@tanstack/react-query';
import { ProcurementService, PROCUREMENT_COLLECTIONS } from '../services/firestore';
import { useBrand } from './useBrand';

type SheetKey = 'inventory' | 'costing' | 'item_evaluation' | 'customer_evaluation' | 'pricing_policy' | 'fiscal_year' | 'statistics';

const SHEET_TO_COLLECTION: Record<SheetKey, (typeof PROCUREMENT_COLLECTIONS)[number]> = {
  inventory: 'procurement_inventory',
  costing: 'procurement_costing',
  item_evaluation: 'procurement_item_evaluation',
  customer_evaluation: 'procurement_customer_evaluation',
  pricing_policy: 'procurement_pricing_policy',
  fiscal_year: 'procurement_fiscal_year',
  statistics: 'procurement_statistics',
};

const KEYS = Object.keys(SHEET_TO_COLLECTION) as SheetKey[];

const EMPTY: Record<SheetKey, unknown[]> = {
  inventory: [], costing: [], item_evaluation: [], customer_evaluation: [],
  pricing_policy: [], fiscal_year: [], statistics: [],
};

export function useProcurement(options?: { sheets?: readonly SheetKey[] }) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();
  const requestedSheets = options?.sheets?.length ? options.sheets : KEYS;

  // Per-sheet queries: κάθε sheet έχει ΔΙΚΟ του cache key → (α) όταν άλλη σελίδα ζητά ένα μόνο
  // sheet (π.χ. Dashboard → 'costing') δεν ξανακατεβαίνει στο Procurement page, (β) τα μεγάλα
  // sheets (inventory/costing για safeblock ~12k SKU) φορτώνονται ανεξάρτητα/παράλληλα και δεν
  // μπλοκάρουν το ένα το άλλο. `cacheFirst` → instant επαναφόρτωση από το persistent IndexedDB
  // cache σε κάθε επόμενη επίσκεψη (ο χρήστης μπαινοβγαίνει συχνά στη σελίδα).
  const results = useQueries({
    queries: requestedSheets.map((key) => ({
      queryKey: ['procurement-sheet', brandId, key],
      queryFn: () =>
        brandId
          ? ProcurementService.getAll(SHEET_TO_COLLECTION[key], brandId, { cacheFirst: true })
          : Promise.resolve([] as unknown[]),
      staleTime: 10 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      enabled: !!brandId,
      placeholderData: (previousData: unknown[] | undefined) => previousData,
    })),
  });

  const data: Record<SheetKey, unknown[]> = { ...EMPTY };
  const loadingSheets = new Set<SheetKey>();
  let anyPending = false;
  let anyFetching = false;
  requestedSheets.forEach((key, i) => {
    const r = results[i];
    data[key] = (r?.data as unknown[]) ?? [];
    if (r?.isPending) { anyPending = true; loadingSheets.add(key); }
    if (r?.isFetching) anyFetching = true;
  });

  return {
    data,
    isLoading: anyPending,
    isRefreshing: !anyPending && anyFetching,
    hasData: Object.values(data).some((arr) => (arr?.length ?? 0) > 0),
    /** Επιστρέφει true όσο το συγκεκριμένο sheet δεν έχει φορτώσει ακόμη (per-tab loading). */
    isSheetLoading: (key: SheetKey) => loadingSheets.has(key),
    invalidate: () => queryClient.invalidateQueries({ queryKey: ['procurement-sheet'] }),
  };
}
