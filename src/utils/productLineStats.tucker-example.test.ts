/**
 * Reproduces the user-reported TUCKER case: app showed 34 units vs 18 actual
 * (after counting configurable parent + simple child as two lines, plus simple-only orders).
 */
import { describe, expect, it } from 'vitest';
import { lineRevenueAndQtyForTopProducts, type ProductLineItemLike } from './productLineStats';

const PLATFORM = 'magento' as const;
const SKU = 'TUCKER';
const UNIT = 151;

function configurableParentline(_orderTag: string): ProductLineItemLike {
  return {
    sku: `${SKU}-CONFIG`,
    productType: 'configurable',
    parentItemId: null,
    quantity: 1,
    price: UNIT,
    rowTotal: UNIT, // some APIs return row_total on both; we still must skip parent
  };
}

function simpleChildline(_orderTag: string): ProductLineItemLike {
  return {
    sku: SKU,
    productType: 'simple',
    parentItemId: 100,
    quantity: 1,
    price: UNIT,
    rowTotal: UNIT,
  };
}

function simpleOnlyLine(): ProductLineItemLike {
  return {
    sku: SKU,
    productType: 'simple',
    parentItemId: null,
    quantity: 1,
    price: UNIT,
    rowTotal: UNIT,
  };
}

function naiveSumAllLines(lines: ProductLineItemLike[]) {
  let qty = 0;
  let revenue = 0;
  for (const line of lines) {
    const q = Math.max(0, Number(line.quantity) || 0);
    const u = Number(line.price) || 0;
    qty += q;
    revenue += u * q;
  }
  return { quantity: qty, revenue };
}

describe('TUCKER example (16× parent+child + 2 simple-only)', () => {
  it('naive all-line sum matches inflated 34 units (user saw in app before fix)', () => {
    const lines: ProductLineItemLike[] = [];
    for (let i = 0; i < 16; i++) {
      lines.push(configurableParentline(`o${i}`), simpleChildline(`o${i}`));
    }
    lines.push(simpleOnlyLine(), simpleOnlyLine());
    const n = naiveSumAllLines(lines);
    expect(n.quantity).toBe(34);
  });

  it('lineRevenueAndQtyForTopProducts gives 18 units and 2718€ (real sold units & row_total)', () => {
    const lines: ProductLineItemLike[] = [];
    for (let i = 0; i < 16; i++) {
      lines.push(configurableParentline(`o${i}`), simpleChildline(`o${i}`));
    }
    lines.push(simpleOnlyLine(), simpleOnlyLine());

    let qty = 0;
    let revenue = 0;
    for (const line of lines) {
      const r = lineRevenueAndQtyForTopProducts(PLATFORM, line);
      if (r) {
        qty += r.quantity;
        revenue += r.revenue;
      }
    }
    expect(qty).toBe(18);
    expect(revenue).toBe(18 * UNIT);
  });
});
