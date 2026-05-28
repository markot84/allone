import type { Product } from '../types';
import {
  type EcommerceRawOrder,
  isEcommerceOrderDataAnalysisIncluded,
  isEcommerceDemoLineItem,
} from './ecommerceRawOrders';
import type { MarketingPlanPresetId } from './marketingPlanEngine';

export type MarketingPlanPeriod = {
  presetId: MarketingPlanPresetId;
  periodLabel: string;
  fromDate: string;
  toDate: string;
};

export type MarketingPlanDataQuality = {
  level: 'strong' | 'partial' | 'weak';
  lineItemCoveragePct: number;
  inventoryCoveragePct: number;
  notes: string[];
};

export type MarketingPlanEvidence = {
  lastYearFromDate: string;
  lastYearToDate: string;
  revenue: number;
  orders: number;
  units: number;
  aov: number;
  lines: number;
  matchedLines: number;
};

export type ReorderAction = 'increase' | 'maintain' | 'reduce' | 'avoid';

export type MarketingPlanReorderGroup = {
  key: string;
  category: string;
  subcategory: string;
  brand: string;
  lastYearRevenue: number;
  lastYearUnits: number;
  currentStock: number;
  currentStockValue: number;
  estimatedReorderQty: number;
  estimatedReorderValue: number;
  action: ReorderAction;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
};

export type MarketingPlanSkuSuggestion = {
  sku: string;
  name: string;
  category: string;
  brand: string;
  lastYearUnits: number;
  lastYearRevenue: number;
  currentStock: number;
  estimatedReorderQty: number;
  confidence: 'high' | 'medium' | 'low';
};

export type MarketingPlanInsight = {
  period: MarketingPlanPeriod;
  evidence: MarketingPlanEvidence;
  reorderPlan: MarketingPlanReorderGroup[];
  skuSuggestions: MarketingPlanSkuSuggestion[];
  dataQuality: MarketingPlanDataQuality;
  totalSkusCovered: number;
};

// Minimal SKU signal shape — avoids importing from hooks (circular dep risk)
type SkuSignal = { available_stock?: number };

type ProductLookup = {
  bySku: Map<string, { stock: number; category: string; subcategory: string; brand: string; price: number; name: string }>;
  byProductId: Map<string, Product>;
};

type GroupAccumulator = {
  category: string;
  subcategory: string;
  brand: string;
  revenue: number;
  units: number;
  stock: number;
  stockValue: number;
};

type SkuAccumulator = {
  sku: string;
  name: string;
  category: string;
  brand: string;
  revenue: number;
  units: number;
  stock: number;
};

