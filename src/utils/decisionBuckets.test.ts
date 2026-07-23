/** Zero-stock SKUs must not land in actionable commercial buckets (discontinue,
 * margin_bleeder) — strategy scopes are in-stock-only by decision. */
import { describe, it, expect } from 'vitest';
import { classifyAll } from './decisionBuckets';
import type { Product } from '../types';

const product = (over: Partial<Product>): Product =>
  ({ id: 'p1', sku: 'SKU-1', name: 'Test', category: 'cat', price: 100, ...over }) as Product;

const signal = (resolved: Record<string, unknown>, hasWindowSource = true) =>
  ({ resolved, hasWindowSource, hasProcurement: false }) as never;

describe('classifyAll stock gates', () => {
  it('discontinue status with stock stays; without stock does not', () => {
    const withStock = classifyAll([product({ procurement_status: 'Προς κατάργηση', stock_level: 5 })], () => undefined);
    expect(withStock.counts.discontinue).toBe(1);
    const noStock = classifyAll([product({ procurement_status: 'Προς κατάργηση', stock_level: 0 })], () => undefined);
    expect(noStock.counts.discontinue).toBe(0);
  });

  it('margin bleeder requires stock on hand', () => {
    const sig = signal({ stock: 0, qty30d: 12, margin_pct: 2 });
    const noStock = classifyAll([product({ stock_level: 0 })], () => sig);
    expect(noStock.counts.margin_bleeder).toBe(0);
    const sigStock = signal({ stock: 4, qty30d: 12, margin_pct: 2 });
    const withStock = classifyAll([product({ stock_level: 4 })], () => sigStock);
    expect(withStock.counts.margin_bleeder).toBe(1);
  });
});
