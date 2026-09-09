import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useBrand } from '../../hooks/useBrand';
import {
  ShoppingCart,
  Package,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from 'lucide-react';
import {
  fetchAllEcommerceOrders,
  getEcommerceOrderNetRevenue,
  isEcommerceDemoLineItem,
  isEcommerceOrderRevenueIncluded,
  isOmittedFromEcommerceOrderLists,
  type EcommerceRawOrder,
} from '../../services/ecommerceRawOrders';
import {
  SALES_CHANNEL_LABELS,
  type EcommerceSalesChannel,
} from '../../services/ecommerceSalesChannel';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
} from 'recharts';
import { Button, Card, CardHeader, KPICard, Tooltip, PageHeader } from '../common';
import { useEcommerceSummary, type EcommerceTopProduct } from '../../hooks/useEcommerceSummary';
import { useEcommerceChannelDaily, sumChannelDailyWindow } from '../../hooks/useEcommerceChannelDaily';
import { formatCurrencyCompact, formatNumber } from '../../utils/format';
import { aggregateOrderLinesForTopProducts } from '../../utils/productLineStats';
import { resolveParentSku, hasDerivedParentSku } from '../../utils/parentSku';
import { useMagentoParentLinks } from '../../hooks/useMagentoParentLinks';
import { paymentChartLabelForEcommerceOrder } from '../../utils/magentoPaymentChart';
import { getBrandHistoryStartISO } from '../../utils/brandHistoryStart';
import type { KPICardData } from '../common/KPICard';
import { useGlobalDate } from '../../contexts/GlobalDateContext';
import { useFullBleedCanvas } from '../layout/AppChrome';
import { ChromePeriodActions, PageCanvas } from '../layout/ChromeControls';
import { MONO, SignalCard, SignalSkeleton } from '../signal';
import { axisProps, gridProps, seriesColor, token, tooltipProps } from '../../styles/chartTheme';

const PLATFORM_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  opencart: 'OpenCart',
  magento: 'Magento',
};

/** The four e-shop platforms, in their OWN brand colours — a Shopify green that is not Shopify's
 *  green helps nobody recognise which shop a row came from. They are the one deliberate exception
 *  to the no-hex rule on this page; everything else routes through the tokens. */
const PLATFORM_COLORS: Record<string, string> = {
  shopify: '#96BF48',
  woocommerce: '#7F54B3',
  opencart: '#23AFFE',
  magento: '#F46F25',
};

/** Sales channels, on the shared ramp. `needs_review` keeps the warning hue: it is a state, not a
 *  category, and it should not read as just another channel. */
const SALES_CHANNEL_TOKENS: Record<EcommerceSalesChannel, string> = {
  direct_eshop: '--success-700',
  marketplace_skroutz: '--sky-500',
  intercompany: '--seg-potential',
  personal: '--navy-500',
  needs_review: '--warning',
};

function salesChannelColor(channel: EcommerceSalesChannel | string): string {
  return token(SALES_CHANNEL_TOKENS[channel as EcommerceSalesChannel] ?? '--text-muted');
}

type OrderSortField = 'createdAt' | 'total' | 'platform';
type RowsPerPage = 10 | 20 | 50 | 100 | 'all';
type ProductScope = 'all' | 'parents_only';
type TopProductRow = EcommerceTopProduct & { parentSku: string; hasDerivedParent: boolean };

/** Yield to the main thread (next macrotask) so the UI can paint between heavy chunks. */
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
/** Batch size for the chunked, off-thread order aggregations. */
const ECOMMERCE_AGG_CHUNK = 2000;
type SalesChannelBreakdownRow = {
  channel: EcommerceSalesChannel;
  label: string;
  revenue: number;
  orders: number;
  includedRevenue: number;
  includedOrders: number;
  excludedRevenue: number;
  excludedOrders: number;
};

/** Payment methods are categorical; the shared ramp cycles for as many as the shop has. */
const methodColor = (index: number) => seriesColor(index);

/** Recharts Area needs >=2 points to render a visible line. */
function padSparklineForChart(values: number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [values[0], values[0]];
  return values;
}

function normalizeMethodLabel(value: string | null | undefined): string {
  const s = String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
  const firstPara = s.split(/\n+/)[0] ?? s;
  return firstPara.replace(/\s+/g, ' ').trim();
}

/** For "store pickup - address..." labels, keep only the title for the pie. */
function stripStorePickupAddressSuffix(s: string): string {
  const t = s.trim();
  if (!/^παραλαβή\s+από\s+το\s+κατάστημα\b/i.test(t)) return t;
  const m = t.match(/^(.+?)\s+-\s+/);
  if (m && m[1]) return m[1].trim();
  return t;
}

/** Group shipping methods for charts: BOX/locker variants collapse to one slice; dual labels like
 * "ACS - ELTA Courier" (Magento shipping_description) collapse to one carrier. */
function canonicalShippingMethodLabel(raw: string | null | undefined): string {
  let s = stripStorePickupAddressSuffix(normalizeMethodLabel(raw));
  if (!s) return '';
  const lower = s.toLowerCase();
  if (/\bbox\b|box\s*now|i\s*-?\s*box|locker|θήκ/i.test(lower)) {
    return 'BOX Now';
  }
  if (/\bacs\b/i.test(lower) && (/έλτα|elta/i.test(lower))) {
    const acsIdx = lower.search(/\bacs\b/i);
    const eltaCandidates = [lower.indexOf('έλτα'), lower.search(/\belta\b/i)].filter((i) => i >= 0);
    const eltaIdx = eltaCandidates.length ? Math.min(...eltaCandidates) : -1;
    if (eltaIdx < 0 || acsIdx <= eltaIdx) return 'ACS Courier';
    return 'ΕΛΤΑ Courier';
  }
  s = s.replace(/^(table\s+rate|flat\s+rate|best\s+way)\s*[-–—]\s*/i, '').trim();
  return s || normalizeMethodLabel(raw);
}

function buildPaymentMethodPieData(
  orders: EcommerceRawOrder[]
): Array<{ name: string; value: number; color: string }> {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const label = paymentChartLabelForEcommerceOrder(order);
    if (!label || label === '—') continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value], index) => ({
      name,
      value,
      color: methodColor(index),
    }));
}

function buildShippingMethodPieData(
  orders: EcommerceRawOrder[]
): Array<{ name: string; value: number; color: string }> {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const label = canonicalShippingMethodLabel(order.shippingMethod);
    if (!label) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value], index) => ({
      name,
      value,
      color: methodColor(index),
    }));
}

