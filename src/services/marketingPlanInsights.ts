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
  /** 'erp' = επίσημη πρόταση ανατροφοδοσίας (Megaventory), 'estimated' = εκτίμηση από ζήτηση/stock. */
  reorderQtySource: 'erp' | 'estimated';
  /** Σταθμισμένο μικτό περιθώριο (%) — από ERP pricing policy, όταν υπάρχει. */
  marginPct?: number;
  /** Σταθμισμένες ημέρες επάρκειας αποθέματος — από ERP, όταν υπάρχει. */
  daysOfCover?: number;
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
  reorderQtySource: 'erp' | 'estimated';
  marginPct?: number;
  daysOfCover?: number;
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

// SKU signal shape — mirrors the useful subset of ProcurementSignal (ERP/procurement).
// Διατηρείται τοπικό για αποφυγή circular dep με τα hooks.
type SkuSignal = {
  available_stock?: number;
  category?: string;
  description?: string;
  supplier?: string;
  flow_group?: string;
  margin_pct?: number;
  days_of_cover?: number;
  replenishment_qty?: number;
  replenishment_value?: number;
  tied_capital?: number;
  avg_sale_price?: number;
  list_price?: number;
  cost_unit?: number;
  lifetime_qty?: number;
  annual_revenue?: number;
  status?: string;
};

type InventoryEntry = {
  stock: number;
  category: string;
  subcategory: string;
  brand: string;
  price: number;
  name: string;
  /** ERP enrichment (optional) */
  marginPct?: number;
  daysOfCover?: number;
  replenishmentQty?: number;
  tiedCapital?: number;
};

type ProductLookup = {
  bySku: Map<string, InventoryEntry>;
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
  replenishmentQty: number;
  tiedCapital: number;
  /** Margin σταθμισμένο με revenue */
  marginWeightedRev: number;
  marginRevBase: number;
  /** Days-of-cover σταθμισμένο με τεμάχια */
  coverWeightedUnits: number;
  coverUnitsBase: number;
  /** SKU που έχουν ήδη μετρηθεί για stock-level πεδία (αποφυγή διπλομέτρησης ανά γραμμή) */
  seenSkus: Set<string>;
};

