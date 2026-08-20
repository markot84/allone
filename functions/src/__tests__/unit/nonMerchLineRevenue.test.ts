import { describe, expect, it } from 'vitest';
import { nonMerchLineRevenue } from '../../ecommerceAggregator';

const match = (li: { sku?: string; title?: string }) =>
  li.sku === 'plex-1' || /unstrung/i.test(li.title || '');

describe('nonMerchLineRevenue (PER-301)', () => {
  it('sums matched lines only, preferring rowTotal over price×qty', () => {
    const total = nonMerchLineRevenue(
      [
        { sku: 'plex-1', rowTotal: 25 },
        { sku: 'x', title: 'Head Speed Unstrung', price: 100, quantity: 2 },
        { sku: 'y', title: 'Babolat Pure Drive', rowTotal: 300 },
      ],
      match
    );
    expect(total).toBe(225);
  });

  it('returns 0 with no matcher or no lines', () => {
    expect(nonMerchLineRevenue([{ sku: 'plex-1', rowTotal: 25 }], null)).toBe(0);
    expect(nonMerchLineRevenue([], match)).toBe(0);
    expect(nonMerchLineRevenue(undefined, match)).toBe(0);
  });
});