function salesChannelLabel(channel: string | null | undefined): string {
  return SALES_CHANNEL_LABELS[(channel || 'direct_eshop') as EcommerceSalesChannel] || String(channel || 'Direct e-shop');
}

function buildSalesChannelBreakdownFromOrders(orders: EcommerceRawOrder[]): SalesChannelBreakdownRow[] {
  const rows = new Map<EcommerceSalesChannel, SalesChannelBreakdownRow>();
  for (const order of orders) {
    const channel = (order.salesChannel || 'direct_eshop') as EcommerceSalesChannel;
    const current = rows.get(channel) || {
      channel,
      label: salesChannelLabel(channel),
      revenue: 0,
      orders: 0,
      includedRevenue: 0,
      includedOrders: 0,
      excludedRevenue: 0,
      excludedOrders: 0,
    };
    current.revenue += order.total;
    current.orders += 1;
    if (isEcommerceOrderRevenueIncluded(order)) {
      current.includedRevenue += order.total;
      current.includedOrders += 1;
    } else {
      current.excludedRevenue += order.total;
      current.excludedOrders += 1;
    }
    rows.set(channel, current);
  }
  return [...rows.values()].sort((a, b) => b.revenue - a.revenue);
}

function OrderStatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  let bg = 'var(--surface-2)';
  let fg = 'var(--text-muted)';

  // Each pair is a token background with a token text colour that clears 4.5:1 on it.
  if (['paid', 'completed', 'complete', 'fulfilled', 'processing'].includes(s)) {
    bg = 'var(--success-light)'; fg = 'var(--success-700)';
  } else if (['pending', 'on-hold', 'on_hold', 'authorized'].includes(s)) {
    bg = 'var(--warning-light)'; fg = 'var(--orange-700)';
  } else if (['refunded', 'cancelled', 'canceled', 'voided', 'failed'].includes(s)) {
    bg = 'var(--danger-light)'; fg = 'var(--danger-600)';
  } else if (['viva_klarna_undefined'].includes(s)) {
    bg = 'var(--navy-50)'; fg = 'var(--seg-potential)';
  } else if (['partially_refunded', 'partial'].includes(s)) {
    bg = 'var(--orange-50)'; fg = 'var(--orange-700)';
  }

  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: bg, color: fg }}
    >
      {status || '—'}
    </span>
  );
}