type SkuAccumulator = {
  sku: string;
  name: string;
  category: string;
  brand: string;
  revenue: number;
  units: number;
  stock: number;
  marginPct?: number;
  daysOfCover?: number;
  replenishmentQty?: number;
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

function nf(value: number): string {
  return Math.round(value).toLocaleString('el-GR');
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
  const bySku = new Map<string, InventoryEntry>();
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

  // Procurement/ERP signals: authoritative για stock + category/supplier/margin/cover.
  // (Megaventory/procurement uploads → ΚΑΤΗΓΟΡΙΑ/ΠΡΟΜΗΘΕΥΤΗΣ/ΟΜΑΔΑ_ΡΟΗΣ κ.λπ.)
  for (const [sku, sig] of Object.entries(procurementSignals)) {
    if (sig.available_stock == null) continue;
    const key = normalizeKey(sku);
    const existing = bySku.get(key);
    const sigCategory = sig.category?.trim() || '';
    const sigBrand = sig.supplier?.trim() || '';
    const sigSub = sig.flow_group?.trim() || '';
    const sigPrice = sig.avg_sale_price ?? sig.list_price ?? sig.cost_unit ?? 0;
    const enrich = {
      marginPct: sig.margin_pct,
      daysOfCover: sig.days_of_cover,
      replenishmentQty: sig.replenishment_qty,
      tiedCapital: sig.tied_capital,
    };
    if (existing) {
      bySku.set(key, {
        ...existing,
        stock: sig.available_stock,
        // Συμπληρώνουμε από signal μόνο ό,τι λείπει από το product catalog.
        category: existing.category !== 'Uncategorized' ? existing.category : sigCategory || 'Uncategorized',
        subcategory: existing.subcategory || sigSub,
        brand: existing.brand || sigBrand,
        price: existing.price || sigPrice,
        ...enrich,
      });
    } else {
      bySku.set(key, {
        stock: sig.available_stock,
        category: sigCategory || 'Uncategorized',
        subcategory: sigSub,
        brand: sigBrand,
        price: sigPrice,
        name: sig.description?.trim() || sku,
        ...enrich,
      });
    }
  }

  return { bySku, byProductId };
}

function resolveProduct(
  lookup: ProductLookup,
  sku?: string,
  productId?: string
): InventoryEntry | undefined {
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

  const signals = input.procurementSignals ?? {};
  const signalKeys = new Set(Object.keys(signals).map((k) => normalizeKey(k)));
  const hasErp = signalKeys.size > 0;

  // ── 1. Ζήτηση από τις περσινές παραγγελίες (πάντα) ──────────────────────────
  const demandBySku = new Map<string, { units: number; revenue: number }>();
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
      const skuKey = normalizeKey((line as any).sku);
      const rev = lineRevenue(quantity, Number((line as any).price ?? 0), (line as any).rowTotal);
      if (skuKey) {
        const d = demandBySku.get(skuKey) ?? { units: 0, revenue: 0 };
        d.units += quantity;
        d.revenue += rev;
        demandBySku.set(skuKey, d);
        if (hasErp && signalKeys.has(skuKey)) matchedLines += 1;
      }
    }
  }

  // ── 2. Reorder plan ─────────────────────────────────────────────────────────
  // ERP-driven όταν υπάρχουν procurement signals (αυθεντική πηγή αποθέματος + ανατροφοδοσίας),
  // αλλιώς fallback στην order-driven λογική (catalog lookup) για brands χωρίς ERP.
  let reorderPlan: MarketingPlanReorderGroup[];
  let skuSuggestions: MarketingPlanSkuSuggestion[];
  let totalSkusCovered: number;
  let inventoryCoveragePct: number;

  if (hasErp) {
    const built = buildErpDrivenReorder(signals, demandBySku);
    reorderPlan = built.reorderPlan;
    skuSuggestions = built.skuSuggestions;
    totalSkusCovered = built.totalSkus;
    inventoryCoveragePct = 100;
  } else {
    const built = buildOrderDrivenReorder(input.lastYearOrders, lookup, lastYearFromDate, lastYearToDate);
    reorderPlan = built.reorderPlan;
    skuSuggestions = built.skuSuggestions;
    matchedLines = built.matchedLines;
    totalSkusCovered = lookup.bySku.size;
    inventoryCoveragePct = lookup.bySku.size > 0 ? built.lineItemCoveragePct : 0;
  }

  const lineItemCoveragePct = lines > 0 ? Math.round((matchedLines / lines) * 100) : 0;
  const notes: string[] = [];
  if (lines === 0) notes.push('Δεν βρέθηκαν γραμμές προϊόντων για την αντίστοιχη περσινή περίοδο.');
  if (hasErp) {
    if (lines > 0 && lineItemCoveragePct < 40) {
      notes.push('Μερική αντιστοίχιση περσινών πωλήσεων με ERP SKU — η πρόταση παραγγελίας βασίζεται κυρίως στα σήματα ERP (απόθεμα & ανατροφοδοσία).');
    }
  } else {
    if (lines > 0 && lineItemCoveragePct < 50) notes.push('Χαμηλή αντιστοίχιση SKU με τρέχον inventory.');
    if (lookup.bySku.size === 0) notes.push('Δεν φορτώθηκε inventory για υπολογισμό αποθέματος.');
  }

  const level: MarketingPlanDataQuality['level'] = hasErp
    ? reorderPlan.length > 0
      ? lineItemCoveragePct >= 50
        ? 'strong'
        : 'partial'
      : 'weak'
    : lines > 0 && lineItemCoveragePct >= 70
      ? 'strong'
      : lines > 0 && lineItemCoveragePct >= 30
        ? 'partial'
        : 'weak';

  return {
    period: input.period,
    evidence: { lastYearFromDate, lastYearToDate, revenue: money(revenue), orders, units: Math.round(units), aov: orders > 0 ? money(revenue / orders) : 0, lines, matchedLines },
    reorderPlan,
    skuSuggestions,
    dataQuality: { level, lineItemCoveragePct, inventoryCoveragePct, notes },
    totalSkusCovered,
  };
}

