/** PER-108 / LOGIC-3: OpenCart historical orders imported with empty line items and zero tax,
 * because per-order detail enrichment was gated off for historical mode. These tests pin the fix:
 * historical orders are now enriched too, bounded per run by an enrichment budget at low
 * concurrency (the page cursor resumes the rest), and a single order resolves its line items/tax
 * from the detail call when the list row carries none. */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { opencartEnrichPlan, enrichOcOrder } from '../../opencartConnector';

describe('opencartEnrichPlan', () => {
  it('enriches historical orders too, bounded with low concurrency (the fix)', () => {
    expect(opencartEnrichPlan('historical')).toEqual({ enrich: true, budget: 400, concurrency: 2 });
  });

  it('enriches incremental orders unbounded at normal concurrency', () => {
    expect(opencartEnrichPlan('incremental')).toEqual({ enrich: true, budget: Infinity, concurrency: 4 });
  });
});

describe('enrichOcOrder', () => {
  const detail = { lineItems: [{ sku: 'SKU7', quantity: 2, price: 10 }], tax: 3.5 };
  const fetchDetail = vi.fn(async () => detail);

  beforeEach(() => fetchDetail.mockClear());

  it('fetches per-order detail when the list row has no line items (the historical case)', async () => {
    const r = await enrichOcOrder({ order_id: '42', products: [] }, true, fetchDetail);
    expect(fetchDetail).toHaveBeenCalledWith('42');
    expect(r.lineItems).toEqual(detail.lineItems);
    expect(r.tax).toBe(3.5);
    expect(r.didFetch).toBe(true);
  });

  it('does NOT fetch when the list row already carries line items', async () => {
    const row = { order_id: '43', products: [{ product_id: '1', model: 'M1', name: 'X', quantity: '1', price: '5' }] };
    const r = await enrichOcOrder(row, true, fetchDetail);
    expect(fetchDetail).not.toHaveBeenCalled();
    expect(r.lineItems.length).toBe(1);
    expect(r.didFetch).toBe(false);
  });

  it('reproduces the old bug when enrichment is disabled: empty line items / zero tax', async () => {
    const r = await enrichOcOrder({ order_id: '44', products: [] }, false, fetchDetail);
    expect(fetchDetail).not.toHaveBeenCalled();
    expect(r.lineItems).toEqual([]);
    expect(r.tax).toBe(0);
    expect(r.didFetch).toBe(false);
  });

  it('keeps a tax already present on the list row over the detail tax, still taking detail line items', async () => {
    const r = await enrichOcOrder({ order_id: '45', products: [], total_tax: '9' }, true, fetchDetail);
    expect(fetchDetail).toHaveBeenCalledWith('45');
    expect(r.lineItems).toEqual(detail.lineItems);
    expect(r.tax).toBe(9);
    expect(r.didFetch).toBe(true);
  });

  it('does not spend a detail fetch when the order has no id', async () => {
    const r = await enrichOcOrder({ products: [] }, true, fetchDetail);
    expect(fetchDetail).not.toHaveBeenCalled();
    expect(r.didFetch).toBe(false);
    expect(r.lineItems).toEqual([]);
  });
});
