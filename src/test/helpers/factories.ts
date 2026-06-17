/** Shared test data factories: minimal-but-valid objects with deterministic
 *  defaults, plus `Partial<T>` overrides so a test states only what it asserts. */
import type { Brand, Campaign, Product } from '../../types';
import type { EcommerceRawLineItem } from '../../services/ecommerceRawOrders';

/** A catalog product with all REQUIRED `Product` fields populated. */
export function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Product 1',
    sku: 'SKU-1',
    category: 'Cat',
    margin_tier: 'low',
    margin_percentage: 10,
    stock_level: 5,
    stock_capacity: 5,
    stock_age_days: 10,
    price: 10,
    ...overrides,
  };
}

/** A marketing campaign with the REQUIRED `Campaign` fields (id/name/channel). */
export function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c1',
    name: 'Campaign 1',
    channel: 'Google Ads',
    ...overrides,
  };
}

type CampaignDailyMetric = NonNullable<Campaign['dailyMetrics']>[string];

/** One `dailyMetrics[date]` entry; defaults to zeros so a test sets only the
 *  fields under assertion (e.g. just `purchase_conversion_value`). */
export function makeCampaignDaily(
  overrides: Partial<CampaignDailyMetric> = {},
): CampaignDailyMetric {
  return {
    impressions: 0,
    clicks: 0,
    conversions: 0,
    amount_spent: 0,
    conversion_value: 0,
    ...overrides,
  };
}

/** A tenant brand with the REQUIRED `Brand` fields populated. */
export function makeBrand(overrides: Partial<Brand> = {}): Brand {
  return {
    id: 'brand1',
    name: 'Brand One',
    type: 'B2C',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'uid-creator',
    ...overrides,
  };
}

/** A raw e-commerce order line (all fields optional on the type). */
export function makeOrderLine(
  overrides: Partial<EcommerceRawLineItem> = {},
): EcommerceRawLineItem {
  return {
    sku: 'SKU-1',
    productId: 'prod-1',
    title: 'Line Item 1',
    quantity: 1,
    price: 10,
    ...overrides,
  };
}
