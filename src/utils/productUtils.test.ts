/** PER-300: stock is shelf units — the ERP's figure (available_stock) counts unreceived orders too. */
import { describe, it, expect } from 'vitest';
import { getEffectiveStockLevel } from './productUtils';
import type { Product } from '../types';

const p = (o: Partial<Product>) => o as Product;

describe('getEffectiveStockLevel', () => {
  it('ignores available_stock — 200 expected from a work order is not stock', () => {
    expect(getEffectiveStockLevel(p({ stock_on_hand: 0, available_stock: 200, stock_level: 200 }))).toBe(0);
  });

  it('uses the shelf count when the ERP reports part of it as committed', () => {
    expect(getEffectiveStockLevel(p({ stock_on_hand: 4, available_stock: 2, stock_level: 2 }))).toBe(4);
  });

  it('falls back to stock_level for sources without a shelf count', () => {
    expect(getEffectiveStockLevel(p({ stock_level: 7 }))).toBe(7);
    expect(getEffectiveStockLevel(p({}))).toBe(0);
  });
});
