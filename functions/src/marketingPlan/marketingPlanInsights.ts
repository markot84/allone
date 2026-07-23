/**
 * PER-157 — server-side copy of src/services/marketingPlanInsights.ts. BYTE-FAITHFUL below the
 * import header (the ONLY edit). Do not hand-edit the logic; keep it in lockstep with the client
 * file and rely on __tests__/unit/marketingPlanInsightsParity.test.ts (vs the #1 baseline).
 */
import type { Product, EcommerceRawOrder, MarketingPlanPresetId } from './shared';
import { isEcommerceOrderDataAnalysisIncluded, isEcommerceDemoLineItem } from './shared';

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
  /** 'erp' = official replenishment suggestion (Megaventory), 'estimated' = estimate from demand/stock. */
  reorderQtySource: 'erp' | 'estimated';
  /** Weighted gross margin (%) — from ERP pricing policy, when available. */
  marginPct?: number;
  /** Weighted days of stock cover — from ERP, when available. */
  daysOfCover?: number;
  action: ReorderAction;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
  /** The group's analyzed SKUs (capped) — for expandable card view. */
  skus?: MarketingPlanSkuSuggestion[];
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
  /** Sibling variants merged into this row (declared parent-SKU grouping). */
  variantCount?: number;
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
// Kept local to avoid a circular dep with the hooks.
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
  /** Margin weighted by revenue */
  marginWeightedRev: number;
  marginRevBase: number;
  /** Days-of-cover weighted by units */
  coverWeightedUnits: number;
  coverUnitsBase: number;
  /** SKUs already counted for stock-level fields (avoid double-counting per line) */
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

/** Canonical SKU tokens (lowercase alphanumeric segments) — joins variant-level order SKUs
 * with base ERP SKUs via shared prefix. */
function canonTokens(value: unknown): string[] {
  return String(value ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((t) => t.length > 0);
}

/** Category index by base/parent code: lets full-catalog SKUs inherit a category from sibling
 * SKUs of the same model. Indexes prefixes ≥2 tokens (model-specific). */
function buildSignalCategoryIndex(
  signals: Record<string, SkuSignal>
): Map<string, { category?: string; subcategory?: string; brand?: string }> {
  const byPrefix = new Map<string, { category?: string; subcategory?: string; brand?: string }>();
  for (const [sku, sig] of Object.entries(signals)) {
    if (!sig.category) continue;
    const toks = canonTokens(sku);
    for (let i = 2; i <= toks.length; i++) {
      const key = toks.slice(0, i).join('-');
      if (!byPrefix.has(key)) {
        byPrefix.set(key, { category: sig.category, subcategory: sig.flow_group, brand: sig.supplier });
      }
    }
  }
  return byPrefix;
}

function inheritCategoryForSku(
  index: Map<string, { category?: string; subcategory?: string; brand?: string }>,
  sku: string
): { category?: string; subcategory?: string; brand?: string } | null {
  if (index.size === 0) return null;
  const toks = canonTokens(sku);
  for (let i = toks.length; i >= 2; i--) {
    const hit = index.get(toks.slice(0, i).join('-'));
    if (hit) return hit;
  }
  return null;
}

/** Demand lookup for an ERP SKU: full canonical key and, as a fallback, shorter prefixes (≥4 chars). */
function lookupDemandForSku(
  demandByKey: Map<string, { units: number; revenue: number }>,
  tokens: string[]
): { units: number; revenue: number } {
  for (let i = tokens.length; i >= 1; i--) {
    const key = tokens.slice(0, i).join('-');
    // The full SKU always matches; shorter prefixes only if specific enough (≥4 chars).
    if (i < tokens.length && key.length < 4) break;
    const d = demandByKey.get(key);
    if (d) return d;
  }
  return { units: 0, revenue: 0 };
}

// Name-bridge: when order SKUs (Magento) don't share an encoding with ERP SKUs (Megaventory),
// bridge via product name: order line.name → inventory product.name → ERP sku → category.

/** Greek→Latin phonetic fold: names are often written with look-alike Greek characters. */
const GREEK_FOLD: Record<string, string> = {
  α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l',
  μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f',
  χ: 'x', ψ: 'ps', ω: 'o',
};

const NAME_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'set', 'pack', 'new', 'σετ', 'τεμ', 'των', 'και', 'για']);

