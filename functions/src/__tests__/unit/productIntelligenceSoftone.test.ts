/** SoftOne items reach Product Intelligence via the normalized sku/name/stock_level fields the
 * connector writes onto softone_items; productFromRow maps them like any ERP catalog row. */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { productFromRow } = __test;

const softoneRow = {
  'ITEM.CODE': '0-1-5-3-3-094',
  'ITEM.NAME': 'LDPE ΣΥΣΚ/ΣΙΑ ΦΑΚΕΛΟΣ Α/Τ 25Χ35',
  'ITEM.MTRL_ITEMTRDATA_QTY1': '51.50',
  stockQty: 51.5,
  stock_level: 51.5,
  sku: '0-1-5-3-3-094',
  name: 'LDPE ΣΥΣΚ/ΣΙΑ ΦΑΚΕΛΟΣ Α/Τ 25Χ35',
  price: 149,
  brandId: 'safeblock',
  source: 'softone_api',
};

describe('productFromRow — SoftOne items', () => {
  it('maps a normalized softone_items row (sku/name/stock_level)', () => {
    const p = productFromRow('s1_i_0-1-5-3-3-094', softoneRow, 'erp');
    expect(p).not.toBeNull();
    expect(p?.sku).toBe('0-1-5-3-3-094');
    expect(p?.name).toBe('LDPE ΣΥΣΚ/ΣΙΑ ΦΑΚΕΛΟΣ Α/Τ 25Χ35');
    expect(p?.stock_level).toBe(51.5);
    expect(p?.price).toBe(149); // inventory value = stock × price → no longer €0
    expect(p?.source).toBe('erp');
    expect(p?.priority_tag).toBeTruthy();
  });

  it('keeps a zero-stock item (blank balance → 0), classified by stock presence', () => {
    const p = productFromRow('s1_i_x', { ...softoneRow, sku: 'X', name: 'Zero item', stockQty: 0, stock_level: 0 }, 'erp');
    expect(p).not.toBeNull();
    expect(p?.stock_level).toBe(0);
  });

  it('a raw softone row WITHOUT the normalized sku is dropped (why the connector writes sku/name)', () => {
    const p = productFromRow(
      's1_i_raw',
      { 'ITEM.CODE': 'C', 'ITEM.NAME': 'N', 'ITEM.MTRL_ITEMTRDATA_QTY1': '5' },
      'erp',
    );
    expect(p).toBeNull();
  });
});
