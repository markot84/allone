import type { CommercialDecisionEvent } from './commercialDecisionMemory';
import type { EcommerceRawOrder } from './ecommerceRawOrders';
import { analyzePriceChangeImpact, type PriceChangeImpactRow } from './priceChangeImpact';
import { analyzeMarginCostImpact, type MarginCostImpactRow } from './marginCostImpact';
import {
  analyzeStockoutImpact,
  type StockoutImpactRow,
  type StockoutSkuContext,
} from './stockoutImpact';

export interface ErpHistoricalDecisionEventsInput {
  brandId: string;
  orders: EcommerceRawOrder[];
  periodFrom: string;
  periodTo: string;
  costBySku: Map<string, number>;
  skuNames?: Map<string, string>;
  stockBySku?: Map<string, StockoutSkuContext>;
  maxEvents?: number;
}

const MONTHLY_LOOKBACK_DAYS = 30;
const DEFAULT_MAX_EVENTS = 80;

function shiftIsoDate(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + deltaDays);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function monthWindows(periodFrom: string, periodTo: string): Array<{ startDate: string; endDate: string }> {
  const [fy, fm] = periodFrom.split('-').map(Number);
  const [ty, tm] = periodTo.split('-').map(Number);
  if (!fy || !fm || !ty || !tm || periodFrom > periodTo) return [];

  const windows: Array<{ startDate: string; endDate: string }> = [];
  let cursor = new Date(fy, fm - 1, 1);
  const last = new Date(ty, tm - 1, 1);

  while (cursor <= last) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const monthStart = `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const monthEndDt = new Date(y, m + 1, 0);
    const monthEnd = `${monthEndDt.getFullYear()}-${String(monthEndDt.getMonth() + 1).padStart(2, '0')}-${String(monthEndDt.getDate()).padStart(2, '0')}`;
    windows.push({
      startDate: monthStart > periodFrom ? monthStart : periodFrom,
      endDate: monthEnd < periodTo ? monthEnd : periodTo,
    });
    cursor = new Date(y, m + 1, 1);
  }

  return windows.filter((w) => w.startDate <= w.endDate);
}

function stableErpId(...parts: Array<string | number | undefined | null>): string {
  return parts
    .filter((p) => p !== undefined && p !== null && String(p).trim().length > 0)
    .map((p) =>
      String(p)
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[^\w-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
    )
    .join('__');
}

function formatPct(value: number | null | undefined): string {
  return value == null ? 'n/a' : `${value >= 0 ? '+' : ''}${value}%`;
}

function performanceFromRow(row: Pick<PriceChangeImpactRow | MarginCostImpactRow | StockoutImpactRow, 'before' | 'after' | 'revenueChangePct' | 'marginChangePct'> & {
  qtyChangePct?: number | null;
  priceBefore?: number;
  priceAfter?: number;
}): CommercialDecisionEvent['performance'] {
  return {
    periodRevenue: row.after.revenue,
    baselineRevenue: row.before.revenue,
    revenueChangePct: row.revenueChangePct,
    periodOrders: row.after.qty,
    baselineOrders: row.before.qty,
    ordersChangePct: row.qtyChangePct ?? null,
    campaignSpend: 0,
    periodRoas: null,
    periodMargin: row.after.margin,
    baselineMargin: row.before.margin,
    marginChangePct: row.marginChangePct,
    avgPriceBefore: row.priceBefore ?? row.before.avgPrice,
    avgPriceAfter: row.priceAfter ?? row.after.avgPrice,
    unitLabel: 'μονάδες SKU',
  };
}

function statusForWindow(endDate: string): CommercialDecisionEvent['status'] {
  return endDate < new Date().toISOString().slice(0, 10) ? 'completed' : 'detected';
}

function priceEvent(
  brandId: string,
  row: PriceChangeImpactRow,
  startDate: string,
  endDate: string
): CommercialDecisionEvent {
  const directionLabel = row.direction === 'increase' ? 'αύξηση τιμής' : 'μείωση τιμής';
  const now = new Date().toISOString();
  return {
    id: stableErpId('erp_history', 'price', brandId, row.sku, startDate),
    brandId,
    eventType: 'pricing',
    title: `ERP ${directionLabel}: ${row.sku}`,
    description: `${row.productName} · ${formatPct(row.changePct)} μεταβολή στη μέση τιμή πώλησης.`,
    source: 'erp_history',
    entityRef: { collection: 'erp_history', id: row.sku, type: 'price_change' },
    decisionDate: startDate,
    startDate,
    endDate,
    status: statusForWindow(endDate),
    scope: { skus: [row.sku], description: row.productName },
    changes: [
      { label: 'Μέση τιμή', before: row.priceBefore, after: row.priceAfter },
      { label: 'Μεταβολή τιμής', before: null, after: formatPct(row.changePct) },
      { label: 'Μεταβολή τζίρου', before: null, after: formatPct(row.revenueChangePct) },
      { label: 'Μεταβολή margin', before: null, after: formatPct(row.marginChangePct) },
    ],
    performance: performanceFromRow(row),
    hypothesis: 'Το ERP/order history δείχνει μεταβολή τιμής με μετρήσιμη επίδραση σε τζίρο και margin.',
    tags: ['erp', 'history', 'pricing', row.direction, row.verdict, row.confidence],
    createdAt: now,
    updatedAt: now,
  };
}

function marginEvent(
  brandId: string,
  row: MarginCostImpactRow,
  startDate: string,
  endDate: string
): CommercialDecisionEvent {
  const now = new Date().toISOString();
  const label =
    row.signal === 'cost_pressure'
      ? 'πίεση κόστους'
      : row.signal === 'margin_gain'
        ? 'βελτίωση margin'
        : 'πτώση margin';
  return {
    id: stableErpId('erp_history', 'margin', brandId, row.sku, startDate),
    brandId,
    eventType: 'margin',
    title: `ERP ${label}: ${row.sku}`,
    description: `${row.productName} · margin ${row.marginPctBefore ?? '—'}% → ${row.marginPctAfter ?? '—'}%.`,
    source: 'erp_history',
    entityRef: { collection: 'erp_history', id: row.sku, type: row.signal },
    decisionDate: startDate,
    startDate,
    endDate,
    status: statusForWindow(endDate),
    scope: { skus: [row.sku], description: row.productName },
    changes: [
      { label: 'Margin %', before: row.marginPctBefore, after: row.marginPctAfter },
      { label: 'Μεταβολή margin', before: null, after: formatPct(row.marginPctChange) },
      { label: 'Κόστος μονάδας', before: null, after: row.unitCost },
      { label: 'Μεταβολή τζίρου', before: null, after: formatPct(row.revenueChangePct) },
    ],
    performance: performanceFromRow(row),
    hypothesis: 'Το ERP/order history δείχνει μεταβολή κόστους ή margin που επηρέασε το εμπορικό αποτέλεσμα.',
    tags: ['erp', 'history', 'margin', row.signal, row.verdict, row.confidence],
    createdAt: now,
    updatedAt: now,
  };
}

function stockEvent(
  brandId: string,
  row: StockoutImpactRow,
  startDate: string,
  endDate: string
): CommercialDecisionEvent {
  const now = new Date().toISOString();
  return {
    id: stableErpId('erp_history', 'stock', brandId, row.sku, startDate),
    brandId,
    eventType: 'stock',
    title: `ERP πίεση αποθέματος: ${row.sku}`,
    description: `${row.productName} · ${row.daysOfCover ?? '—'} ημέρες κάλυψης, διαθέσιμο απόθεμα ${row.availableStock ?? '—'}.`,
    source: 'erp_history',
    entityRef: { collection: 'erp_history', id: row.sku, type: 'stock_pressure' },
    decisionDate: startDate,
    startDate,
    endDate,
    status: statusForWindow(endDate),
    scope: { skus: [row.sku], description: row.productName },
    changes: [
      { label: 'Ημέρες κάλυψης', before: null, after: row.daysOfCover },
      { label: 'Διαθέσιμο απόθεμα', before: null, after: row.availableStock },
      { label: 'Μεταβολή τεμαχίων πώλησης', before: null, after: formatPct(row.qtyChangePct) },
      { label: 'Μεταβολή τζίρου', before: null, after: formatPct(row.revenueChangePct) },
    ],
    performance: performanceFromRow(row),
    hypothesis: 'Το ERP/procurement history δείχνει πίεση αποθέματος που πιθανόν περιόρισε πωλήσεις και margin.',
    tags: ['erp', 'history', 'stock', row.verdict, row.confidence],
    createdAt: now,
    updatedAt: now,
  };
}

function rankEvent(event: CommercialDecisionEvent): number {
  const change = event.changes?.find((c) => c.label.includes('change'))?.after;
  const pct = typeof change === 'string' ? Number(change.replace(/[+%]/g, '')) : 0;
  return Number.isFinite(pct) ? Math.abs(pct) : 0;
}

export function buildErpHistoricalDecisionEvents(input: ErpHistoricalDecisionEventsInput): CommercialDecisionEvent[] {
  const { brandId, orders, periodFrom, periodTo, costBySku, skuNames, stockBySku } = input;
  if (!brandId || !periodFrom || !periodTo || orders.length === 0) return [];

  const scopedOrders = orders.filter((order) => {
    const day = (order.createdAt || '').slice(0, 10);
    return day >= shiftIsoDate(periodFrom, -MONTHLY_LOOKBACK_DAYS) && day <= periodTo;
  });

  const events: CommercialDecisionEvent[] = [];
  for (const window of monthWindows(periodFrom, periodTo)) {
    const base = {
      orders: scopedOrders,
      periodFrom: window.startDate,
      periodTo: window.endDate,
      lookbackDays: MONTHLY_LOOKBACK_DAYS,
      costBySku,
      skuNames,
    };

    const priceRows = analyzePriceChangeImpact(base).rows
      .filter((row) => row.verdict !== 'insufficient')
      .slice(0, 8);
    for (const row of priceRows) events.push(priceEvent(brandId, row, window.startDate, window.endDate));

    const marginRows = analyzeMarginCostImpact(base).rows
      .filter((row) => row.verdict !== 'insufficient')
      .slice(0, 8);
    for (const row of marginRows) events.push(marginEvent(brandId, row, window.startDate, window.endDate));

    if (stockBySku && stockBySku.size > 0) {
      const stockRows = analyzeStockoutImpact({ ...base, stockBySku }).rows
        .filter((row) => row.verdict !== 'insufficient')
        .slice(0, 8);
      for (const row of stockRows) events.push(stockEvent(brandId, row, window.startDate, window.endDate));
    }
  }

  const byId = new Map<string, CommercialDecisionEvent>();
  for (const event of events.sort((a, b) => rankEvent(b) - rankEvent(a))) {
    if (!byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()]
    .sort((a, b) => (b.decisionDate || '').localeCompare(a.decisionDate || ''))
    .slice(0, input.maxEvents ?? DEFAULT_MAX_EVENTS);
}
