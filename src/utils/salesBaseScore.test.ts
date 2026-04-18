import { describe, expect, it } from 'vitest';
import type { Product } from '../types';
import { productMatchesSalesBasePreset } from './salesBaseScore';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1',
    name: 'Product 1',
    sku: 'SKU-1',
    category: 'Category',
    margin_tier: 'low',
    margin_percentage: 10,
    stock_level: 5,
    stock_capacity: 5,
    stock_age_days: 10,
    price: 10,
    ...overrides,
  };
}

describe('productMatchesSalesBasePreset', () => {
  it('θεωρεί 30d=0 ως zero_last_7d όταν λείπει 7d πεδίο', () => {
    const product = makeProduct({ qty_sold_period: 0 });
    expect(productMatchesSalesBasePreset(product, 'zero_last_7d')).toBe(true);
  });

  it('θεωρεί 90d=0 ως zero_last_30d όταν λείπει 30d πεδίο', () => {
    const product = makeProduct({ qty_sold_last_90d: 0 });
    expect(productMatchesSalesBasePreset(product, 'zero_last_30d')).toBe(true);
  });

  it('δεν θεωρεί 30d=0 ως zero_last_90d χωρίς 90d ή παλιό last_sale_at', () => {
    const product = makeProduct({ qty_sold_period: 0 });
    expect(productMatchesSalesBasePreset(product, 'zero_last_90d')).toBe(false);
  });

  it('αναγνωρίζει stalled πρόσφατα από 30d=0 όταν υπάρχει ιστορικό sales', () => {
    const product = makeProduct({
      qty_sold_period: 0,
      qty_sold_lifetime: 12,
    });
    expect(productMatchesSalesBasePreset(product, 'stalled_7_vs_90')).toBe(true);
  });

  it('κρατά fallback από last_sale_at όταν λείπουν όλα τα window πεδία', () => {
    const product = makeProduct({ last_sale_at: '2026-03-01' });
    expect(productMatchesSalesBasePreset(product, 'zero_last_7d')).toBe(true);
    expect(productMatchesSalesBasePreset(product, 'zero_last_30d')).toBe(true);
  });
});
