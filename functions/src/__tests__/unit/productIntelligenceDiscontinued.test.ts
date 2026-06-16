/**
 * PER-60/PER-130 (8.1a) — productFromRow must drop ERP-discontinued products from Product
 * Intelligence, gating on BOTH markers: `discontinued_at` (products tombstones / patched normalized
 * docs) AND `mvDeletedAt` (raw megaventory_products rows, which enter bySku FIRST — a
 * discontinued_at-only skip would leave ~all tombstones in). Live rows still map.
 */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { productFromRow } = __test;

describe('productFromRow discontinued skip (8.1a)', () => {
  it('drops a tombstone carrying discontinued_at (products / mv_api_cat_*)', () => {
    expect(productFromRow('mv_api_cat_1', { sku: 'X1', discontinued_at: '2026-06-10T00:00:00.000Z' }, 'connector_catalog')).toBeNull();
  });

  it('drops a raw megaventory_products row carrying mvDeletedAt (enters bySku first)', () => {
    expect(productFromRow('mv_p_2', { sku: 'X2', mvDeletedAt: '2026-06-10T00:00:00.000Z' }, 'erp')).toBeNull();
  });

  it('keeps a live product (neither marker)', () => {
    const p = productFromRow('mv_p_3', { sku: 'X3', stock_level: 5, price: 10 }, 'erp');
    expect(p).not.toBeNull();
    expect(p?.sku).toBe('X3');
  });
});
