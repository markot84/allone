/** productFromRow drops ERP-discontinued products, gating on BOTH `discontinued_at`
 * (tombstones) AND `mvDeletedAt` (raw megaventory_products rows). Live rows still map. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { productFromRow } = __test;

describe('productFromRow discontinued skip', () => {
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
