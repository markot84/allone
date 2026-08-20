import { describe, it, expect } from 'vitest';
import { sumChannelDailyWindow, type EcommerceChannelDaily } from './useEcommerceChannelDaily';

const day: EcommerceChannelDaily = {
  granularity: 'day',
  revenue: {
    direct_eshop: { '2026-01-10': 100, '2026-02-15': 200, '2026-03-01': 50 },
    marketplace_skroutz: { '2026-02-20': 300 },
  },
  includedRevenue: {
    direct_eshop: { '2026-01-10': 100, '2026-02-15': 200, '2026-03-01': 50 },
    // skroutz fully excluded → no included entries
  },
  orders: {
    direct_eshop: { '2026-01-10': 2, '2026-02-15': 3, '2026-03-01': 1 },
    marketplace_skroutz: { '2026-02-20': 5 },
  },
  includedOrders: {
    direct_eshop: { '2026-01-10': 2, '2026-02-15': 3, '2026-03-01': 1 },
  },
};

describe('sumChannelDailyWindow', () => {
  it('returns null when the rollup doc is absent', () => {
    expect(sumChannelDailyWindow(null, '2026-01-01', '2026-12-31')).toBeNull();
  });

  it('sums only the days inside [from,to] and derives excluded = gross − included', () => {
    // Feb only: direct_eshop 200 (1 day, 3 orders) + skroutz 300 (5 orders, fully excluded)
    const rows = sumChannelDailyWindow(day, '2026-02-01', '2026-02-28')!;
    const eshop = rows.find((r) => r.channel === 'direct_eshop')!;
    const skroutz = rows.find((r) => r.channel === 'marketplace_skroutz')!;
    expect(eshop.revenue).toBe(200);
    expect(eshop.includedRevenue).toBe(200);
    expect(eshop.excludedRevenue).toBe(0);
    expect(eshop.orders).toBe(3);
    expect(skroutz.revenue).toBe(300);
    expect(skroutz.includedRevenue).toBe(0);
    expect(skroutz.excludedRevenue).toBe(300); // fully excluded channel keeps its real revenue
    expect(skroutz.excludedOrders).toBe(5);
    // sorted by gross revenue desc
    expect(rows[0].channel).toBe('marketplace_skroutz');
  });

  it('includes the full window and skips channels with no orders in range', () => {
    const rows = sumChannelDailyWindow(day, '2026-01-01', '2026-12-31');
    const eshop = rows!.find((r) => r.channel === 'direct_eshop')!;
    expect(eshop.revenue).toBe(350); // 100 + 200 + 50
    const empty = sumChannelDailyWindow(day, '2025-01-01', '2025-12-31');
    expect(empty).toEqual([]); // no days in 2025
  });

  it('slices by month key when granularity is month', () => {
    const month: EcommerceChannelDaily = {
      granularity: 'month',
      revenue: { direct_eshop: { '2024-05': 1000, '2024-06': 2000 } },
      includedRevenue: { direct_eshop: { '2024-05': 1000, '2024-06': 2000 } },
      orders: { direct_eshop: { '2024-05': 10, '2024-06': 20 } },
      includedOrders: { direct_eshop: { '2024-05': 10, '2024-06': 20 } },
    };
    // a mid-month picker range still resolves to whole months at month granularity
    const rows = sumChannelDailyWindow(month, '2024-05-15', '2024-05-20')!;
    expect(rows[0].revenue).toBe(1000);
  });
});