function foldName(value: unknown): string {
  const lowered = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let out = '';
  for (const ch of lowered) out += GREEK_FOLD[ch] ?? ch;
  return out;
}

function nameTokens(value: unknown): string[] {
  return foldName(value).split(/[^a-z0-9]+/).filter(Boolean);
}

function significantNameTokens(toks: string[]): string[] {
  return toks.filter((t) => t.length >= 3 && /[a-z]/.test(t) && !NAME_STOPWORDS.has(t));
}

interface NameBridgeEntry {
  skuCanon: string;
  sig: Set<string>;
  collapsed: string;
}

interface NameBridgeIndex {
  entries: NameBridgeEntry[];
  postings: Map<string, number[]>;
  byCollapsed: Map<string, number>;
}

/** Inverted token index over the inventory catalog (Megaventory) for fuzzy name matching. */
function buildNameBridgeIndex(products: Product[]): NameBridgeIndex {
  const entries: NameBridgeEntry[] = [];
  const postings = new Map<string, number[]>();
  const byCollapsed = new Map<string, number>();
  for (const p of products) {
    const skuTok = canonTokens((p as any).sku);
    if (!skuTok.length) continue;
    const toks = nameTokens((p as any).name);
    const sig = new Set(significantNameTokens(toks));
    if (sig.size === 0) continue;
    const idx = entries.length;
    const collapsed = toks.join('');
    entries.push({ skuCanon: skuTok.join('-'), sig, collapsed });
    if (collapsed.length >= 6 && !byCollapsed.has(collapsed)) byCollapsed.set(collapsed, idx);
    for (const t of sig) {
      const arr = postings.get(t);
      if (arr) arr.push(idx);
      else postings.set(t, [idx]);
    }
  }
  return { entries, postings, byCollapsed };
}