// ── ERP-driven reorder: τα procurement signals είναι το «σύμπαν» (κατηγορία/απόθεμα/ανατροφοδοσία),
//    με τις περσινές πωλήσεις ως enrichment ζήτησης (join ανά SKU). ───────────────────────────
function buildErpDrivenReorder(
  signals: Record<string, SkuSignal>,
  demandBySku: Map<string, { units: number; revenue: number }>
): { reorderPlan: MarketingPlanReorderGroup[]; skuSuggestions: MarketingPlanSkuSuggestion[]; totalSkus: number } {
  type ErpGroup = {
    category: string; subcategory: string; brand: string;
    revenue: number; units: number; stock: number; stockValue: number;
    replenishmentQty: number; replenishmentValue: number; tiedCapital: number;
    marginWeighted: number; marginBase: number;
    coverWeighted: number; coverBase: number;
  };
  const groups = new Map<string, ErpGroup>();
  const skuRows: { row: MarketingPlanSkuSuggestion; sortValue: number }[] = [];
  let totalSkus = 0;

  for (const [rawSku, sig] of Object.entries(signals)) {
    // Αγνόησε ανενεργά SKU χωρίς απόθεμα/ανατροφοδοσία/κατηγορία.
    if (sig.available_stock == null && (sig.replenishment_qty ?? 0) <= 0 && !sig.category) continue;
    totalSkus += 1;

    const skuKey = normalizeKey(rawSku);
    const category = sig.category?.trim() || 'Λοιπά';
    const subcategory = sig.flow_group?.trim() || '';
    const brand = sig.supplier?.trim() || '';
    const stock = Math.max(0, Number(sig.available_stock ?? 0) || 0);
    const repl = Math.max(0, Math.round(Number(sig.replenishment_qty ?? 0) || 0));
    const replValue = Math.max(0, Number(sig.replenishment_value ?? 0) || 0);
    const price = Number(sig.avg_sale_price ?? sig.list_price ?? sig.cost_unit ?? 0) || 0;
    const margin = sig.margin_pct;
    const cover = sig.days_of_cover;
    const tied = Number(sig.tied_capital ?? 0) || 0;
    const demand = demandBySku.get(skuKey);
    const lyUnits = demand?.units ?? 0;
    const lyRev = demand?.revenue ?? 0;

    const key = `${category}||${subcategory}||${brand}`;
    const g = groups.get(key) ?? {
      category, subcategory, brand,
      revenue: 0, units: 0, stock: 0, stockValue: 0,
      replenishmentQty: 0, replenishmentValue: 0, tiedCapital: 0,
      marginWeighted: 0, marginBase: 0, coverWeighted: 0, coverBase: 0,
    };
    g.revenue += lyRev;
    g.units += lyUnits;
    g.stock += stock;
    g.stockValue += stock * price;
    g.replenishmentQty += repl;
    g.replenishmentValue += replValue;
    g.tiedCapital += tied;
    // Margin σταθμισμένο με αξία (περσινή πώληση ή αξία αποθέματος), cover σταθμισμένο με απόθεμα.
    const mw = lyRev > 0 ? lyRev : stock * price > 0 ? stock * price : 1;
    if (margin != null) { g.marginWeighted += margin * mw; g.marginBase += mw; }
    if (cover != null) { const cb = Math.max(1, stock); g.coverWeighted += cover * cb; g.coverBase += cb; }
    groups.set(key, g);

    // SKU-level πρόταση: ERP ανατροφοδοσία ή ζήτηση που ξεπερνά το απόθεμα.
    const needsReorder = repl > 0 || (lyUnits > 0 && stock < lyUnits);
    if (needsReorder) {
      const qty = repl > 0 ? repl : reorderQty(lyUnits, stock);
      if (qty > 0) {
        skuRows.push({
          row: {
            sku: rawSku,
            name: sig.description?.trim() || rawSku,
            category,
            brand,
            lastYearUnits: Math.round(lyUnits),
            lastYearRevenue: money(lyRev),
            currentStock: Math.round(stock),
            estimatedReorderQty: qty,
            reorderQtySource: repl > 0 ? 'erp' : 'estimated',
            marginPct: margin != null ? +margin.toFixed(1) : undefined,
            daysOfCover: cover != null ? Math.round(cover) : undefined,
            confidence: repl > 0 ? 'high' : lyUnits >= 4 ? 'medium' : 'low',
          },
          sortValue: replValue || lyRev || qty * price,
        });
      }
    }
  }

  const reorderPlan = [...groups.values()]
    .map((g) => {
      const erpQty = Math.round(g.replenishmentQty);
      const useErp = erpQty > 0;
      const qty = useErp ? erpQty : reorderQty(g.units, g.stock);
      const daysOfCover = g.coverBase > 0 ? Math.round(g.coverWeighted / g.coverBase) : undefined;
      const marginPct = g.marginBase > 0 ? +(g.marginWeighted / g.marginBase).toFixed(1) : undefined;
      const avgUnitCost = g.stock > 0 && g.stockValue > 0 ? g.stockValue / g.stock : 0;
      const action: ReorderAction =
        useErp || (g.units > 0 && g.stock < g.units)
          ? 'increase'
          : daysOfCover != null && daysOfCover > 120
            ? 'reduce'
            : g.units > 0 || g.stock > 0
              ? 'maintain'
              : 'avoid';
      const marginNote = marginPct != null ? ` Περιθώριο ~${marginPct}%.` : '';
      const coverNote = daysOfCover != null ? ` Επάρκεια ~${daysOfCover} ημ.` : '';
      let baseRationale: string;
      if (useErp) {
        baseRationale = `Το ERP προτείνει ανατροφοδοσία ~${nf(erpQty)} τεμ.` + (g.units > 0 ? ` Πέρυσι πούλησε ${nf(g.units)} τεμ.` : '');
      } else if (action === 'increase') {
        baseRationale = `Πέρυσι ${nf(g.units)} τεμ. έναντι ${nf(g.stock)} σε απόθεμα — πρότεινε παραγγελία ~${nf(qty)} τεμ.`;
      } else if (action === 'reduce') {
        baseRationale = 'Επαρκές απόθεμα για την περσινή ζήτηση — εστίαση σε marketing/προώθηση, όχι παραγγελία.';
      } else if (action === 'maintain') {
        baseRationale = 'Το απόθεμα καλύπτει περίπου την περσινή ζήτηση — παρακολούθηση χωρίς άμεση παραγγελία.';
      } else {
        baseRationale = 'Χωρίς ζήτηση/απόθεμα — χαμηλή προτεραιότητα.';
      }
      const confidence: 'high' | 'medium' | 'low' = useErp || g.units >= 8 ? 'high' : g.units > 0 || g.stock > 0 ? 'medium' : 'low';
      return {
        key: `${g.category}-${g.subcategory}-${g.brand}`,
        category: g.category,
        subcategory: g.subcategory,
        brand: g.brand,
        lastYearRevenue: money(g.revenue),
        lastYearUnits: Math.round(g.units),
        currentStock: Math.round(g.stock),
        currentStockValue: money(g.stockValue),
        estimatedReorderQty: qty,
        estimatedReorderValue: money(qty * avgUnitCost),
        reorderQtySource: (useErp ? 'erp' : 'estimated') as 'erp' | 'estimated',
        marginPct,
        daysOfCover,
        action,
        confidence,
        rationale: `${baseRationale}${marginNote}${coverNote}`,
      };
    })
    // Προτεραιότητα: ομάδες που χρειάζονται παραγγελία πρώτα, μετά κατά αξία ανατροφοδοσίας/ζήτησης.
    .sort((a, b) => {
      const ai = a.action === 'increase' ? 1 : 0;
      const bi = b.action === 'increase' ? 1 : 0;
      if (ai !== bi) return bi - ai;
      return (b.estimatedReorderValue || b.lastYearRevenue) - (a.estimatedReorderValue || a.lastYearRevenue);
    })
    .slice(0, 16);

  const skuSuggestions = skuRows
    .sort((a, b) => b.sortValue - a.sortValue)
    .slice(0, 30)
    .map((r) => r.row);

  return { reorderPlan, skuSuggestions, totalSkus };
}