export function EcommerceDashboard() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  // This page reads only orders/breakdowns/topProducts/recentOrders, never SKU stats or
  // stock-movement — opt out of those heavy multi-MB chunk loads (same as DashboardOverview).
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const channelDaily = useEcommerceChannelDaily();

  const [prodScope, setProdScopeState] = useState<ProductScope>(() =>
    typeof window !== 'undefined' && window.localStorage.getItem('pp.ecommerce.prodScope') === 'parents_only' ? 'parents_only' : 'all'
  );
  const setProdScope = (next: ProductScope) => {
    setProdScopeState(next);
    try { window.localStorage.setItem('pp.ecommerce.prodScope', next); } catch { /* private mode */ }
  };

  // Parent SKUs come only from declared catalog relations (Magento itemGroupId) — no heuristics.
  // PER-307: slim precomputed {childSku → parentSku} doc instead of the full magento_products download.
  const parentLinks = useMagentoParentLinks();
  const parentSkuOf = useMemo(() => {
    const links = parentLinks.links;
    return (sku: string | null | undefined) => resolveParentSku(sku, links[String(sku || '').trim()]);
  }, [parentLinks.links]);
  const hasParentOf = useMemo(() => {
    const links = parentLinks.links;
    return (sku: string | null | undefined) => hasDerivedParentSku(sku, links[String(sku || '').trim()]);
  }, [parentLinks.links]);

  // Same global date range as Dashboard/ROI — no session-local override (that caused the E-commerce and Dashboard periods to diverge).
  const { fromDate: globalFrom, toDate: globalTo } = useGlobalDate();

  // The page draws its own gutters, so the shell drops its padded wrapper.
  useFullBleedCanvas();

  const brandHistoryStartISO = getBrandHistoryStartISO(currentBrand);
  const rawFrom = globalFrom;
  const rawTo = globalTo;
  let effectiveFrom = brandHistoryStartISO && rawFrom < brandHistoryStartISO ? brandHistoryStartISO : rawFrom;
  const effectiveTo = rawTo;
  if (effectiveFrom > effectiveTo) effectiveFrom = effectiveTo;

  // Recent orders (capped 50) for fallback rendering.
  const filteredRecentOrdersVisible = useMemo(() => {
    return ecomm.recentOrders.filter(o => {
      if (isOmittedFromEcommerceOrderLists(o.status)) return false;
      const d = (o.createdAt || '').slice(0, 10);
      return d >= effectiveFrom && d <= effectiveTo;
    });
  }, [ecomm.recentOrders, effectiveFrom, effectiveTo]);

  // Used only as a KPI fallback for legacy aggregates.
  const filteredOrdersForKpi = useMemo(
    () => filteredRecentOrdersVisible.filter((o) => isEcommerceOrderRevenueIncluded(o)),
    [filteredRecentOrdersVisible]
  );

  const { data: rawOrders = [], isPending: rawOrdersLoading, isSuccess: rawOrdersLoaded } = useQuery({
    queryKey: [
      'ecommerceOrdersRaw',
      'classified',
      brandId,
      [...ecomm.connectedPlatforms].sort().join('|'),
      effectiveFrom,
      effectiveTo,
    ],
    queryFn: () =>
      brandId
        ? fetchAllEcommerceOrders(brandId, ecomm.connectedPlatforms, {
            sinceDate: effectiveFrom,
            untilDate: effectiveTo,
            revenueMode: 'classified',
            // PER-307: revisits read the SDK cache (empty-cache falls back to server inside the service).
            cacheFirst: true,
          })
        : Promise.resolve([]),
    enabled: !!brandId && ecomm.connectedPlatforms.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const [orderSort, setOrderSort] = useState<{ field: OrderSortField; dir: 'asc' | 'desc' }>({ field: 'createdAt', dir: 'desc' });
  const [prodSort, setProdSort] = useState<{ field: 'revenue' | 'quantity'; dir: 'asc' | 'desc' }>({ field: 'revenue', dir: 'desc' });
  const [orderSearch, setOrderSearch] = useState('');
  const [orderPlatform, setOrderPlatform] = useState('all');
  const [orderStatus, setOrderStatus] = useState('all');
  const [orderRows, setOrderRows] = useState<RowsPerPage>(20);
  const [orderPage, setOrderPage] = useState(1);
  const [prodSearch, setProdSearch] = useState('');
  const [prodRows, setProdRows] = useState<RowsPerPage>(20);
  const [prodPage, setProdPage] = useState(1);

  // Order-table build runs getEcommerceOrderNetRevenue per order (O(orders×items)) and froze the
  // page on wide ranges; same predicate/order, now computed off the render path in chunks.
  const [oftState, setOftState] = useState<EcommerceRawOrder[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Clear any prior result so the memo falls back to the recent-orders preview while we
      // recompute — avoids briefly showing a stale brand/period under the new selection.
      setOftState(null);
      if (!rawOrdersLoaded) return;
      const out: EcommerceRawOrder[] = [];
      for (let i = 0; i < rawOrders.length; i += ECOMMERCE_AGG_CHUNK) {
        for (const order of rawOrders.slice(i, i + ECOMMERCE_AGG_CHUNK)) {
          if (isOmittedFromEcommerceOrderLists(order.status)) continue;
          const day = (order.createdAt || '').slice(0, 10);
          if (brandHistoryStartISO && day < brandHistoryStartISO) continue;
          if (!(day >= effectiveFrom && day <= effectiveTo)) continue;
          const { revenue, isAllDemo } = getEcommerceOrderNetRevenue(order);
          if (isAllDemo) continue;
          out.push({ ...order, total: revenue });
        }
        if (i + ECOMMERCE_AGG_CHUNK < rawOrders.length) await yieldToMain();
        if (cancelled) return;
      }
      if (!cancelled) setOftState(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [rawOrdersLoaded, rawOrders, effectiveFrom, effectiveTo, brandHistoryStartISO]);

  const ordersForTables = useMemo<EcommerceRawOrder[]>(() => {
    // While the chunked pass is in flight (or before raw orders load), fall back to the capped
    // recent-orders preview — same as the previous !rawOrdersLoaded branch.
    if (!rawOrdersLoaded || oftState == null) {
      return filteredRecentOrdersVisible.map((order) => ({
        ...order,
        lineItems: [],
        paymentMethod: order.paymentMethod || '',
        shippingMethod: order.shippingMethod || '',
      }));
    }
    return oftState;
  }, [rawOrdersLoaded, oftState, filteredRecentOrdersVisible]);

  const revenueOrdersForTables = useMemo(
    () => ordersForTables.filter((order) => isEcommerceOrderRevenueIncluded(order)),
    [ordersForTables]
  );

  /** `ecommerce_summary` only covers ~90 days, but the picker can request older periods; derive sums
   * from the full raw orders once loaded to stay aligned with the tables/pies. */
  const periodMetricsFromRawOrders = useMemo(() => {
    if (!rawOrdersLoaded) return null;
    const dayRev: Record<string, number> = {};
    const dayOrd: Record<string, number> = {};
    const plat: Record<string, { revenue: number; orders: number }> = {};
    for (const o of revenueOrdersForTables) {
      const day = (o.createdAt || '').slice(0, 10);
      if (!day) continue;
      dayRev[day] = (dayRev[day] || 0) + o.total;
      dayOrd[day] = (dayOrd[day] || 0) + 1;
      if (!plat[o.platform]) plat[o.platform] = { revenue: 0, orders: 0 };
      plat[o.platform].revenue += o.total;
      plat[o.platform].orders += 1;
    }
    const dailyRevenue = Object.entries(dayRev)
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const ordersByDay = Object.entries(dayOrd)
      .map(([date, orders]) => ({ date, orders: Number(orders) || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const platformBreakdown = Object.entries(plat)
      .map(([platform, v]) => ({ platform, revenue: v.revenue, orders: v.orders }))
      .filter((row) => row.orders > 0)
      .sort((a, b) => b.revenue - a.revenue);
    const salesChannelBreakdown = buildSalesChannelBreakdownFromOrders(ordersForTables);
    return { dailyRevenue, ordersByDay, platformBreakdown, salesChannelBreakdown };
  }, [rawOrdersLoaded, revenueOrdersForTables, ordersForTables]);

  const filteredDailyRevenue = useMemo(
    () =>
      rawOrdersLoaded && periodMetricsFromRawOrders
        ? periodMetricsFromRawOrders.dailyRevenue
        : ecomm.dailyRevenue.filter((d) => d.date >= effectiveFrom && d.date <= effectiveTo),
    [rawOrdersLoaded, periodMetricsFromRawOrders, ecomm.dailyRevenue, effectiveFrom, effectiveTo],
  );

  const filteredOrdersByDay = useMemo(
    () =>
      rawOrdersLoaded && periodMetricsFromRawOrders
        ? periodMetricsFromRawOrders.ordersByDay
        : ecomm.ordersByDay.filter((d) => d.date >= effectiveFrom && d.date <= effectiveTo),
    [rawOrdersLoaded, periodMetricsFromRawOrders, ecomm.ordersByDay, effectiveFrom, effectiveTo],
  );

  const filteredTotalRevenue = useMemo(
    () => filteredDailyRevenue.reduce((s, d) => s + d.revenue, 0),
    [filteredDailyRevenue]
  );
  const filteredOrderCount = useMemo(() => {
    if (filteredOrdersByDay.length > 0) {
      return filteredOrdersByDay.reduce((s, d) => s + d.orders, 0);
    }
    return filteredOrdersForKpi.length;
  }, [filteredOrdersByDay, filteredOrdersForKpi]);
  const filteredAov = filteredOrderCount > 0 ? filteredTotalRevenue / filteredOrderCount : 0;

  const displayPlatformBreakdown = useMemo(
    () =>
      rawOrdersLoaded && periodMetricsFromRawOrders
        ? periodMetricsFromRawOrders.platformBreakdown
        : ecomm.platformBreakdown,
    [rawOrdersLoaded, periodMetricsFromRawOrders, ecomm.platformBreakdown],
  );
  // PER-307: pct against the breakdown's own total — the fallback rows are all-window, ÷ period revenue gave 10000%+ shares.
  const displayPlatformTotal = useMemo(
    () => displayPlatformBreakdown.reduce((s, p) => s + (p.revenue || 0), 0),
    [displayPlatformBreakdown],
  );

  // ECOM Phase 2 (PER-170): the period-correct channel split is summed client-side from the server
  // per-day-per-channel rollup (ecommerce_channel_daily) over the picker window — NO raw-orders fetch,
  // so it renders on large brands (e.g. 80k+ orders) where the client order fetch never completes and
  // the card went blank under Phase 1. Backward-compat: if the rollup doc isn't built yet, fall back to
  // the Phase-1 raw-orders period breakdown (never an all-time number — that misled as period data).
  const displaySalesChannelBreakdown = useMemo<SalesChannelBreakdownRow[]>(
    () =>
      sumChannelDailyWindow(channelDaily, effectiveFrom, effectiveTo) ??
      periodMetricsFromRawOrders?.salesChannelBreakdown ??
      [],
    [channelDaily, effectiveFrom, effectiveTo, periodMetricsFromRawOrders],
  );

  const kpis: KPICardData[] = useMemo(() => {
    const last30 = filteredDailyRevenue.slice(-30);
    const ordersByDateMap = new Map(filteredOrdersByDay.map((d) => [d.date, d.orders]));
    const ordersPerDay = last30.map((d) => ordersByDateMap.get(d.date) ?? 0);
    const aovPerDay = last30.map((d, i) => {
      const n = ordersPerDay[i] ?? 0;
      return n > 0 ? d.revenue / n : 0;
    });
    return [
      {
        label: 'Net Revenue e-shop',
        value: formatCurrencyCompact(filteredTotalRevenue),
        tooltip: 'Καθαρά έσοδα e-commerce (χωρίς ΦΠΑ) για το επιλεγμένο διάστημα. Εξαιρούνται cancelled/refunded statuses, demo line items και κανάλια που έχουν οριστεί ως μη-core (π.χ. ενδοομιλικά).',
        sparklineData: padSparklineForChart(last30.map((d) => d.revenue)),
      },
      {
        label: 'Παραγγελίες',
        value: formatNumber(filteredOrderCount),
        tooltip: 'Σύνολο παραγγελιών για το επιλεγμένο διάστημα (εξαιρούνται cancelled/refunded και κανάλια εκτός core).',
        sparklineData: padSparklineForChart(ordersPerDay),
      },
      {
        label: 'AOV',
        value: formatCurrencyCompact(filteredAov),
        tooltip: 'Average Order Value (χωρίς ΦΠΑ): καθαρός τζίρος / αριθμός παραγγελιών για το επιλεγμένο διάστημα.',
        sparklineData: padSparklineForChart(aovPerDay),
      },
      {
        label: 'Πλατφόρμες',
        value: String(ecomm.connectedPlatforms.length),
        tooltip: ecomm.connectedPlatforms.map((p) => PLATFORM_LABELS[p] || p).join(', ') || 'Κανένα',
      },
    ];
  }, [filteredTotalRevenue, filteredOrderCount, filteredAov, filteredDailyRevenue, filteredOrdersByDay, ecomm.connectedPlatforms]);

  // Second O(orders×items) pass that froze the page; accumulate off the render path in chunks
  // (same loop body), keeping the cheap parent-SKU mapping in the memo below so it re-derives late.
  const [topProductAgg, setTopProductAgg] = useState<
    Array<{ sku: string; name: string; revenue: number; quantity: number }> | null
  >(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTopProductAgg(null);
      if (!rawOrdersLoaded || oftState == null) return;
      const productMap = new Map<string, { name: string; revenue: number; quantity: number }>();
      for (let i = 0; i < revenueOrdersForTables.length; i += ECOMMERCE_AGG_CHUNK) {
        for (const order of revenueOrdersForTables.slice(i, i + ECOMMERCE_AGG_CHUNK)) {
          const demoFiltered = (order.lineItems || []).filter((li) => !isEcommerceDemoLineItem(li));
          const aggregated = aggregateOrderLinesForTopProducts(order.platform, demoFiltered);
          for (const row of aggregated) {
            const key = row.sku.trim();
            if (!key) continue;
            const existing = productMap.get(key) || { name: row.name, revenue: 0, quantity: 0 };
            existing.revenue += row.revenue;
            existing.quantity += row.quantity;
            if (!existing.name) existing.name = row.name;
            productMap.set(key, existing);
          }
        }
        if (i + ECOMMERCE_AGG_CHUNK < revenueOrdersForTables.length) await yieldToMain();
        if (cancelled) return;
      }
      if (!cancelled) {
        setTopProductAgg(
          [...productMap.entries()].map(([sku, data]) => ({
            sku,
            name: data.name,
            revenue: data.revenue,
            quantity: data.quantity,
          }))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rawOrdersLoaded, oftState, revenueOrdersForTables]);

  // No server-summary fallback: its window differs from the selected period, so the amounts would
  // silently swap once the accurate aggregation lands — show loading instead of misleading figures.
  const topProductsPending = !rawOrdersLoaded || topProductAgg == null;
  const topProductsForTables = useMemo<TopProductRow[]>(() => {
    if (!rawOrdersLoaded || topProductAgg == null) return [];
    return topProductAgg
      .map((data) => ({
        sku: data.sku,
        name: data.name,
        revenue: data.revenue,
        quantity: data.quantity,
        parentSku: parentSkuOf(data.sku),
        hasDerivedParent: hasParentOf(data.sku),
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [rawOrdersLoaded, topProductAgg, parentSkuOf, hasParentOf]);

  /** Parent SKU only: group by declared catalog itemGroupId (Magento); no heuristic fallback. */
  const parentProductsForTables = useMemo<TopProductRow[]>(() => {
    const parentMap = new Map<string, { revenue: number; quantity: number; name: string }>();
    for (const product of topProductsForTables) {
      const psku = parentSkuOf(product.sku) || product.sku;
      if (!psku) continue;
      const existing = parentMap.get(psku) || { revenue: 0, quantity: 0, name: '' };
      existing.revenue += product.revenue;
      existing.quantity += product.quantity;
      const cand = String(product.name || '').trim();
      if (cand && cand !== psku && cand !== product.sku) {
        if (!existing.name || cand.length > existing.name.length) existing.name = cand;
      }
      parentMap.set(psku, existing);
    }

    return [...parentMap.entries()]
      .map(([parentSku, data]) => ({
        sku: parentSku,
        name: data.name || parentSku,
        revenue: data.revenue,
        quantity: data.quantity,
        parentSku,
        hasDerivedParent: true,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [topProductsForTables, parentSkuOf]);

  const sortedOrders = useMemo(() => {
    const arr = [...ordersForTables];
    arr.sort((a, b) => {
      const dir = orderSort.dir === 'asc' ? 1 : -1;
      if (orderSort.field === 'createdAt') return dir * a.createdAt.localeCompare(b.createdAt);
      if (orderSort.field === 'total') return dir * (a.total - b.total);
      return dir * a.platform.localeCompare(b.platform);
    });
    return arr;
  }, [ordersForTables, orderSort]);

  const productRows = useMemo(
    () => (prodScope === 'parents_only' ? parentProductsForTables : topProductsForTables),
    [prodScope, parentProductsForTables, topProductsForTables]
  );

  const sortedProducts = useMemo(() => {
    const arr = [...productRows];
    arr.sort((a, b) => {
      const dir = prodSort.dir === 'asc' ? 1 : -1;
      return dir * (a[prodSort.field] - b[prodSort.field]);
    });
    return arr;
  }, [productRows, prodSort]);

  const orderPlatforms = useMemo(
    () => Array.from(new Set(ordersForTables.map((o) => o.platform).filter(Boolean))).sort(),
    [ordersForTables]
  );
  const orderStatuses = useMemo(
    () => Array.from(new Set(ordersForTables.map((o) => (o.status || '').toLowerCase()).filter(Boolean))).sort(),
    [ordersForTables]
  );

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return sortedOrders.filter((o) => {
      if (orderPlatform !== 'all' && o.platform !== orderPlatform) return false;
      if (orderStatus !== 'all' && (o.status || '').toLowerCase() !== orderStatus) return false;
      if (!q) return true;
      const hay = `${o.orderId} ${o.orderName || ''} ${o.platform} ${o.status} ${o.salesChannel || ''} ${o.paymentMethod || ''} ${o.shippingMethod || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sortedOrders, orderSearch, orderPlatform, orderStatus]);

  const filteredProducts = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    return sortedProducts.filter((p) => {
      if (!q) return true;
      return `${p.name || ''} ${p.sku || ''} ${p.parentSku || ''}`.toLowerCase().includes(q);
    });
  }, [sortedProducts, prodSearch]);

  const paymentMethodPieData = useMemo(
    () => buildPaymentMethodPieData(revenueOrdersForTables),
    [revenueOrdersForTables]
  );

  const shippingMethodPieData = useMemo(
    () => buildShippingMethodPieData(revenueOrdersForTables),
    [revenueOrdersForTables]
  );

  const orderTotalPages = orderRows === 'all' ? 1 : Math.max(1, Math.ceil(filteredOrders.length / orderRows));
  const prodTotalPages = prodRows === 'all' ? 1 : Math.max(1, Math.ceil(filteredProducts.length / prodRows));
  const safeOrderPage = Math.min(orderPage, orderTotalPages);
  const safeProdPage = Math.min(prodPage, prodTotalPages);

  const pagedOrders = useMemo(() => {
    if (orderRows === 'all') return filteredOrders;
    const start = (safeOrderPage - 1) * orderRows;
    return filteredOrders.slice(start, start + orderRows);
  }, [filteredOrders, orderRows, safeOrderPage]);

  const pagedProducts = useMemo(() => {
    if (prodRows === 'all') return filteredProducts;
    const start = (safeProdPage - 1) * prodRows;
    return filteredProducts.slice(start, start + prodRows);
  }, [filteredProducts, prodRows, safeProdPage]);


  const toggleOrderSort = (field: OrderSortField) => {
    setOrderSort((prev) => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const toggleProdSort = (field: 'revenue' | 'quantity') => {
    setProdSort((prev) => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const SortIcon = ({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) =>
    active ? (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronDown size={12} className="opacity-30" />;

  // Loading state
  if (ecomm.isLoading) {
    return (
      <PageCanvas>
        <PageHeader eyebrow="E-commerce" title="E-commerce" description="Δεδομένα παραγγελιών και προϊόντων από τα συνδεδεμένα e-shop" />
        <SignalCard padding={20} style={{ gap: 12 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>Φόρτωση e-commerce δεδομένων…</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
            <SignalSkeleton height={96} />
            <SignalSkeleton height={96} />
            <SignalSkeleton height={96} />
            <SignalSkeleton height={96} />
          </div>
          <SignalSkeleton height={280} />
        </SignalCard>
      </PageCanvas>
    );
  }

  // Empty state
  if (!ecomm.hasData) {
    return (
      <PageCanvas>
        <PageHeader eyebrow="E-commerce" title="E-commerce" description="Δεδομένα παραγγελιών και προϊόντων από τα συνδεδεμένα e-shop" />
        <SignalCard accent="var(--gold-700)" padding={24} style={{ gap: 12, alignItems: 'flex-start' }}>
          <ShoppingCart size={28} style={{ color: 'var(--text-muted)' }} aria-hidden />
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Δεν υπάρχουν δεδομένα e-commerce</span>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, maxWidth: '62ch' }}>
            Συνδέστε τουλάχιστον ένα e-shop (Shopify, WooCommerce, OpenCart ή Magento) και κάντε sync για να δείτε τα
            δεδομένα σας εδώ.
          </span>
          <Button variant="primary" size="sm" icon={<ExternalLink size={14} />} onClick={() => { window.location.hash = '#data'; }}>
            Μετάβαση στα Connectors
          </Button>
        </SignalCard>
      </PageCanvas>
    );
  }

  return (
    <PageCanvas>
      <ChromePeriodActions />

      <PageHeader
        eyebrow="E-commerce"
        title="E-commerce"
        description={`Δεδομένα ${ecomm.connectedPlatforms.map((p) => PLATFORM_LABELS[p] || p).join(', ')}`}
        meta={
          ecomm.syncedAt ? (
            <p style={{ margin: 0, fontFamily: MONO, fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
              sync{' '}
              {ecomm.syncedAt?.toDate?.()
                ? ecomm.syncedAt.toDate().toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                : '—'}
            </p>
          ) : undefined
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <KPICard key={kpi.label} kpi={kpi} index={i} />
        ))}
      </div>

      {/* Revenue Chart + Platform Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Revenue Trend */}
        <Card className="xl:col-span-2">
          <CardHeader title="Revenue ανά ημέρα" subtitle={`${effectiveFrom} — ${effectiveTo}`} />
          <div className="px-5 pb-5">
            {filteredDailyRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={filteredDailyRevenue}>
                  <defs>
                    <linearGradient id="ecommRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={token('--orange-500')} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={token('--orange-500')} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid {...gridProps()} />
                  <XAxis dataKey="date" {...axisProps()} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis
                    {...axisProps()}
                    width={52}
                    tickFormatter={(v: number) => `€${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`}
                  />
                  <RechartsTooltip
                    {...tooltipProps()}
                    formatter={(v: unknown) => [`€${Number(v ?? 0).toFixed(2)}`, 'Revenue']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke={token('--orange-500')} fill="url(#ecommRevGrad)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-[var(--text-muted)] py-8 text-center">Δεν υπάρχουν δεδομένα εσόδων</p>
            )}
          </div>
        </Card>

        {/* Platform Breakdown */}
        <Card>
          <CardHeader title="Ανά πλατφόρμα" subtitle={`${effectiveFrom} — ${effectiveTo}`} />
          <div className="px-5 pb-5">
            {rawOrdersLoading && !rawOrdersLoaded && (
              <p className="text-xs text-[var(--text-muted)] mb-3">Φόρτωση πλήρους ιστορικού παραγγελιών για το εύρος…</p>
            )}
            {displayPlatformBreakdown.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={displayPlatformBreakdown} layout="vertical">
                    <XAxis type="number" {...axisProps()} tickFormatter={(v: number) => `€${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`} />
                    <YAxis
                      type="category"
                      dataKey="platform"
                      {...axisProps()}
                      tickFormatter={(v: string) => PLATFORM_LABELS[v] || v}
                      width={90}
                    />
                    <RechartsTooltip
                      {...tooltipProps()}
                      formatter={(v: unknown) => [`€${Number(v ?? 0).toFixed(2)}`, 'Revenue']}
                      labelFormatter={(l: string) => PLATFORM_LABELS[l] || l}
                    />
                    <Bar dataKey="revenue" radius={[0, 6, 6, 0]}>
                      {displayPlatformBreakdown.map((entry) => (
                        <Cell key={entry.platform} fill={PLATFORM_COLORS[entry.platform] || token('--text-muted')} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-2.5">
                  {displayPlatformBreakdown.map((p) => {
                    const pct = displayPlatformTotal > 0 ? (p.revenue / displayPlatformTotal) * 100 : 0;
                    return (
                      <div key={p.platform}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PLATFORM_COLORS[p.platform] || 'var(--text-muted)' }} />
                            <span className="text-[var(--text-secondary)] font-medium">{PLATFORM_LABELS[p.platform] || p.platform}</span>
                          </div>
                          <span className="text-[var(--text-muted)]">{p.orders} orders · {pct.toFixed(0)}%</span>
                        </div>
                        <div className="h-1 bg-[var(--surface-2)] rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, ease: 'easeOut' }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: PLATFORM_COLORS[p.platform] || 'var(--text-muted)' }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-sm text-[var(--text-muted)] py-8 text-center">—</p>
            )}
          </div>
        </Card>
      </div>

      {(displaySalesChannelBreakdown.length > 0 || rawOrdersLoading) && (
        <Card>
          <CardHeader
            title="Net Revenue & εξαιρέσεις"
            subtitle={`${effectiveFrom} — ${effectiveTo}`}
          />
          <div className="px-5 pb-5">
            <p className="mb-3 max-w-3xl text-[11px] leading-relaxed text-[var(--text-muted)]">
              Core revenue = τζίρος που μετρά στα e-shop KPI/ROI. Τα εξαιρούμενα ποσά είναι πραγματικές
              παραγγελίες του καναλιού, αλλά δεν μπαίνουν στον καθαρό τζίρο e-shop.
            </p>
            {displaySalesChannelBreakdown.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] bg-white p-5 text-sm text-[var(--text-muted)]">
                Φόρτωση ανάλυσης καναλιών για το επιλεγμένο διάστημα…
              </div>
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {displaySalesChannelBreakdown.map((row) => {
                const color = salesChannelColor(row.channel);
                const includedPct = row.revenue > 0 ? (row.includedRevenue / row.revenue) * 100 : 0;
                // ECOM Phase 3.5: a fully-excluded channel made money but contributes €0 to the KPI —
                // don't headline a bare €0 (reads as "no sales"); show its real revenue, marked excluded.
                const fullyExcluded = row.includedRevenue <= 0 && row.revenue > 0;
                return (
                  <div key={row.channel} className="rounded-xl border border-[var(--border)] bg-white p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-xs font-semibold text-[var(--text-primary)] truncate">{row.label}</span>
                      </div>
                      <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">{formatNumber(row.orders)} total orders</span>
                    </div>
                    {fullyExcluded ? (
                      <>
                        <p className="mb-0.5 text-[10px] text-[var(--text-muted)]">Εξαιρείται από e-shop KPI</p>
                        <div className="text-sm font-bold text-[var(--text-muted)] tabular-nums">
                          {formatCurrencyCompact(row.revenue)}
                        </div>
                        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                          {formatNumber(row.orders)} orders · €0 στα KPI
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="mb-0.5 text-[10px] text-[var(--text-muted)]">Μετράει στα e-shop KPI</p>
                        <div className="text-sm font-bold text-[var(--text-primary)] tabular-nums">
                          {formatCurrencyCompact(row.includedRevenue)}
                        </div>
                        <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                          {formatNumber(row.includedOrders)} core orders
                        </p>
                        <div className="mt-2 h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${includedPct}%`, backgroundColor: color }} />
                        </div>
                        {row.excludedOrders > 0 && (
                          <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
                            Εξαιρείται από KPI: {formatCurrencyCompact(row.excludedRevenue)} / {formatNumber(row.excludedOrders)} orders
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            )}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Τρόπος Πληρωμής" subtitle={`Κατανομή παραγγελιών (${effectiveFrom} — ${effectiveTo})`} />
          <div className="px-5 pb-5">
            {paymentMethodPieData.length > 0 ? (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={paymentMethodPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={88}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                    >
                      {paymentMethodPieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      {...tooltipProps()}
                      formatter={(value, name) => [`${Number(value ?? 0).toLocaleString()} παραγγελίες`, String(name)]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
                  {paymentMethodPieData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                      <span className="text-[11px] text-[var(--text-secondary)]">{entry.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)] py-10 text-center">Δεν υπάρχουν διαθέσιμα δεδομένα τρόπου πληρωμής</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Τρόπος Αποστολής" subtitle={`Κατανομή παραγγελιών (${effectiveFrom} — ${effectiveTo})`} />
          <div className="px-5 pb-5">
            {shippingMethodPieData.length > 0 ? (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie
                      data={shippingMethodPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={52}
                      outerRadius={88}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                    >
                      {shippingMethodPieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      {...tooltipProps()}
                      formatter={(value, name) => [`${Number(value ?? 0).toLocaleString()} παραγγελίες`, String(name)]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 mt-2">
                  {shippingMethodPieData.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                      <span className="text-[11px] text-[var(--text-secondary)]">{entry.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)] py-10 text-center">Δεν υπάρχουν διαθέσιμα δεδομένα τρόπου αποστολής</p>
            )}
          </div>
        </Card>
      </div>

      {/* Top Products + Recent Orders */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top Products */}
        <Card>
          <CardHeader
            title="Top Products"
            subtitle={`Κατά Revenue (${effectiveFrom} — ${effectiveTo})`}
            icon={<Package size={16} />}
          />
          <div className="px-5 pb-5">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                value={prodSearch}
                onChange={(e) => {
                  setProdSearch(e.target.value);
                  setProdPage(1);
                }}
                placeholder="Αναζήτηση προϊόντος / SKU"
                className="h-8 px-2.5 rounded-md border border-[var(--border)] text-xs min-w-[220px]"
              />
              <select
                value={prodScope}
                onChange={(e) => {
                  setProdScope(e.target.value as ProductScope);
                  setProdPage(1);
                }}
                className="h-8 px-2 rounded-md border border-[var(--border)] text-xs min-w-[180px]"
              >
                <option value="all">Όλα τα SKUs</option>
                <option value="parents_only">Μόνο Parent SKUs</option>
              </select>
              <select
                value={String(prodRows)}
                onChange={(e) => {
                  const v = e.target.value === 'all' ? 'all' : Number(e.target.value);
                  setProdRows(v as RowsPerPage);
                  setProdPage(1);
                }}
                className="h-8 px-2 rounded-md border border-[var(--border)] text-xs"
              >
                <option value="10">10 / σελίδα</option>
                <option value="20">20 / σελίδα</option>
                <option value="50">50 / σελίδα</option>
                <option value="100">100 / σελίδα</option>
                <option value="all">Προβολή όλων</option>
              </select>
              <Tooltip content="Όλα τα SKUs: κάθε προϊόν όπως πωλήθηκε. Μόνο Parent SKUs: ομαδοποίηση παραλλαγών με βάση τις δηλωμένες σχέσεις parent/variant του καταλόγου Magento (item_group_id) — προϊόντα χωρίς δηλωμένη σχέση εμφανίζονται ως έχουν.">
                <span className="text-[11px] text-[var(--text-muted)]">Filters</span>
              </Tooltip>
            </div>
            {topProductsPending ? (
              <p className="text-xs text-[var(--text-muted)] py-6 text-center">Υπολογισμός ακριβών στοιχείων περιόδου…</p>
            ) : prodScope === 'parents_only' && parentLinks.isLoading ? (
              <p className="text-xs text-[var(--text-muted)] py-6 text-center">Φόρτωση καταλόγου για ομαδοποίηση Parent SKU…</p>
            ) : pagedProducts.length > 0 ? (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="data-table" style={{ minWidth: 340 }}>
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="pb-2.5 font-medium text-[var(--text-muted)] pr-4">Προϊόν</th>
                      <th
                        className="pb-2.5 font-medium text-[var(--text-muted)] text-right cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleProdSort('revenue')}
                      >
                        <span className="inline-flex items-center gap-0.5 hover:text-[var(--text-primary)] transition-colors">
                          Revenue <SortIcon active={prodSort.field === 'revenue'} dir={prodSort.dir} />
                        </span>
                      </th>
                      <th
                        className="pb-2.5 font-medium text-[var(--text-muted)] text-right cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleProdSort('quantity')}
                      >
                        <span className="inline-flex items-center gap-0.5 hover:text-[var(--text-primary)] transition-colors">
                          Qty <SortIcon active={prodSort.field === 'quantity'} dir={prodSort.dir} />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedProducts.map((p, i) => {
                      const maxRev = filteredProducts[0]?.revenue || 1;
                      const barPct = Math.min(100, (p.revenue / maxRev) * 100);
                      return (
                        <tr
                          key={p.sku + i}
                          className="border-b border-[var(--surface-2)] last:border-0 hover:bg-[var(--surface-2)] transition-colors"
                        >
                          <td className="py-2.5 pr-4">
                            <p className="text-[var(--text-primary)] font-medium truncate max-w-[220px]">{p.name || p.sku}</p>
                            {p.sku !== p.name && <p className="text-[10px] text-[var(--text-muted)] truncate max-w-[220px]">{p.sku}</p>}
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="flex flex-col items-end">
                              <span className="text-[var(--text-primary)] font-semibold tabular-nums">€{formatNumber(p.revenue, 2)}</span>
                              <div className="w-16 h-1 bg-[var(--surface-2)] rounded-full overflow-hidden mt-1">
                                <div className="h-full rounded-full bg-[var(--orange-500)]/60" style={{ width: `${barPct}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 text-right text-[var(--text-muted)] tabular-nums">{p.quantity}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)] py-4 text-center">
                {rawOrdersLoading
                  ? 'Προετοιμασία προϊόντων…'
                  : 'Δεν βρέθηκαν προϊόντα με τα τρέχοντα φίλτρα'}
              </p>
            )}
            <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
              <span>Σύνολο: {filteredProducts.length} προϊόντα</span>
              {prodRows !== 'all' && (
                <div className="inline-flex items-center gap-1">
                  <button
                    className="px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40"
                    disabled={safeProdPage <= 1}
                    onClick={() => setProdPage((p) => Math.max(1, p - 1))}
                  >
                    Προηγ.
                  </button>
                  <span>{safeProdPage}/{prodTotalPages}</span>
                  <button
                    className="px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40"
                    disabled={safeProdPage >= prodTotalPages}
                    onClick={() => setProdPage((p) => Math.min(prodTotalPages, p + 1))}
                  >
                    Επόμ.
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* Recent Orders */}
        <Card>
          <CardHeader
            title="Πρόσφατες Παραγγελίες"
            subtitle={rawOrdersLoading ? 'Φόρτωση για το επιλεγμένο διάστημα…' : `Στο επιλεγμένο διάστημα (${effectiveFrom} — ${effectiveTo})`}
            icon={<ShoppingCart size={16} />}
          />
          <div className="px-5 pb-5">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <input
                value={orderSearch}
                onChange={(e) => {
                  setOrderSearch(e.target.value);
                  setOrderPage(1);
                }}
                placeholder="Αναζήτηση order / όνομα / status"
                className="h-8 px-2.5 rounded-md border border-[var(--border)] text-xs min-w-[220px]"
              />
              <select
                value={orderPlatform}
                onChange={(e) => {
                  setOrderPlatform(e.target.value);
                  setOrderPage(1);
                }}
                className="h-8 px-2 rounded-md border border-[var(--border)] text-xs"
              >
                <option value="all">Όλες οι πλατφόρμες</option>
                {orderPlatforms.map((p) => (
                  <option key={p} value={p}>{PLATFORM_LABELS[p] || p}</option>
                ))}
              </select>
              <select
                value={orderStatus}
                onChange={(e) => {
                  setOrderStatus(e.target.value);
                  setOrderPage(1);
                }}
                className="h-8 px-2 rounded-md border border-[var(--border)] text-xs"
              >
                <option value="all">Όλα τα statuses</option>
                {orderStatuses.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select
                value={String(orderRows)}
                onChange={(e) => {
                  const v = e.target.value === 'all' ? 'all' : Number(e.target.value);
                  setOrderRows(v as RowsPerPage);
                  setOrderPage(1);
                }}
                className="h-8 px-2 rounded-md border border-[var(--border)] text-xs"
              >
                <option value="10">10 / σελίδα</option>
                <option value="20">20 / σελίδα</option>
                <option value="50">50 / σελίδα</option>
                <option value="100">100 / σελίδα</option>
                <option value="all">Προβολή όλων</option>
              </select>
              <Tooltip content="Συνδυάστε platform/status/search για drill-down. Τα φίλτρα εφαρμόζονται πριν το sort και την pagination.">
                <span className="text-[11px] text-[var(--text-muted)]">Filters</span>
              </Tooltip>
            </div>
            {pagedOrders.length > 0 ? (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="data-table" style={{ minWidth: 580 }}>
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th
                        className="pb-2.5 font-medium text-[var(--text-muted)] cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleOrderSort('createdAt')}
                      >
                        <span className="inline-flex items-center gap-0.5 hover:text-[var(--text-primary)] transition-colors">
                          Ημ/νία <SortIcon active={orderSort.field === 'createdAt'} dir={orderSort.dir} />
                        </span>
                      </th>
                      <th className="pb-2.5 font-medium text-[var(--text-muted)]">Order</th>
                      <th
                        className="pb-2.5 font-medium text-[var(--text-muted)] cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleOrderSort('platform')}
                      >
                        <span className="inline-flex items-center gap-0.5 hover:text-[var(--text-primary)] transition-colors">
                          Platform <SortIcon active={orderSort.field === 'platform'} dir={orderSort.dir} />
                        </span>
                      </th>
                      <th className="pb-2.5 font-medium text-[var(--text-muted)]">Κανάλι</th>
                      <th className="pb-2.5 font-medium text-[var(--text-muted)]">Κατάσταση</th>
                      <th
                        className="pb-2.5 font-medium text-[var(--text-muted)] text-right cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleOrderSort('total')}
                      >
                        <span className="inline-flex items-center gap-0.5 hover:text-[var(--text-primary)] transition-colors">
                          Total <SortIcon active={orderSort.field === 'total'} dir={orderSort.dir} />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedOrders.map((o, i) => (
                      <tr
                        key={o.orderId + i}
                        className="border-b border-[var(--surface-2)] last:border-0 hover:bg-[var(--surface-2)] transition-colors"
                      >
                        <td className="py-2.5 text-[var(--text-muted)] whitespace-nowrap tabular-nums">
                          {o.createdAt
                            ? new Date(o.createdAt).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                            : '—'}
                        </td>
                        <td className="py-2.5 text-[var(--text-primary)] font-medium">{o.orderName || o.orderId}</td>
                        <td className="py-2.5">
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                            style={{ backgroundColor: `${PLATFORM_COLORS[o.platform] || token('--text-muted')}18`, color: PLATFORM_COLORS[o.platform] || token('--text-muted') }}
                          >
                            {PLATFORM_LABELS[o.platform] || o.platform}
                          </span>
                        </td>
                        <td className="py-2.5">
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                            style={{
                              backgroundColor: `${salesChannelColor(o.salesChannel || 'direct_eshop')}18`,
                              color: salesChannelColor(o.salesChannel || 'direct_eshop'),
                            }}
                            title={o.revenueIncluded === false ? `Εκτός core revenue: ${o.exclusionReason || 'review'}` : 'Included στο core revenue'}
                          >
                            {salesChannelLabel(o.salesChannel)}
                          </span>
                        </td>
                        <td className="py-2.5">
                          <OrderStatusBadge status={o.status} />
                        </td>
                        <td className="py-2.5 text-right text-[var(--text-primary)] font-semibold tabular-nums">€{o.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[var(--text-muted)] py-4 text-center">
                {rawOrdersLoading
                  ? 'Φόρτωση παραγγελιών για το επιλεγμένο διάστημα…'
                  : 'Δεν βρέθηκαν παραγγελίες με τα τρέχοντα φίλτρα'}
              </p>
            )}
            <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--text-muted)]">
              <span>Σύνολο: {filteredOrders.length} παραγγελίες</span>
              {orderRows !== 'all' && (
                <div className="inline-flex items-center gap-1">
                  <button
                    className="px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40"
                    disabled={safeOrderPage <= 1}
                    onClick={() => setOrderPage((p) => Math.max(1, p - 1))}
                  >
                    Προηγ.
                  </button>
                  <span>{safeOrderPage}/{orderTotalPages}</span>
                  <button
                    className="px-2 py-1 rounded border border-[var(--border)] disabled:opacity-40"
                    disabled={safeOrderPage >= orderTotalPages}
                    onClick={() => setOrderPage((p) => Math.min(orderTotalPages, p + 1))}
                  >
                    Επόμ.
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Footer CTA */}
      <div className="flex justify-center">
        <button
          onClick={() => { window.location.hash = '#data'; }}
          className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--nts-accent-text)] transition-colors"
        >
          Διαχείριση Connectors <ArrowRight size={12} />
        </button>
      </div>
    </PageCanvas>
  );
}
