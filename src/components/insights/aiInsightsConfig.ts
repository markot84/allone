/** Maps generated insights to app sections (see `generateInsightsFromData` insightKey). */
export const INSIGHT_NAV: Record<string, { section: string; hashQuery?: string }> = {
  dead_stock: { section: 'channels', hashQuery: 'play=dead_stock' },
  excess_stock: { section: 'products', hashQuery: 'stock=excess' },
  high_margin_low_stock: { section: 'products', hashQuery: 'filter=high-margin-low-stock' },
  low_stock: { section: 'products', hashQuery: 'stock=low' },
  at_risk_segment: { section: 'channels', hashQuery: 'play=winback' },
  champions_segment: { section: 'channels', hashQuery: 'play=upsell' },
  top_segment: { section: 'channels', hashQuery: 'play=upsell' },
  cross_sell: { section: 'channels', hashQuery: 'play=cross_sell' },
  ecomm_low_aov: { section: 'ecommerce' },
  ecomm_platform_risk: { section: 'ecommerce' },
  // Ενοποιημένο strategy insight (αντικαθιστά champions/at_risk/top_segment όταν υπάρχει ενεργή στρατηγική)
  strategy_segments: { section: 'channels' },
};

export const APPLY_ALL_PRIORITY = [
  'dead_stock',
  'excess_stock',
  'high_margin_low_stock',
  'low_stock',
  'strategy_segments',
  'at_risk_segment',
  'champions_segment',
  'top_segment',
  'cross_sell',
  'ecomm_platform_risk',
  'ecomm_low_aov',
] as const;
