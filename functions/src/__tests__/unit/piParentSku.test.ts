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

describe('collapseByParentSku', () => {
  const { collapseByParentSku } = __test;
  const v = (sku: string, parent: string | undefined, stock: number, qty?: number) =>
    ({ id: sku, sku, name: sku, category: 'c', margin_tier: 'high', margin_percentage: 30,
       stock_level: stock, stock_capacity: stock * 2, priority_tag: 'healthy', price: 10,
       ...(parent ? { parent_sku: parent } : {}), ...(qty != null ? { qty_sold_period: qty } : {}) });

  it('collapses siblings into one parent row with summed quantities and top-stock representative', () => {
    const out = collapseByParentSku([v('X-1', 'X', 5, 2), v('X-2', 'X', 9, 3), v('Y-1', undefined, 1)]);
    expect(out).toHaveLength(2);
    const parent = out.find((r: { sku: string }) => r.sku === 'X');
    expect(parent.stock_level).toBe(14);
    expect(parent.qty_sold_period).toBe(5);
    expect(parent.variant_count).toBe(2);
    expect(parent.name).toBe('X-2'); // highest-stock representative
    expect(out.find((r: { sku: string }) => r.sku === 'Y-1')).toBeTruthy();
  });

  // PER-187: a 14-pc parent was flagged "low" because the representative size held 2.
  it('re-buckets the parent from summed stock, not from the representative variant', () => {
    const low = { ...v('X-1', 'X', 2, 4), priority_tag: 'low' };
    const out = collapseByParentSku([low, { ...v('X-2', 'X', 12, 0), priority_tag: 'healthy' }]);
    expect(out[0].stock_level).toBe(14);
    expect(out[0].priority_tag).toBe('healthy'); // 14 pcs / 4 per 30d ≈ 105 days of cover
  });
});