// ── Order-driven reorder (fallback χωρίς ERP): join περσινών line items με catalog lookup. ──
function buildOrderDrivenReorder(
  lastYearOrders: EcommerceRawOrder[],
  lookup: ProductLookup,
  fromDate: string,
  toDate: string
): { reorderPlan: MarketingPlanReorderGroup[]; skuSuggestions: MarketingPlanSkuSuggestion[]; matchedLines: number; lineItemCoveragePct: number } {
  const groupMap = new Map<string, GroupAccumulator>();
  const skuMap = new Map<string, SkuAccumulator>();
  let lines = 0;
  let matchedLines = 0;

  for (const order of lastYearOrders) {
    const orderDay = dayKey(order.createdAt);
    if (orderDay < fromDate || orderDay > toDate) continue;
    if (!isEcommerceOrderDataAnalysisIncluded(order)) continue;
    for (const line of order.lineItems) {
      if (isEcommerceDemoLineItem(line)) continue;
      const quantity = Number(line.quantity ?? 0) || 0;
      if (quantity <= 0) continue;
      lines += 1;
      const resolved = resolveProduct(lookup, line.sku, line.productId);
      if (resolved) matchedLines += 1;
      const category = resolved?.category || 'Uncategorized';
      const subcategory = resolved?.subcategory || '';
      const brand = resolved?.brand || '';
      const stock = resolved?.stock ?? 0;
      const price = resolved?.price ?? Number((line as any).price ?? 0);
      const rev = lineRevenue(quantity, price, (line as any).rowTotal);
      const sku = String((line as any).sku || '');
      const skuKey = normalizeKey(sku);
      const groupKey = `${category}||${subcategory}||${brand}`;
      const group =
        groupMap.get(groupKey) ?? {
          category, subcategory, brand,
          revenue: 0, units: 0, stock: 0, stockValue: 0,
          replenishmentQty: 0, tiedCapital: 0,
          marginWeightedRev: 0, marginRevBase: 0,
          coverWeightedUnits: 0, coverUnitsBase: 0,
          seenSkus: new Set<string>(),
        };
      group.revenue += rev;
      group.units += quantity;
      if (resolved?.marginPct != null) { group.marginWeightedRev += resolved.marginPct * rev; group.marginRevBase += rev; }
      if (resolved?.daysOfCover != null) { group.coverWeightedUnits += resolved.daysOfCover * quantity; group.coverUnitsBase += quantity; }
      const stockDedupKey = skuKey || `__line_${lines}`;
      if (!group.seenSkus.has(stockDedupKey)) {
        group.seenSkus.add(stockDedupKey);
        group.stock += stock;
        group.stockValue += stock * (resolved?.price ?? 0);
        if (resolved?.replenishmentQty != null) group.replenishmentQty += resolved.replenishmentQty;
        if (resolved?.tiedCapital != null) group.tiedCapital += resolved.tiedCapital;
      }
      groupMap.set(groupKey, group);

      if (skuKey) {
        const row = skuMap.get(skuKey) ?? {
          sku,
          name: resolved?.name || (line as any).title || (line as any).name || sku,
          category, brand,
          revenue: 0, units: 0, stock,
          marginPct: resolved?.marginPct,
          daysOfCover: resolved?.daysOfCover,
          replenishmentQty: resolved?.replenishmentQty,
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
      const action = actionForGap(group.units, group.stock);
      const erpQty = Math.round(group.replenishmentQty);
      const useErp = erpQty > 0;
      const qty = useErp ? erpQty : reorderQty(group.units, group.stock);
      const confidence = confidenceFor({ units: group.units, revenue: group.revenue, stock: group.stock, matched: group.category !== 'Uncategorized' });
      const avgUnitCost = group.stock > 0 && group.stockValue > 0 ? group.stockValue / group.stock : 0;
      const marginPct = group.marginRevBase > 0 ? +(group.marginWeightedRev / group.marginRevBase).toFixed(1) : undefined;
      const daysOfCover = group.coverUnitsBase > 0 ? Math.round(group.coverWeightedUnits / group.coverUnitsBase) : undefined;
      const marginNote = marginPct != null ? ` Περιθώριο ~${marginPct}%.` : '';
      const coverNote = daysOfCover != null ? ` Επάρκεια ~${daysOfCover} ημ.` : '';
      const baseRationale =
        action === 'increase'
          ? 'Πέρυσι πούλησε περισσότερο από το διαθέσιμο stock — χρειάζεται παραγγελία πριν την περίοδο.'
          : action === 'maintain'
            ? 'Η ζήτηση πέρυσι είναι κοντά στο τρέχον stock — συντηρητική κάλυψη.'
            : action === 'reduce'
              ? 'Το stock καλύπτει την περσινή ζήτηση — εστίαση στο marketing, όχι παραγγελία.'
              : 'Δεν υπάρχει αρκετή περσινή ζήτηση για παραγγελία.';
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
        reorderQtySource: (useErp ? 'erp' : 'estimated') as 'erp' | 'estimated',
        marginPct,
        daysOfCover,
        action,
        confidence,
        rationale: `${baseRationale}${marginNote}${coverNote}`,
      };
    })
    .sort((a, b) => b.lastYearRevenue - a.lastYearRevenue || (b.marginPct ?? 0) - (a.marginPct ?? 0))
    .slice(0, 16);

  const skuSuggestions = [...skuMap.values()]
    .map((row) => {
      const erpQty = row.replenishmentQty != null ? Math.round(row.replenishmentQty) : 0;
      const useErp = erpQty > 0;
      return {
        sku: row.sku,
        name: row.name,
        category: row.category,
        brand: row.brand,
        lastYearUnits: Math.round(row.units),
        lastYearRevenue: money(row.revenue),
        currentStock: Math.round(row.stock),
        estimatedReorderQty: useErp ? erpQty : reorderQty(row.units, row.stock),
        reorderQtySource: (useErp ? 'erp' : 'estimated') as 'erp' | 'estimated',
        marginPct: row.marginPct != null ? +row.marginPct.toFixed(1) : undefined,
        daysOfCover: row.daysOfCover != null ? Math.round(row.daysOfCover) : undefined,
        confidence: confidenceFor({ units: row.units, revenue: row.revenue, stock: row.stock, matched: row.category !== 'Uncategorized' }),
      };
    })
    .filter((row) => row.confidence !== 'low' && row.estimatedReorderQty > 0)
    .sort((a, b) => b.lastYearRevenue - a.lastYearRevenue)
    .slice(0, 30);

  const lineItemCoveragePct = lines > 0 ? Math.round((matchedLines / lines) * 100) : 0;
  return { reorderPlan, skuSuggestions, matchedLines, lineItemCoveragePct };
}
