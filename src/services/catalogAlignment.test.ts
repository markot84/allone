import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import type { EcommerceRawLineItem } from './ecommerceRawOrders';
import {
  buildErpSkuMap,
  mergePlatformProductDocs,
  resolveCatalogLineForOrderLine,
  type CatalogIndexes,
} from './catalogAlignment';

function makeProduct(overrides: Partial<Product> = {}): Product {
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

describe('buildErpSkuMap', () => {
  it('keys by normalized sku', () => {
    const m = buildErpSkuMap([makeProduct({ sku: ' ab-1 ', brand: 'B', category: 'C', subcategory: 'S' })]);
    expect(m.get('AB-1')).toEqual({ brand: 'B', category: 'C', subcategory: 'S' });
  });
});

describe('resolveCatalogLineForOrderLine', () => {
  const emptyIndexes: CatalogIndexes = { byProductId: new Map(), bySku: new Map() };

  it('prefers ERP overlay when line SKU matches unified products', () => {
    const indexes: CatalogIndexes = { byProductId: new Map(), bySku: new Map() };
    mergePlatformProductDocs(
      'shopify',
      [
        {
          productId: 'gid://shopify/Product/99',
          vendor: 'ShopVendor',
          productType: 'Shirts',
          variants: [{ sku: 'ZZ-9' }],
        },
      ],
      indexes,
    );
    const erpBySku = buildErpSkuMap([
      makeProduct({ sku: 'ZZ-9', brand: 'ErpBrand', category: 'ErpCat', subcategory: 'ErpSub' }),
    ]);
    const item: EcommerceRawLineItem = {
      sku: 'zz-9',
      productId: 'gid://shopify/Product/99',
      title: 'Fallback Title',
    };
    const r = resolveCatalogLineForOrderLine('shopify', item, indexes, erpBySku);
    expect(r.match_source).toBe('erp_product');
    expect(r.brandLabel).toBe('ErpBrand');
    expect(r.categoryLabel).toBe('ErpCat');
    expect(r.subcategoryLabel).toBe('ErpSub');
    expect(r.skuLabel).toContain('ZZ');
  });

  it('uses platform catalog by productId when ERP misses', () => {
    const indexes: CatalogIndexes = { byProductId: new Map(), bySku: new Map() };
    mergePlatformProductDocs(
      'shopify',
      [
        {
          productId: '100',
          vendor: 'Acme',
          productType: 'Footwear',
          variants: [],
        },
      ],
      indexes,
    );
    const erpBySku = buildErpSkuMap([]);
    const item: EcommerceRawLineItem = { productId: '100', sku: 'unknown-sku' };
    const r = resolveCatalogLineForOrderLine('shopify', item, indexes, erpBySku);
    expect(r.match_source).toBe('platform_catalog');
    expect(r.brandLabel).toBe('Acme');
    expect(r.categoryLabel).toBe('Footwear');
  });

  it('uses Woo categories for catalog dims', () => {
    const indexes: CatalogIndexes = { byProductId: new Map(), bySku: new Map() };
    mergePlatformProductDocs(
      'woocommerce',
      [
        {
          productId: '55',
          sku: 'W1',
          categories: ['Outerwear', 'Coats'],
          tags: ['Nike'],
        },
      ],
      indexes,
    );
    const item: EcommerceRawLineItem = { productId: '55', sku: 'W1' };
    const r = resolveCatalogLineForOrderLine('woocommerce', item, indexes, buildErpSkuMap([]));
    expect(r.match_source).toBe('platform_catalog');
    expect(r.brandLabel).toBe('Nike');
    expect(r.categoryLabel).toBe('Outerwear');
    expect(r.subcategoryLabel).toBe('Coats');
  });

  it('falls back to heuristic category when no catalog hit', () => {
    const item: EcommerceRawLineItem = {
      sku: 'solo',
      productType: 'simple',
      name: 'Demo Simple',
    };
    const r = resolveCatalogLineForOrderLine('magento', item, emptyIndexes, buildErpSkuMap([]));
    expect(r.match_source).toBe('line_fallback');
    expect(r.categoryLabel).toBe('Demo Simple');
    expect(r.brandLabel).toBe('Λοιπά');
  });
});
