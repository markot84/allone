/** Maps generated insights to app sections (see `generateInsightsFromData` insightKey). */
export const INSIGHT_NAV: Record<string, { section: string; hashQuery?: string }> = {
  dead_stock: { section: 'products', hashQuery: 'stock=dead' },
  excess_stock: { section: 'products', hashQuery: 'stock=excess' },
  high_margin_low_stock: { section: 'products', hashQuery: 'filter=high-margin-low-stock' },
  low_stock: { section: 'products', hashQuery: 'stock=low' },
  at_risk_segment: { section: 'rfm' },
  champions_segment: { section: 'campaigns' },
  top_segment: { section: 'rfm' },
  cross_sell: { section: 'channels' },
  ecomm_low_aov: { section: 'ecommerce' },
  ecomm_platform_risk: { section: 'ecommerce' },
};

export const APPLY_ALL_PRIORITY = [
  'dead_stock',
  'excess_stock',
  'high_margin_low_stock',
  'low_stock',
  'at_risk_segment',
  'champions_segment',
  'top_segment',
  'cross_sell',
  'ecomm_platform_risk',
  'ecomm_low_aov',
] as const;
