import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ProcurementService, PROCUREMENT_COLLECTIONS } from '../services/firestore';
import { useBrand } from './useBrand';

export function useProcurement() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const queryClient = useQueryClient();

  const fetchSheet = (key: (typeof PROCUREMENT_COLLECTIONS)[number]) =>
    brandId ? ProcurementService.getAll(key, brandId) : Promise.resolve([]);

  const inventory = useQuery({
    queryKey: ['procurement', 'inventory', brandId],
    queryFn: () => fetchSheet('procurement_inventory'),
    enabled: !!brandId,
  });

  const costing = useQuery({
    queryKey: ['procurement', 'costing', brandId],
    queryFn: () => fetchSheet('procurement_costing'),
    enabled: !!brandId,
  });

  const itemEvaluation = useQuery({
    queryKey: ['procurement', 'item_evaluation', brandId],
    queryFn: () => fetchSheet('procurement_item_evaluation'),
    enabled: !!brandId,
  });

  const customerEvaluation = useQuery({
    queryKey: ['procurement', 'customer_evaluation', brandId],
    queryFn: () => fetchSheet('procurement_customer_evaluation'),
    enabled: !!brandId,
  });

  const pricingPolicy = useQuery({
    queryKey: ['procurement', 'pricing_policy', brandId],
    queryFn: () => fetchSheet('procurement_pricing_policy'),
    enabled: !!brandId,
  });

  const fiscalYear = useQuery({
    queryKey: ['procurement', 'fiscal_year', brandId],
    queryFn: () => fetchSheet('procurement_fiscal_year'),
    enabled: !!brandId,
  });

  const statistics = useQuery({
    queryKey: ['procurement', 'statistics', brandId],
    queryFn: () => fetchSheet('procurement_statistics'),
    enabled: !!brandId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['procurement'] });
  };

  const allData = {
    inventory: inventory.data ?? [],
    costing: costing.data ?? [],
    item_evaluation: itemEvaluation.data ?? [],
    customer_evaluation: customerEvaluation.data ?? [],
    pricing_policy: pricingPolicy.data ?? [],
    fiscal_year: fiscalYear.data ?? [],
    statistics: statistics.data ?? [],
  };

  return {
    data: allData,
    isLoading: inventory.isPending || costing.isPending || itemEvaluation.isPending ||
      customerEvaluation.isPending || pricingPolicy.isPending || fiscalYear.isPending || statistics.isPending,
    hasData: Object.values(allData).some((arr) => (arr?.length ?? 0) > 0),
    invalidate,
  };
}
