/**
 * Feed Source types and column mappings for dynamic import.
 * ERP: generic CSV/XLSX with flexible column names.
 * Google Ads / Merchant: id, title, price, link, image_link, etc.
 * Meta Catalog: similar to Google.
 */

import type { FeedSourceType } from '../types';
export type { FeedSourceType };

export interface FeedSourceInfo {
  id: FeedSourceType;
  name: string;
  description: string;
  icon: string;
  /** Feed column names (as they typically appear) → our Product field */
  columnAliases: { feedColumn: string; appField: string; required?: boolean }[];
}

/** Column aliases for each feed type. pick() in import service will use these. */
export const FEED_SOURCE_CONFIG: Record<FeedSourceType, FeedSourceInfo> = {
  erp: {
    id: 'erp',
    name: 'ERP Export',
    description: 'CSV/Excel από ERP (SAP, NetSuite, Oracle κλπ). Αυτόματη αντιστοίχιση με εναλλακτικά ονόματα στηλών.',
    icon: '📊',
    columnAliases: [
      { feedColumn: 'SKU_ID', appField: 'sku', required: true },
      { feedColumn: 'Product_Name', appField: 'name', required: true },
      { feedColumn: 'Category', appField: 'category' },
      { feedColumn: 'Sell_Price', appField: 'price', required: true },
      { feedColumn: 'Cost_Price', appField: 'cost_price' },
      { feedColumn: 'Stock_On_Hand', appField: 'stock_level' },
      { feedColumn: 'Stock_Age_Days', appField: 'stock_age_days' },
      { feedColumn: 'Gross_Margin_%', appField: 'margin_percentage' },
      { feedColumn: 'Qty_Sold_Period', appField: 'qty_sold_period' },
      { feedColumn: 'Revenue_Period', appField: 'revenue_period' },
      { feedColumn: 'First_Available_Date', appField: 'first_available_date' },
      { feedColumn: 'Priority_Flag', appField: 'priority_tag' },
      { feedColumn: 'Margin_Tier', appField: 'margin_tier' },
    ],
  },
  google_ads: {
    id: 'google_ads',
    name: 'Google Ads / Merchant Center',
    description: 'Product feed από Google Merchant Center ή Google Ads. id, title, price, link, image_link.',
    icon: '🛒',
    columnAliases: [
      { feedColumn: 'id', appField: 'sku', required: true },
      { feedColumn: 'title', appField: 'name', required: true },
      { feedColumn: 'description', appField: 'category' },
      { feedColumn: 'price', appField: 'price', required: true },
      { feedColumn: 'availability', appField: 'stock_level' },
      { feedColumn: 'google_product_category', appField: 'category' },
    ],
  },
  meta_catalog: {
    id: 'meta_catalog',
    name: 'Meta Catalog',
    description: 'Product catalog από Meta (Facebook/Instagram). id, name, price, availability, url.',
    icon: '📱',
    columnAliases: [
      { feedColumn: 'id', appField: 'sku', required: true },
      { feedColumn: 'name', appField: 'name', required: true },
      { feedColumn: 'title', appField: 'name', required: true },
      { feedColumn: 'description', appField: 'category' },
      { feedColumn: 'price', appField: 'price', required: true },
      { feedColumn: 'availability', appField: 'stock_level' },
    ],
  },
};

/** All feed source types for UI */
export const FEED_SOURCE_OPTIONS: FeedSourceInfo[] = Object.values(FEED_SOURCE_CONFIG);
