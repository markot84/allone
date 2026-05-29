/**
 * Reproduces the user-reported TUCKER case: app showed 34 units vs 18 actual
 * (after counting configurable parent + simple child as two lines, plus simple-only orders).
 */
import { describe, expect, it } from 'vitest';
import {
  aggregateOrderLinesForTopProducts,
  lineRevenueAndQtyForTopProducts,
  type ProductLineItemLike,
} from './productLineStats';

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

/**
 * Safeblock pattern: η ΓΟΝΙΚΗ γραμμή (configurable) φέρει price+row_total, το ΠΑΙΔΙ (simple)
 * έχει row_total=0. Παλιά: μετρούσαμε το παιδί → revenue €0. Νέα aggregate: revenue από τη γονική.
 */
describe('Safeblock configurable (revenue on parent, child row_total=0)', () => {
  const PSKU = 'RS10164-48';
  const PRICE = 120.16;

  function order(): ProductLineItemLike[] {
    return [
      { sku: PSKU, name: 'Arden S3S', productType: 'configurable', parentItemId: null, itemId: 7995, quantity: 1, price: PRICE, rowTotal: PRICE },
      { sku: PSKU, name: 'Arden S3S', productType: 'simple', parentItemId: 7995, itemId: 7996, quantity: 1, price: 0, rowTotal: 0 },
    ];
  }

  it('aggregateOrderLinesForTopProducts → 1 row, qty 1, revenue = parent row_total', () => {
    const rows = aggregateOrderLinesForTopProducts('magento', order());
    expect(rows).toHaveLength(1);
    expect(rows[0].sku).toBe(PSKU);
    expect(rows[0].quantity).toBe(1);
    expect(rows[0].revenue).toBe(PRICE);
  });

  it('TUCKER-style (revenue on child) still rolls up to parent once', () => {
    const childPrice = 151;
    const lines: ProductLineItemLike[] = [
      { sku: 'TUCKER', productType: 'configurable', parentItemId: null, itemId: 100, quantity: 1, price: 0, rowTotal: 0 },
      { sku: 'TUCKER', productType: 'simple', parentItemId: 100, itemId: 101, quantity: 1, price: childPrice, rowTotal: childPrice },
    ];
    const rows = aggregateOrderLinesForTopProducts('magento', lines);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(1);
    expect(rows[0].revenue).toBe(childPrice);
  });
});
