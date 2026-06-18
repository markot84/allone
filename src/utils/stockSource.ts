/** Per-brand authoritative source for the product catalog + stock (Product Intelligence).
 *  'erp' = ERP connector catalog/stock; 'ecommerce' = e-shop platform; 'procurement' = uploaded procurement file. */
export type StockSourceMode = 'erp' | 'ecommerce' | 'procurement';

export const STOCK_SOURCE_MODES: readonly StockSourceMode[] = ['erp', 'ecommerce', 'procurement'];

export interface StockSourceContext {
  plan?: string;
  /** brands/{brandId}.enabledModules.procurement (false = explicitly disabled). */
  procurementModuleEnabled?: boolean;
  hasErpConnector: boolean;
}

/** Effective stock source. Default mirrors the current implicit authority so existing brands are unchanged:
 *  procurement (enterprise + procurement module) → ERP (an ERP connector) → e-commerce. */
export function resolveStockSourceMode(
  configured: string | undefined,
  ctx: StockSourceContext
): StockSourceMode {
  if (configured === 'erp' || configured === 'ecommerce' || configured === 'procurement') {
    return configured;
  }
  const isEnterprise = String(ctx.plan ?? '').toLowerCase() === 'enterprise';
  if (isEnterprise && ctx.procurementModuleEnabled !== false) return 'procurement';
  return ctx.hasErpConnector ? 'erp' : 'ecommerce';
}