/** Returns the canonical ERP sku matching the line's name, or null. */
function resolveNameToSku(index: NameBridgeIndex, rawName: unknown): { skuCanon: string; exact: boolean } | null {
  const toks = nameTokens(rawName);
  const collapsed = toks.join('');
  if (collapsed.length >= 6) {
    const hit = index.byCollapsed.get(collapsed);
    if (hit != null) return { skuCanon: index.entries[hit].skuCanon, exact: true };
  }
  const sig = significantNameTokens(toks);
  if (sig.length === 0) return null;
  const sigSet = new Set(sig);
  const interCounts = new Map<number, number>();
  for (const t of sigSet) {
    const arr = index.postings.get(t);
    if (arr) for (const i of arr) interCounts.set(i, (interCounts.get(i) ?? 0) + 1);
  }
  let best = -1;
  let bestScore = 0;
  let bestExact = false;
  for (const [idx, inter] of interCounts) {
    if (inter < 2) continue;
    const e = index.entries[idx];
    const union = sigSet.size + e.sig.size - inter;
    const jaccard = union > 0 ? inter / union : 0;
    const contained = e.collapsed.startsWith(collapsed) || collapsed.startsWith(e.collapsed);
    const score = jaccard + (contained ? 0.25 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = idx;
      bestExact = contained && Math.min(collapsed.length, e.collapsed.length) >= 8;
    }
  }
  if (best >= 0 && bestScore >= 0.5) return { skuCanon: index.entries[best].skuCanon, exact: bestExact };
  return null;
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

  // Procurement/ERP signals: authoritative for stock + category/supplier/margin/cover.
  // (Megaventory/procurement uploads → category/supplier/flow-group etc.)
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
        // Fill from the signal only what's missing from the product catalog.
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
  /** sku → declared parent SKU (Magento itemGroupId); groups variant opportunities into one slot. */
  parentSkuBySku?: Record<string, string>;
}): MarketingPlanInsight {
  const lastYearFromDate = shiftIsoDateByYears(input.period.fromDate, -1);
  const lastYearToDate = shiftIsoDateByYears(input.period.toDate, -1);

  const lookup = buildInventoryLookupFromSignals(
    input.inventoryProducts ?? [],
    input.procurementSignals ?? {}
  );

  const signals = input.procurementSignals ?? {};
  const inventoryProducts = input.inventoryProducts ?? [];
  const hasErp = Object.keys(signals).length > 0;

  // ERP universe: procurement signals are often a subset of the catalog, so expand with catalog
  // products for full coverage. Signals take precedence; product-only SKUs inherit sibling category.
  const expandUniverse = hasErp && inventoryProducts.length > Object.keys(signals).length;
  const universeSignals: Record<string, SkuSignal> = { ...signals };
  if (expandUniverse) {
    const signalKeyNorm = new Set(Object.keys(signals).map((k) => k.trim().toLowerCase()));
    const categoryIndex = buildSignalCategoryIndex(signals);
    for (const p of inventoryProducts) {
      const rawSku = String((p as any).sku ?? '').trim();
      if (!rawSku || signalKeyNorm.has(rawSku.toLowerCase())) continue;
      const inh = inheritCategoryForSku(categoryIndex, rawSku);
      const price = productPrice(p);
      universeSignals[rawSku] = {
        available_stock: productStock(p),
        avg_sale_price: price > 0 ? price : undefined,
        description: (p as any).name?.trim() || rawSku,
        category: inh?.category,
        flow_group: inh?.subcategory,
        supplier: inh?.brand,
      };
    }
  }

  // Canonical keys for the whole universe (signals + catalog) — for matchedLines + prefix join
  // with variant-level order SKUs, so SKU match reflects the full catalog, not just the report.
  const signalCanonSet = new Set<string>();
  for (const k of Object.keys(universeSignals)) {
    const t = canonTokens(k);
    if (t.length) signalCanonSet.add(t.join('-'));
  }

  // Name-bridge index (only when ERP + inventory catalog exist): bridges order names → ERP sku
  // for stores where order SKUs don't share an encoding with the ERP (e.g. Magento ↔ Megaventory).
  const nameIndex = hasErp && inventoryProducts.length > 0 ? buildNameBridgeIndex(inventoryProducts) : null;
  const bridgedSkus = new Map<string, 'exact' | 'fuzzy'>();

  // 1. Demand from last year's orders: accumulate across ALL SKU prefixes, so a base ERP SKU
  // finds the sum of its variants (sizes/colors).
  const demandByKey = new Map<string, { units: number; revenue: number }>();
  let revenue = 0;
  let orders = 0;
  let units = 0;
  let lines = 0;
  let matchedLines = 0;
  let bridgedLines = 0;

  for (const order of input.lastYearOrders) {
    const orderDay = dayKey(order.createdAt);
    if (orderDay < lastYearFromDate || orderDay > lastYearToDate) continue;
    if (!isEcommerceOrderDataAnalysisIncluded(order)) continue;
    orders += 1;
    revenue += Number(order.total) || 0;
    for (const line of order.lineItems) {
      if (isEcommerceDemoLineItem(line)) continue;
      // Magento configurable: the child (simple) line double-counts quantity — keep only the parent.
      if ((line as any).parentItemId != null) continue;
      const quantity = Number(line.quantity ?? 0) || 0;
      if (quantity <= 0) continue;
      lines += 1;
      units += quantity;
      const rev = lineRevenue(quantity, Number((line as any).price ?? 0), (line as any).rowTotal);
      const tokens = canonTokens((line as any).sku);
      let matched = false;
      if (tokens.length) {
        for (let i = 1; i <= tokens.length; i++) {
          const key = tokens.slice(0, i).join('-');
          const d = demandByKey.get(key) ?? { units: 0, revenue: 0 };
          d.units += quantity;
          d.revenue += rev;
          demandByKey.set(key, d);
          if (!matched && (i === tokens.length || key.length >= 4) && signalCanonSet.has(key)) matched = true;
        }
      }
      // Fallback: if the SKU doesn't match an ERP signal, try bridging via name.
      if (hasErp && !matched && nameIndex) {
        const bridged = resolveNameToSku(nameIndex, (line as any).name ?? (line as any).title);
        if (bridged) {
          const d = demandByKey.get(bridged.skuCanon) ?? { units: 0, revenue: 0 };
          d.units += quantity;
          d.revenue += rev;
          demandByKey.set(bridged.skuCanon, d);
          const prev = bridgedSkus.get(bridged.skuCanon);
          bridgedSkus.set(bridged.skuCanon, bridged.exact || prev === 'exact' ? 'exact' : 'fuzzy');
          matched = true;
          bridgedLines += 1;
        }
      }
      if (hasErp && matched) matchedLines += 1;
    }
  }

  // 2. Reorder plan: ERP-driven when procurement signals exist (authoritative for stock +
  // replenishment), otherwise order-driven catalog lookup for stores without ERP.
  let reorderPlan: MarketingPlanReorderGroup[];
  let skuSuggestions: MarketingPlanSkuSuggestion[];
  let totalSkusCovered: number;
  let inventoryCoveragePct: number;

  if (hasErp) {
    const built = buildErpDrivenReorder(universeSignals, demandByKey, bridgedSkus, input.parentSkuBySku);
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
    const erpHasReplenishment = reorderPlan.some((r) => r.reorderQtySource === 'erp');
    if (bridgedLines > 0) {
      notes.push('Τα order SKU δεν ταυτίζονται με τα ERP SKU (διαφορετική κωδικοποίηση) — οι περσινές πωλήσεις αντιστοιχίστηκαν μέσω ονόματος προϊόντος. Η κατανομή ανά κατηγορία είναι αξιόπιστη· οι προτάσεις σε επίπεδο SKU είναι ενδεικτικές.');
    } else if (lines > 0 && matchedLines === 0 && !erpHasReplenishment) {
      notes.push('Δεν αντιστοιχίστηκε καμία περσινή πώληση με τα ERP SKU (διαφορετική κωδικοποίηση) και το ERP δεν δίνει ποσότητα ανατροφοδοσίας — οι ποσότητες παραγγελίας δεν μπορούν να υπολογιστούν με ασφάλεια. Δες την κατηγορία/περιθώριο ως ένδειξη και επιβεβαίωσε χειροκίνητα.');
    } else if (lines > 0 && lineItemCoveragePct < 40) {
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

// ERP-driven reorder: procurement signals are the universe (category/stock/replenishment),
// with last year's sales as demand enrichment (join per SKU).
function buildErpDrivenReorder(
  signals: Record<string, SkuSignal>,
  demandByKey: Map<string, { units: number; revenue: number }>,
  bridgedSkus?: Map<string, 'exact' | 'fuzzy'>,
  parentSkuBySku?: Record<string, string>
): { reorderPlan: MarketingPlanReorderGroup[]; skuSuggestions: MarketingPlanSkuSuggestion[]; totalSkus: number } {
  type ErpGroup = {
    category: string; subcategory: string; brand: string;
    revenue: number; units: number; stock: number; stockValue: number;
    replenishmentQty: number; replenishmentValue: number; tiedCapital: number;
    marginWeighted: number; marginBase: number;
    coverWeighted: number; coverBase: number;
    skus: { row: MarketingPlanSkuSuggestion; sortValue: number }[];
  };
  const groups = new Map<string, ErpGroup>();
  const skuRows: { row: MarketingPlanSkuSuggestion; sortValue: number }[] = [];
  let totalSkus = 0;

  for (const [rawSku, sig] of Object.entries(signals)) {
    // Skip inactive SKUs with no stock/replenishment/category.
    if (sig.available_stock == null && (sig.replenishment_qty ?? 0) <= 0 && !sig.category) continue;
    totalSkus += 1;

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
    const skuCanon = canonTokens(rawSku).join('-');
    const demand = lookupDemandForSku(demandByKey, canonTokens(rawSku));
    const lyUnits = demand.units;
    const lyRev = demand.revenue;
    const bridgeKind = bridgedSkus?.get(skuCanon);

    const key = `${category}||${subcategory}||${brand}`;
    const g = groups.get(key) ?? {
      category, subcategory, brand,
      revenue: 0, units: 0, stock: 0, stockValue: 0,
      replenishmentQty: 0, replenishmentValue: 0, tiedCapital: 0,
      marginWeighted: 0, marginBase: 0, coverWeighted: 0, coverBase: 0,
      skus: [],
    };
    g.revenue += lyRev;
    g.units += lyUnits;
    g.stock += stock;
    g.stockValue += stock * price;
    g.replenishmentQty += repl;
    g.replenishmentValue += replValue;
    g.tiedCapital += tied;
    // Margin weighted by value (last year's sales or stock value), cover weighted by stock.
    const mw = lyRev > 0 ? lyRev : stock * price > 0 ? stock * price : 1;
    if (margin != null) { g.marginWeighted += margin * mw; g.marginBase += mw; }
    if (cover != null) { const cb = Math.max(1, stock); g.coverWeighted += cover * cb; g.coverBase += cb; }
    groups.set(key, g);

    // SKU-level suggestion: ERP replenishment or demand exceeding stock.
    const needsReorder = repl > 0 || (lyUnits > 0 && stock < lyUnits);
    const qty = repl > 0 ? repl : reorderQty(lyUnits, stock);
    const skuRow: MarketingPlanSkuSuggestion = {
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
      confidence:
        repl > 0
          ? 'high'
          : bridgeKind === 'fuzzy'
            ? 'low'
            : lyUnits >= 4
              ? 'medium'
              : 'low',
    };
    // Every analyzed SKU in the group (for expandable view; sorted by value/demand).
    g.skus.push({ row: skuRow, sortValue: replValue || lyRev || stock * price || qty });
    // Global top-SKU opportunities: only those that actually need an order.
    if (needsReorder && qty > 0) {
      skuRows.push({ row: skuRow, sortValue: replValue || lyRev || qty * price });
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
        skus: g.skus
          .sort((a, b) => b.sortValue - a.sortValue)
          .slice(0, 40)
          .map((s) => s.row),
      };
    })
    // Priority: groups needing an order first, then by replenishment/demand value.
    .sort((a, b) => {
      const ai = a.action === 'increase' ? 1 : 0;
      const bi = b.action === 'increase' ? 1 : 0;
      if (ai !== bi) return bi - ai;
      return (b.estimatedReorderValue || b.lastYearRevenue) - (a.estimatedReorderValue || a.lastYearRevenue);
    })
    .slice(0, 16);

  // Declared parent-SKU grouping: variants of one parent take ONE opportunity slot (summed
  // quantities, top variant as representative) instead of filling the top-30 with sizes.
  let suggestionRows = skuRows;
  if (parentSkuBySku) {
    const byParent = new Map<string, { row: MarketingPlanSkuSuggestion; sortValue: number; members: number }>();
    const singles: { row: MarketingPlanSkuSuggestion; sortValue: number }[] = [];
    for (const r of skuRows) {
      const parent = parentSkuBySku[r.row.sku];
      if (!parent || parent === r.row.sku) { singles.push(r); continue; }
      const g = byParent.get(parent);
      if (!g) { byParent.set(parent, { row: { ...r.row, sku: parent }, sortValue: r.sortValue, members: 1 }); continue; }
      const keepNew = r.sortValue > g.sortValue;
      const rep = keepNew ? r.row : g.row;
      byParent.set(parent, {
        row: {
          ...rep,
          sku: parent,
          lastYearUnits: g.row.lastYearUnits + r.row.lastYearUnits,
          lastYearRevenue: +(g.row.lastYearRevenue + r.row.lastYearRevenue).toFixed(2),
          currentStock: g.row.currentStock + r.row.currentStock,
          estimatedReorderQty: g.row.estimatedReorderQty + r.row.estimatedReorderQty,
          reorderQtySource: g.row.reorderQtySource === 'erp' || r.row.reorderQtySource === 'erp' ? 'erp' : 'estimated',
        },
        sortValue: g.sortValue + r.sortValue,
        members: g.members + 1,
      });
    }
    suggestionRows = [
      ...singles,
      ...[...byParent.values()].map((g) => ({ row: { ...g.row, ...(g.members > 1 ? { variantCount: g.members } : {}) }, sortValue: g.sortValue })),
    ];
  }

  const skuSuggestions = suggestionRows
    .sort((a, b) => b.sortValue - a.sortValue)
    .slice(0, 30)
    .map((r) => r.row);

  return { reorderPlan, skuSuggestions, totalSkus };
}

// ── Order-driven reorder (fallback without ERP): join last year's line items with catalog lookup. ──
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
