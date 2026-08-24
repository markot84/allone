import type { AutomationAlert } from '../types';

/** App section to navigate to from an alert */
export interface AlertNavTarget {
  section: string;
  /** Query string without `?`, e.g. `stock=low` for `#products?stock=low` */
  hashQuery?: string;
}

const TRIGGER_SECTION: Record<string, string> = {
  inventory: 'products',
  customers: 'rfm',
  campaigns: 'campaigns',
  seasonal: 'calendar',
  data: 'data',
  analytics: 'analytics',
  competitive: 'competitive',
  procurement: 'procurement',
};

/** Navigation from an automation alert — opens the right section, passing any
 * filter (e.g. stock) in the hash. */
export function getAlertNavigation(alert: AutomationAlert): AlertNavTarget {
  const id = alert.triggerId;
  const group = alert.triggerGroup || '';

  if (id === 'low_stock_critical') {
    return { section: 'products', hashQuery: 'stock=low' };
  }
  if (id === 'dead_stock_alert') {
    return { section: 'products', hashQuery: 'stock=dead' };
  }
  if (id === 'excess_stock_alert') {
    return { section: 'products', hashQuery: 'stock=excess' };
  }
  if (id === 'campaign_underperform' || id === 'campaign_high_roas') {
    return { section: 'campaigns' };
  }
  if (id === 'segment_churn_risk' || id === 'segment_vip_growth' || id === 'high_churn_ltv' || id === 'engagement_drop' || id === 'demand_declining') {
    return { section: 'rfm' };
  }
  if (id === 'price_above_benchmark' || id === 'competitor_new_ads') {
    return { section: 'competitive' };
  }
  if (id.startsWith('organic_') || id.startsWith('new_visitors') || id === 'high_bounce_pages') {
    return { section: 'analytics' };
  }
  if (id.startsWith('procurement_') || id === 'procurement_supplier_delay') {
    return { section: id === 'procurement_supplier_delay' ? 'suppliers' : 'procurement' };
  }
  if (id === 'seasonal_approaching') {
    return { section: 'calendar' };
  }
  if (id === 'upsell_opportunity') {
    return { section: 'channels' };
  }
  if (id === 'new_products_imported' || id === 'stock_growth') {
    return { section: 'products' };
  }
  if (id === 'new_visitors_surge') {
    return { section: 'analytics' };
  }

  const fromGroup = TRIGGER_SECTION[group];
  if (fromGroup) {
    return { section: fromGroup };
  }

  return { section: 'automation' };
}
