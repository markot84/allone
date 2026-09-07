import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import {
  groupProductsForDecisionExport,
  isActionableStockProduct,
} from './actionableProducts';

function product(overrides: Partial<Product>): Product {
  return {
    id: overrides.id ?? overrides.sku ?? 'p',
    name: overrides.name ?? overrides.sku ?? 'Product',
    sku: overrides.sku ?? 'SKU',
    category: overrides.category ?? 'Category',
    margin_tier: overrides.margin_tier ?? 'medium',
    margin_percentage: overrides.margin_percentage ?? 20,
    stock_level: overrides.stock_level ?? 1,
    stock_capacity: overrides.stock_capacity ?? 2,
    priority_tag: overrides.priority_tag ?? 'dead',
    price: overrides.price ?? 10,
    ...overrides,
  };
}

describe('actionableProducts', () => {
  it('excludes zero-stock and inactive products by default', () => {
    expect(isActionableStockProduct(product({ stock_level: 0 }))).toBe(false);
    expect(isActionableStockProduct(product({ stock_level: 3, procurement_status: 'ΑΝΕΝΕΡΓΟ' }))).toBe(false);
    expect(isActionableStockProduct(product({ stock_level: 3, procurement_status: 'ACTIVE' }))).toBe(true);
  });

  it('groups variants by Magento itemGroupId before SKU fallback', () => {
    const rows = groupProductsForDecisionExport(
      [
        product({ id: 'a', sku: 'VAR-42', stock_level: 2, price: 50 }),
        product({ id: 'b', sku: 'VAR-43', stock_level: 3, price: 60 }),
        product({ id: 'c', sku: 'OLD-44', stock_level: 0, price: 70 }),
      ],
      (sku) => sku.startsWith('VAR-') ? {
        sku,
        productId: '',
        imageLink: '',
        link: '',
        description: '',
        shortDescription: '',
        gtin: '',
        mpn: '',
        color: '',
        size: '',
        manufacturer: '',
        itemGroupId: 'PARENT-1',
        categoryIds: [],
        type: 'simple',
        visibility: 4,
      } : null
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('PARENT-1');
    expect(rows[0].variantCount).toBe(2);
    expect(rows[0].totalStock).toBe(5);
  });
});


describe('parent/model grouping without Magento', () => {
  it('groups variants by the parent_sku the PI rows carry, with no enrichment lookup', () => {
    const rows = groupProductsForDecisionExport([
      product({ sku: 'SHORT-01-S', stock_level: 2, price: 20, parent_sku: 'SHORT-01' } as Partial<Product>),
      product({ sku: 'SHORT-01-L', stock_level: 3, price: 24, parent_sku: 'SHORT-01' } as Partial<Product>),
      product({ sku: 'CAP-9', stock_level: 4, price: 10 }),
    ]);
    expect(rows).toHaveLength(2);
    const parent = rows.find((r) => r.key === 'SHORT-01');
    expect(parent?.variantCount).toBe(2);
    expect(parent?.totalStock).toBe(5);
    expect(parent?.skus.sort()).toEqual(['SHORT-01-L', 'SHORT-01-S']);
    expect(rows.find((r) => r.key === 'CAP-9')?.variantCount).toBe(1);
  });

  it('still prefers a Magento itemGroupId when one is supplied', () => {
    const rows = groupProductsForDecisionExport(
      [
        product({ sku: 'A-1', stock_level: 1, parent_sku: 'ERP-PARENT' } as Partial<Product>),
        product({ sku: 'A-2', stock_level: 1, parent_sku: 'ERP-PARENT' } as Partial<Product>),
      ],
      () => ({ itemGroupId: 'MAGENTO-PARENT' } as never)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe('MAGENTO-PARENT');
  });
});

describe('pre-aggregated PI grouped rows', () => {
  it('carries the server group aggregates instead of re-deriving them', () => {
    const grouped = product({
      sku: 'SHORT-01',
      stock_level: 14,
      price: 20,
      parent_sku: 'SHORT-01',
      variant_count: 6,
      stock_value: 311.5,
      price_min: 18,
      price_max: 26,
    } as Partial<Product>);
    const [row] = groupProductsForDecisionExport([grouped], undefined, { preAggregated: true });
    expect(row.variantCount).toBe(6);
    expect(row.totalValue).toBe(311.5);
    expect(row.minPrice).toBe(18);
    expect(row.maxPrice).toBe(26);
    expect(row.totalStock).toBe(14);
  });

  it('ignores the denormalized variant_count on variant-level rows', () => {
    // Ungrouped PI rows carry their parent's size; without the flag it must not become the
    // group's size — two dead variants of a 6-variant parent are two variants, not six.
    const rows = groupProductsForDecisionExport([
      product({ sku: 'A-S', stock_level: 1, parent_sku: 'A', variant_count: 6 } as Partial<Product>),
      product({ sku: 'A-L', stock_level: 2, parent_sku: 'A', variant_count: 6 } as Partial<Product>),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].variantCount).toBe(2);
    expect(rows[0].totalStock).toBe(3);
  });
});
