/** Per-brand source + dating for the Revenue Performance chart and total-revenue KPI.
 *  'eshop_order_date' = e-shop by order date (no weekend gaps); 'erp_document_date' = ERP by invoice date. */
export type RevenuePerformanceSource = 'eshop_order_date' | 'erp_document_date';

export const REVENUE_PERFORMANCE_SOURCES: readonly RevenuePerformanceSource[] = [
  'eshop_order_date',
  'erp_document_date',
];

/** Effective Revenue-Performance source; defaults to e-shop when an e-shop connector exists, else ERP. */
export function resolveRevenuePerformanceSource(
  configured: string | undefined,
  hasEshopConnector: boolean
): RevenuePerformanceSource {
  if (configured === 'eshop_order_date' || configured === 'erp_document_date') {
    return configured;
  }
  return hasEshopConnector ? 'eshop_order_date' : 'erp_document_date';
}

/** True when the Performance lens should use the e-shop order-date series (bypass ERP/procurement). */
export function prefersEshopRevenuePerformance(
  configured: string | undefined,
  hasEshopConnector: boolean
): boolean {
  return resolveRevenuePerformanceSource(configured, hasEshopConnector) === 'eshop_order_date';
}
