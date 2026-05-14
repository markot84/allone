import { useQuery, useQueryClient } from '@tanstack/react-query';
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

async function fetchSheets(brandId: string, keys: readonly SheetKey[]) {
  const results = await Promise.all(
    keys.map((key) => ProcurementService.getAll(SHEET_TO_COLLECTION[key], brandId))
  );
  return Object.fromEntries(keys.map((key, i) => [key, results[i]])) as Partial<Record<SheetKey, unknown[]>>;
}

export function useProcurement(options?: { sheets?: readonly SheetKey[] }) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();
  const requestedSheets = options?.sheets?.length ? options.sheets : KEYS;
  const sheetsKey = requestedSheets.join('|');

  const { data, isPending, isFetching } = useQuery({
    queryKey: ['procurement', brandId, sheetsKey],
    queryFn: () => (brandId ? fetchSheets(brandId, requestedSheets) : Promise.resolve(null)),
    staleTime: 10 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    enabled: !!brandId,
    placeholderData: (previousData) => previousData,
  });

  const empty: Record<SheetKey, unknown[]> = {
    inventory: [], costing: [], item_evaluation: [], customer_evaluation: [],
    pricing_policy: [], fiscal_year: [], statistics: [],
  };

  const allData = { ...empty, ...(data ?? {}) };

  return {
    data: allData,
    isLoading: isPending,
    isRefreshing: !isPending && isFetching,
    hasData: Object.values(allData).some((arr) => (arr?.length ?? 0) > 0),
    invalidate: () => queryClient.invalidateQueries({ queryKey: ['procurement'] }),
  };
}