export function shiftIsoDateByYears(date: string, years: number): string {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function dayKey(value: string): string {
  return value.slice(0, 10);
}

function normalizeKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function productStock(product: Product | undefined): number {
  if (!product) return 0;
  return (
    Number((product as any).available_stock ?? (product as any).stock_on_hand ?? (product as any).stock_level ?? 0) || 0
  );
}

function productPrice(product: Product | undefined): number {
  return Number((product as any).cost_price ?? (product as any).price ?? 0) || 0;
}

/** Build a unified SKU lookup from products collection + procurement signals (ALL SKUs, no cap). */
export function buildInventoryLookupFromSignals(
  products: Product[],
  procurementSignals: Record<string, SkuSignal> = {}
): ProductLookup {
  const bySku = new Map<string, { stock: number; category: string; subcategory: string; brand: string; price: number; name: string }>();
  const byProductId = new Map<string, Product>();

  for (const product of products) {
    const sku = normalizeKey((product as any).sku);
    const id = normalizeKey(product.id);
    if (sku) {
      bySku.set(sku, {
        stock: productStock(product),
        category: (product as any).category || 'Uncategorized',
        subcategory: (product as any).subcategory || '',
        brand: (product as any).brand || '',
        price: productPrice(product),
        name: (product as any).name || sku,
      });
    }
    if (id) byProductId.set(id, product);
  }

  // Procurement signals override stock (ERP is authoritative)
  for (const [sku, sig] of Object.entries(procurementSignals)) {
    if (sig.available_stock == null) continue;
    const key = normalizeKey(sku);
    const existing = bySku.get(key);
    if (existing) {
      bySku.set(key, { ...existing, stock: sig.available_stock });
    } else {
      bySku.set(key, { stock: sig.available_stock, category: 'Uncategorized', subcategory: '', brand: '', price: 0, name: sku });
    }
  }

  return { bySku, byProductId };
}

function resolveProduct(
  lookup: ProductLookup,
  sku?: string,
  productId?: string
): { stock: number; category: string; subcategory: string; brand: string; price: number; name: string } | undefined {
  const skuKey = normalizeKey(sku);
  if (skuKey && lookup.bySku.has(skuKey)) return lookup.bySku.get(skuKey)!;
  const idKey = normalizeKey(productId);
  if (idKey) {
    const p = lookup.byProductId.get(idKey);
    if (p) {
      return {
        stock: productStock(p),
        category: (p as any).category || 'Uncategorized',
        subcategory: (p as any).subcategory || '',
        brand: (p as any).brand || '',
        price: productPrice(p),
        name: (p as any).name || idKey,
      };
    }
  }
  return undefined;
}

function lineRevenue(quantity: number, price: number, rowTotal?: number): number {
  const total = Number(rowTotal);
  if (Number.isFinite(total) && total > 0) return total;
  return Math.max(0, quantity * (Number(price) || 0));
}

function actionForGap(units: number, stock: number): ReorderAction {
  if (units <= 0) return 'avoid';
  if (stock <= units * 0.35) return 'increase';
  if (stock <= units * 0.9) return 'maintain';
  return 'reduce';
}

function confidenceFor(input: { units: number; revenue: number; stock: number; matched: boolean }): 'high' | 'medium' | 'low' {
  if (!input.matched) return 'low';
  if (input.units >= 8 && input.revenue > 0 && input.stock >= 0) return 'high';
  if (input.units > 0 && input.revenue > 0) return 'medium';
  return 'low';
}

function reorderQty(units: number, stock: number): number {
  if (units <= 0) return 0;
  return Math.max(0, Math.ceil(units * 1.1 - stock));
}

export function buildMarketingPlanInsight(input: {
  period: MarketingPlanPeriod;
  lastYearOrders: EcommerceRawOrder[];
  inventoryProducts?: Product[];
  procurementSignals?: Record<string, SkuSignal>;
}): MarketingPlanInsight {
  const lastYearFromDate = shiftIsoDateByYears(input.period.fromDate, -1);
  const lastYearToDate = shiftIsoDateByYears(input.period.toDate, -1);

  const lookup = buildInventoryLookupFromSignals(
    input.inventoryProducts ?? [],
    input.procurementSignals ?? {}
  );

  const groupMap = new Map<string, GroupAccumulator>();
  const skuMap = new Map<string, SkuAccumulator>();
  let revenue = 0;
  let orders = 0;
  let units = 0;
  let lines = 0;
  let matchedLines = 0;

  for (const order of input.lastYearOrders) {
    const orderDay = dayKey(order.createdAt);
    if (orderDay < lastYearFromDate || orderDay > lastYearToDate) continue;
    if (!isEcommerceOrderDataAnalysisIncluded(order)) continue;
    orders += 1;
    revenue += Number(order.total) || 0;
    for (const line of order.lineItems) {
      if (isEcommerceDemoLineItem(line)) continue;
      const quantity = Number(line.quantity ?? 0) || 0;
      if (quantity <= 0) continue;
      lines += 1;
      units += quantity;
      const resolved = resolveProduct(lookup, line.sku, line.productId);
      if (resolved) matchedLines += 1;
      const category = resolved?.category || 'Uncategorized';
      const subcategory = resolved?.subcategory || '';
      const brand = resolved?.brand || '';
      const stock = resolved?.stock ?? 0;
      const price = resolved?.price ?? Number((line as any).price ?? 0);
      const rev = lineRevenue(quantity, price, (line as any).rowTotal);
      const groupKey = `${category}||${subcategory}||${brand}`;
      const group = groupMap.get(groupKey) ?? { category, subcategory, brand, revenue: 0, units: 0, stock: 0, stockValue: 0 };
      group.revenue += rev;
      group.units += quantity;
      group.stock += stock;
      group.stockValue += stock * (resolved?.price ?? 0);
      groupMap.set(groupKey, group);

      const sku = (resolved as any)?.sku || String((line as any).sku || '');
      const skuKey = normalizeKey(sku);
      if (skuKey) {
        const row = skuMap.get(skuKey) ?? {
          sku,
          name: resolved?.name || (line as any).title || (line as any).name || sku,
          category,
          brand,
          revenue: 0,
          units: 0,
          stock,
        };
        row.revenue += rev;
        row.units += quantity;
        row.stock = stock;
        skuMap.set(skuKey, row);
      }
    }
  }

  const reorderPlan = [...groupMap.values()]
    .map((group) => {
      const qty = reorderQty(group.units, group.stock);
      const action = actionForGap(group.units, group.stock);
      const confidence = confidenceFor({ units: group.units, revenue: group.revenue, stock: group.stock, matched: group.category !== 'Uncategorized' });
      const avgUnitCost = group.stock > 0 && group.stockValue > 0 ? group.stockValue / group.stock : 0;
      return {
        key: `${group.category}-${group.subcategory}-${group.brand}`,
        category: group.category,
        subcategory: group.subcategory,
        brand: group.brand,
        lastYearRevenue: money(group.revenue),
        lastYearUnits: Math.round(group.units),
        currentStock: Math.round(group.stock),
        currentStockValue: money(group.stockValue),
        estimatedReorderQty: qty,
        estimatedReorderValue: money(qty * avgUnitCost),
        action,
        confidence,
        rationale:
          action === 'increase'
            ? 'Πέρυσι πούλησε περισσότερο από το διαθέσιμο stock — χρειάζεται παραγγελία πριν την περίοδο.'
            : action === 'maintain'
              ? 'Η ζήτηση πέρυσι είναι κοντά στο τρέχον stock — συντηρητική κάλυψη.'
              : action === 'reduce'
                ? 'Το stock καλύπτει την περσινή ζήτηση — εστίαση στο marketing, όχι παραγγελία.'
                : 'Δεν υπάρχει αρκετή περσινή ζήτηση για παραγγελία.',
      };
    })
    .sort((a, b) => b.lastYearRevenue - a.lastYearRevenue)
    .slice(0, 16);

  const skuSuggestions = [...skuMap.values()]
    .map((row) => ({
      sku: row.sku,
      name: row.name,
      category: row.category,
      brand: row.brand,
      lastYearUnits: Math.round(row.units),
      lastYearRevenue: money(row.revenue),
      currentStock: Math.round(row.stock),
      estimatedReorderQty: reorderQty(row.units, row.stock),
      confidence: confidenceFor({ units: row.units, revenue: row.revenue, stock: row.stock, matched: row.category !== 'Uncategorized' }),
    }))
    .filter((row) => row.confidence !== 'low' && row.estimatedReorderQty > 0)
    .sort((a, b) => b.lastYearRevenue - a.lastYearRevenue)
    .slice(0, 30);

  const lineItemCoveragePct = lines > 0 ? Math.round((matchedLines / lines) * 100) : 0;
  const inventoryCoveragePct = (lookup.bySku.size + lookup.byProductId.size) > 0 ? lineItemCoveragePct : 0;
  const notes: string[] = [];
  if (lines === 0) notes.push('Δεν βρέθηκαν γραμμές προϊόντων για την αντίστοιχη περσινή περίοδο.');
  if (lineItemCoveragePct < 50 && lines > 0) notes.push('Χαμηλή αντιστοίχιση SKU με τρέχον inventory.');
  if (lookup.bySku.size === 0 && Object.keys(input.procurementSignals ?? {}).length === 0) {
    notes.push('Δεν φορτώθηκε inventory για υπολογισμό αποθέματος.');
  }
  const level: MarketingPlanDataQuality['level'] =
    lines > 0 && lineItemCoveragePct >= 70 ? 'strong' : lines > 0 && lineItemCoveragePct >= 30 ? 'partial' : 'weak';

  return {
    period: input.period,
    evidence: { lastYearFromDate, lastYearToDate, revenue: money(revenue), orders, units: Math.round(units), aov: orders > 0 ? money(revenue / orders) : 0, lines, matchedLines },
    reorderPlan,
    skuSuggestions,
    dataQuality: { level, lineItemCoveragePct, inventoryCoveragePct, notes },
    totalSkusCovered: lookup.bySku.size,
  };
}
