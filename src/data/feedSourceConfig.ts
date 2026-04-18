/**
 * Feed Source types and column mappings for dynamic import.
 * ERP: generic CSV/XLSX with flexible column names.
 * Google Ads / Merchant: id, title, price, link, image_link, etc.
 * Meta Catalog: similar to Google.
 */

import { createElement } from 'react';
import { Database, ShoppingCart, Smartphone, Store as LucideStoreIcon } from 'lucide-react';
import type { FeedSourceType } from '../types';
export type { FeedSourceType };

export interface FeedSourceInfo {
  id: FeedSourceType;
  name: string;
  description: string;
  icon: React.ReactNode;
  /** Feed column names (as they typically appear) → our Product field */
  columnAliases: { feedColumn: string; appField: string; required?: boolean }[];
}

/** Column aliases for each feed type. pick() in import service will use these. */
export const FEED_SOURCE_CONFIG: Record<FeedSourceType, FeedSourceInfo> = {
  erp: {
    id: 'erp',
    name: 'ERP Export',
    description: 'CSV/Excel από ERP (SAP, NetSuite, Oracle κλπ). Αυτόματη αντιστοίχιση με εναλλακτικά ονόματα στηλών.',
    icon: createElement(Database, { size: 20 }),
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
      { feedColumn: 'Qty_Sold_Last_7d', appField: 'qty_sold_last_7d' },
      { feedColumn: 'Qty_Sold_Last_30d', appField: 'qty_sold_last_30d' },
      { feedColumn: 'Qty_Sold_Last_90d', appField: 'qty_sold_last_90d' },
      { feedColumn: 'Qty_Sold_Lifetime', appField: 'qty_sold_lifetime' },
      { feedColumn: 'Last_Sale_At', appField: 'last_sale_at' },
      { feedColumn: 'Revenue_Period', appField: 'revenue_period' },
      { feedColumn: 'First_Available_Date', appField: 'first_available_date' },
      { feedColumn: 'Priority_Flag', appField: 'priority_tag' },
      { feedColumn: 'Margin_Tier', appField: 'margin_tier' },
    ],
  },
  google_ads: {
    id: 'google_ads',
    name: 'Google Ads / Merchant Center',
    description: 'Product feed από Google Merchant Center (XML) ή CSV. id, title, price, product_type, availability, link, image_link.',
    icon: createElement(ShoppingCart, { size: 20 }),
    columnAliases: [
      { feedColumn: 'id', appField: 'sku', required: true },
      { feedColumn: 'item_group_id', appField: 'item_group_id' },
      { feedColumn: 'title', appField: 'name', required: true },
      { feedColumn: 'price', appField: 'price', required: true },
      { feedColumn: 'sale_price', appField: 'sale_price' },
      { feedColumn: 'description', appField: 'description' },
      { feedColumn: 'product_type', appField: 'category' },
      { feedColumn: 'google_product_category', appField: 'category' },
      { feedColumn: 'availability', appField: 'stock_level' },
      { feedColumn: 'brand', appField: 'brand' },
      { feedColumn: 'image_link', appField: 'image_url' },
      { feedColumn: 'link', appField: 'product_url' },
      { feedColumn: 'size', appField: 'size' },
      { feedColumn: 'size_type', appField: 'size_type' },
      { feedColumn: 'size_system', appField: 'size_system' },
      { feedColumn: 'material', appField: 'material' },
      { feedColumn: 'custom_label_0', appField: 'priority_tag' },
      { feedColumn: 'condition', appField: 'condition' },
      { feedColumn: 'gender', appField: 'gender' },
    ],
  },
  meta_catalog: {
    id: 'meta_catalog',
    name: 'Meta Catalog',
    description: 'Product catalog από Meta (Facebook/Instagram). id, name, price, availability, url.',
    icon: createElement(Smartphone, { size: 20 }),
    columnAliases: [
      { feedColumn: 'id', appField: 'sku', required: true },
      { feedColumn: 'name', appField: 'name', required: true },
      { feedColumn: 'title', appField: 'name', required: true },
      { feedColumn: 'description', appField: 'category' },
      { feedColumn: 'price', appField: 'price', required: true },
      { feedColumn: 'availability', appField: 'stock_level' },
    ],
  },
  skroutz: {
    id: 'skroutz',
    name: 'Skroutz (XML)',
    description:
      'Επίσημο XML καταλόγου Skroutz — unique_id, name, price (με ΦΠΑ), link, image, category, manufacturer. Το URL δίνεται από το merchant panel του Skroutz.',
    icon: createElement(LucideStoreIcon, { size: 20, className: 'text-orange-600' }),
    columnAliases: [
      { feedColumn: 'unique_id', appField: 'sku', required: true },
      { feedColumn: 'id', appField: 'sku' },
      { feedColumn: 'name', appField: 'name', required: true },
      { feedColumn: 'title', appField: 'name' },
      { feedColumn: 'price', appField: 'price', required: true },
      { feedColumn: 'link', appField: 'product_url' },
      { feedColumn: 'url', appField: 'product_url' },
      { feedColumn: 'image', appField: 'image_url' },
      { feedColumn: 'imageurl', appField: 'image_url' },
      { feedColumn: 'category', appField: 'category' },
      { feedColumn: 'manufacturer', appField: 'brand' },
      { feedColumn: 'brand', appField: 'brand' },
      { feedColumn: 'availability', appField: 'stock_level' },
      { feedColumn: 'description', appField: 'description' },
      { feedColumn: 'ean', appField: 'sku' },
    ],
  },
};

/** All feed source types for UI */
export const FEED_SOURCE_OPTIONS: FeedSourceInfo[] = Object.values(FEED_SOURCE_CONFIG);

/** CSV template headers for Google Ads manual import (matches XML feed columns) */
export const GOOGLE_ADS_CSV_HEADERS = [
  'id', 'item_group_id', 'title', 'price', 'sale_price', 'description',
  'product_type', 'google_product_category', 'availability', 'brand',
  'image_link', 'link', 'size', 'size_type', 'size_system', 'material',
  'custom_label_0', 'condition', 'gender',
] as const;

/** Download Google Ads CSV template */
export function downloadGoogleAdsCsvTemplate(): void {
  const headers = [...GOOGLE_ADS_CSV_HEADERS];
  const exampleRow = [
    'SKU-001', 'SKU-001', 'Product Name', '24 EUR', '24 EUR', 'Description',
    'Category > Subcategory', '', 'in stock', 'Brand',
    'https://example.com/image.jpg', 'https://example.com/product', 'M', 'regular', 'EU',
    '', '', 'new', '',
  ];
  const csv = [headers.join(','), exampleRow.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'google_ads_feed_template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
