/** parent_sku is stamped only from declared Magento relations (itemGroupId), never heuristics. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';
const { productFromRow, stampVariantCounts } = __test;

const row = (over: Record<string, unknown>) => ({ sku: 'A-1', name: 'A', price: 10, stock_level: 1, ...over });

describe('parent_sku stamping', () => {
  it('maps itemGroupId to parent_sku when it differs from the sku', () => {
    const p = productFromRow('d1', row({ sku: '00046-GR-M', itemGroupId: '00046-GR' }), 'connector_catalog');
    expect(p?.parent_sku).toBe('00046-GR');
  });

  it('omits parent_sku when itemGroupId is absent or equals the sku', () => {
    expect(productFromRow('d1', row({}), 'erp')?.parent_sku).toBeUndefined();
    expect(productFromRow('d1', row({ sku: '00046-GR', itemGroupId: '00046-GR' }), 'connector_catalog')?.parent_sku).toBeUndefined();
  });

  it('stampVariantCounts counts siblings per parent and skips unparented rows', () => {
    const ps = [
      { sku: 'X-1', parent_sku: 'X' },
      { sku: 'X-2', parent_sku: 'X' },
      { sku: 'Y-1' },
    ] as Parameters<typeof stampVariantCounts>[0];
    expect(stampVariantCounts(ps)).toBe(2);
    expect(ps[0].variant_count).toBe(2);
    expect(ps[1].variant_count).toBe(2);
    expect(ps[2].variant_count).toBeUndefined();
  });
});
