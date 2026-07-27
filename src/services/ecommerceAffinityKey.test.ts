import { describe, expect, it } from 'vitest';
import type { EcommerceRawLineItem } from './ecommerceRawOrders';
import { ecommerceLineAffinityKey, normalizeSku } from './ecommerceAffinityKey';

describe('normalizeSku', () => {
  it('trim, collapse inner spaces, uppercase', () => {
    expect(normalizeSku('  ab c  ')).toBe('ABC');
    expect(normalizeSku('sku-12')).toBe('SKU-12');
  });

  it('empty for nullish', () => {
    expect(normalizeSku(null)).toBe('');
    expect(normalizeSku(undefined)).toBe('');
  });
});

describe('ecommerceLineAffinityKey', () => {
  it('uses non-structural Magento product_type', () => {
    const item: EcommerceRawLineItem = { productType: 'Τζάκετ', sku: 'x' };
    expect(ecommerceLineAffinityKey(item)).toBe('Τζάκετ');
  });

  it('ignores configurable type and falls back to name/title/sku', () => {
    const item: EcommerceRawLineItem = {
      productType: 'configurable',
      name: 'Blue Jacket',
      sku: 'J-1',
    };
    expect(ecommerceLineAffinityKey(item)).toBe('Blue Jacket');
  });
});
