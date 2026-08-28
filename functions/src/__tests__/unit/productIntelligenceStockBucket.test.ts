/** stockBucket must not flag brand-new (never-sold) stock as 'dead' — only stock that sold before
 * and then stopped. Drives the ERP Stock Status spread (new stock was wrongly bunched as dead). */
import { describe, it, expect } from 'vitest';
import { __test } from '../../productIntelligenceAggregator';

const { productFromRow, stockBucket } = __test;

// stockBucket is exercised through productFromRow's classification of a catalog row.
function bucketOf(row: Record<string, unknown>) {
  return productFromRow('mv_p_1', { sku: 'SKU-1', ...row }, 'erp')?.priority_tag;
}

describe('stockBucket via productFromRow — dead vs new', () => {
  it('zero stock → no_stock', () => {
    expect(bucketOf({ stock_level: 0, qty_sold_period: 0, qty_sold_lifetime: 0 })).toBe('no_stock');
  });

  it('new stock with no sales at all (period 0, lifetime 0) → not dead', () => {
    expect(bucketOf({ stock_level: 2, qty_sold_period: 0, qty_sold_lifetime: 0 })).toBe('healthy');
  });

  it('stock that sold before but not recently (period 0, lifetime > 0) → dead', () => {
    expect(bucketOf({ stock_level: 5, qty_sold_period: 0, qty_sold_lifetime: 12 })).toBe('dead');
  });

  it('no period signal at all → classified by presence, not dead', () => {
    expect(bucketOf({ stock_level: 3 })).toBe('healthy');
  });

  it('healthy turnover (recent sales, mid days-of-stock) → healthy', () => {
    // stock 30, sold 30/period(30d) → ~30 days of stock → boundary low; use higher stock for healthy
    expect(bucketOf({ stock_level: 60, qty_sold_period: 30 })).toBe('healthy');
  });

  it('low days-of-stock (recent sales, little stock) → low', () => {
    expect(bucketOf({ stock_level: 5, qty_sold_period: 30 })).toBe('low');
  });

  it('excess days-of-stock (recent sales, lots of stock) → excess', () => {
    expect(bucketOf({ stock_level: 1000, qty_sold_period: 30 })).toBe('excess');
  });
});

describe('stockBucket — shelf-age (real receipt date)', () => {
  // signature: stockBucket(stock, qtySoldPeriod, qtySoldLifetime, shelfAgeDays, leadDays, thresholds)
  it('no recent sales + shelf age beyond grace → dead', () => {
    expect(stockBucket(5, 0, 0, 200)).toBe('dead'); // 200 days on the shelf, never sold → genuinely dead
  });

  it('no recent sales + shelf age within grace → not dead (newly received)', () => {
    expect(stockBucket(5, 0, 12, 10)).toBe('healthy'); // received 10 days ago, even with old lifetime sales
  });

  it('shelf age is ignored when there ARE recent sales', () => {
    expect(stockBucket(5, 30, 0, 365)).toBe('low'); // selling now → days-of-stock wins over age
  });

  it('PER-310: deadStockDays beyond grace delays the dead cutoff', () => {
    const t = { velocityWindowDays: 30, lowDaysOfCover: 30, excessDaysOfCover: 120, newStockGraceDays: 60, deadStockDays: 90 };
    expect(stockBucket(5, 0, 0, 75, 0, t)).toBe('healthy'); // past grace but under the 90-day dead threshold
    expect(stockBucket(5, 0, 0, 91, 0, t)).toBe('dead');
    expect(stockBucket(5, 0, 0, 50, 0, { ...t, deadStockDays: 30 })).toBe('healthy'); // grace still protects new stock
  });

  it('falls back to lifetime rule when shelf age is unknown (behaviour-preserving)', () => {
    expect(stockBucket(5, 0, 12, null)).toBe('dead'); // sold before, stopped, no age signal
    expect(stockBucket(5, 0, 0, null)).toBe('healthy'); // never sold, no age signal → not dead
    expect(stockBucket(5, null, 0, null)).toBe('healthy'); // no period signal at all → healthy
  });
});

describe('stockBucket — lead-time reorder point (PER-276)', () => {
  // low = days-of-cover ≤ lowDaysOfCover(30) + leadDays. Defaults: window 30, low 30, excess 120.
  it("PER-276 example: 11 units, 10 sold/30d, lead 15 → low (cover 33d ≤ 45d)", () => {
    expect(stockBucket(11, 10)).toBe('healthy'); // no lead → 33d cover > 30 → healthy (baseline)
    expect(stockBucket(11, 10, 0, null, 15)).toBe('low'); // +15d lead → threshold 45 → low
  });

  it('lead 0 preserves the old flat-30 low threshold', () => {
    expect(stockBucket(9, 10)).toBe('low'); // 27d cover ≤ 30 → low regardless of lead
    expect(stockBucket(40, 10, 0, null, 0)).toBe('healthy'); // 120d cover, no lead → healthy
  });

  it('lead does not push a well-covered SKU below excess', () => {
    expect(stockBucket(50, 10, 0, null, 15)).toBe('excess'); // 150d cover > 120 → excess, lead irrelevant
  });
});
