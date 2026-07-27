/** Additive per-SKU data layer merging four sources by priority: connector > stock-movement > procurement > import.
 * Windows (qty7d/30d/90d) never fill from lifetime/annual: absent window-grade source stays undefined ("unknown", not 0). */

import { useMemo } from 'react';
import { useEcommerceSummary } from './useEcommerceSummary';
import { useProcurementSignals, type ProcurementSignal } from './useProcurementSignals';
import type { Product } from '../types';

/** Unified SKU key (NFC, trim, collapse spaces, uppercase) so e-shop, ERP procurement
 * and import line up despite minor differences (e.g. Abc-1 vs ABC-1). */
export function normalizeSkuKeyForSignals(raw: string | undefined | null): string {
  if (raw == null) return '';
  const s = String(raw).normalize('NFC').trim().replace(/\s+/g, ' ');
  return s ? s.toUpperCase() : '';
}

type SkuStatRow = {
  stock: number;
  sold: number;
  sold7d?: number;
  sold30d?: number;
  sold90d?: number;
  lastSaleAt?: string | null;
};

function mergeSkuStatRows(a: SkuStatRow, b: SkuStatRow): SkuStatRow {
  const ta = a.lastSaleAt ? new Date(a.lastSaleAt).getTime() : NaN;
  const tb = b.lastSaleAt ? new Date(b.lastSaleAt).getTime() : NaN;
  let lastSaleAt: string | null = a.lastSaleAt ?? null;
  if (Number.isFinite(tb) && (!Number.isFinite(ta) || tb > ta)) {
    lastSaleAt = b.lastSaleAt ?? null;
  }
  return {
    stock: Math.round((a.stock || 0) + (b.stock || 0)),
    sold: Math.round((a.sold || 0) + (b.sold || 0)),
    sold7d: Math.round((a.sold7d || 0) + (b.sold7d || 0)),
    sold30d: Math.round((a.sold30d || 0) + (b.sold30d || 0)),
    sold90d: Math.round((a.sold90d || 0) + (b.sold90d || 0)),
    lastSaleAt,
  };
}

function mergeMovementRows(
  a: { dec7d?: number; dec30d?: number; dec90d?: number },
  b: { dec7d?: number; dec30d?: number; dec90d?: number }
): { dec7d?: number; dec30d?: number; dec90d?: number } {
  return {
    dec7d: (a.dec7d || 0) + (b.dec7d || 0),
    dec30d: (a.dec30d || 0) + (b.dec30d || 0),
    dec90d: (a.dec90d || 0) + (b.dec90d || 0),
  };
}

function mergeProcurementRows(a: ProcurementSignal, b: ProcurementSignal): ProcurementSignal {
  const out: ProcurementSignal = { ...a };
  for (const [key, val] of Object.entries(b)) {
    if (val === undefined || val === null) continue;
    const k = key as keyof ProcurementSignal;
    if (out[k] === undefined || out[k] === null) {
      (out as Record<string, unknown>)[key] = val;
    }
  }
  return out;
}

function aggregateSkuStatsByNorm(raw: Record<string, SkuStatRow>): Record<string, SkuStatRow> {
  const out: Record<string, SkuStatRow> = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk = normalizeSkuKeyForSignals(k);
    if (!nk) continue;
    out[nk] = out[nk] ? mergeSkuStatRows(out[nk], v) : { ...v };
  }
  return out;
}

function aggregateMovementByNorm(
  raw: Record<string, { dec7d?: number; dec30d?: number; dec90d?: number }>
): Record<string, { dec7d?: number; dec30d?: number; dec90d?: number }> {
  const out: Record<string, { dec7d?: number; dec30d?: number; dec90d?: number }> = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk = normalizeSkuKeyForSignals(k);
    if (!nk) continue;
    out[nk] = out[nk] ? mergeMovementRows(out[nk], v) : { ...v };
  }
  return out;
}

function aggregateProcurementByNorm(raw: Record<string, ProcurementSignal>): Record<string, ProcurementSignal> {
  const out: Record<string, ProcurementSignal> = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk = normalizeSkuKeyForSignals(k);
    if (!nk) continue;
    out[nk] = out[nk] ? mergeProcurementRows(out[nk], v) : { ...v };
  }
  return out;
}

export type SignalSource =
  | 'connector'
  | 'movement'
  | 'procurement'
  | 'import'
  | 'computed'
  | 'none';

export interface ResolvedSignal {
  sku: string;
  // Stock & capital
  stock?: number;
  cost?: number;
  price?: number;
  tied_capital?: number;
  // Sales windows (orders-grade)
  qty7d?: number;
  qty30d?: number;
  qty90d?: number;
  // Lifetime / aggregate
  qty_lifetime?: number;
  last_sale_at?: string | null;
  // Catalog / lifecycle
  category?: string;
  status?: string;
  evaluation_label?: string;
  evaluation_score?: number;
  margin_pct?: number;
  days_of_cover?: number;
  // Annual (from procurement_fiscal_year — latest available year)
  annual_revenue?: number;
  annual_profit?: number;
}

/** Map field → source that provided it. Undefined fields map to 'none'. */
export type Provenance = Record<keyof Omit<ResolvedSignal, 'sku'>, SignalSource>;

export interface ProductSignal {
  resolved: ResolvedSignal;
  provenance: Provenance;
  /** True if at least one field comes from procurement. */
  hasProcurement: boolean;
  /** True if at least one window is orders-grade (connector or movement). */
  hasWindowSource: boolean;
}

const EMPTY_PROVENANCE: Provenance = {
  stock: 'none',
  cost: 'none',
  price: 'none',
  tied_capital: 'none',
  qty7d: 'none',
  qty30d: 'none',
  qty90d: 'none',
  qty_lifetime: 'none',
  last_sale_at: 'none',
  category: 'none',
  status: 'none',
  evaluation_label: 'none',
  evaluation_score: 'none',
  margin_pct: 'none',
  days_of_cover: 'none',
  annual_revenue: 'none',
  annual_profit: 'none',
};

function setField<K extends keyof Provenance>(
  resolved: ResolvedSignal,
  prov: Provenance,
  key: K,
  value: ResolvedSignal[K] | undefined,
  source: SignalSource
): void {
  if (value === undefined || value === null) return;
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  if (prov[key] !== 'none') return; // higher-priority source already won
  (resolved as any)[key] = value;
  prov[key] = source;
}

export interface UseProductSignalsResult {
  signalsBySku: Map<string, ProductSignal>;
  /** Combines product + signal into one enriched object (only fills null/undefined product fields). */
  enrichProduct: (p: Product) => Product;
  /** Resolve helper for ad-hoc lookup (returns undefined if the SKU is absent). */
  getSignal: (sku: string) => ProductSignal | undefined;
  /** How many SKUs we have per source (debug/diagnostics). */
  coverage: {
    connector: number;
    movement: number;
    procurement: number;
    import: number;
  };
  isLoading: boolean;
}

/** Build resolved signals for all SKUs in any source; optional Products list catches import-only SKUs. */
export function useProductSignals(
  products?: Product[],
  options?: { preferProcurementStock?: boolean }
): UseProductSignalsResult {
  const ec = useEcommerceSummary();
  const ps = useProcurementSignals();
  const preferProcurementStock = !!options?.preferProcurementStock;

  const result = useMemo(() => {
    const skuStats = aggregateSkuStatsByNorm(ec.skuStats as Record<string, SkuStatRow>);
    const skuMovement = aggregateMovementByNorm(ec.skuMovement || {});
    const procSignals = aggregateProcurementByNorm(ps.signalsBySku || {});

    // Gather all known SKUs (normalized keys)
    const allSkus = new Set<string>();
    for (const k of Object.keys(skuStats)) allSkus.add(k);
    for (const k of Object.keys(skuMovement)) allSkus.add(k);
    for (const k of Object.keys(procSignals)) allSkus.add(k);
    if (products) {
      for (const p of products) {
        const s = normalizeSkuKeyForSignals(p.sku || p.id);
        if (s) allSkus.add(s);
      }
    }

    const productsBySku = new Map<string, Product>();
    if (products) {
      for (const p of products) {
        const s = normalizeSkuKeyForSignals(p.sku || p.id);
        if (s && !productsBySku.has(s)) productsBySku.set(s, p);
      }
    }

    const map = new Map<string, ProductSignal>();
    const coverage = { connector: 0, movement: 0, procurement: 0, import: 0 };

    for (const sku of allSkus) {
      const resolved: ResolvedSignal = { sku };
      const prov: Provenance = { ...EMPTY_PROVENANCE };

      // 0) PROCUREMENT-FIRST stock: when authoritative, set first so setField's first-wins
      // priority keeps the procurement value over the connector.
      if (preferProcurementStock) {
        const psStock = procSignals[sku];
        if (psStock) setField(resolved, prov, 'stock', psStock.available_stock, 'procurement');
      }

      // 1) CONNECTOR — orders ground truth
      const stat = skuStats[sku];
      if (stat) {
        coverage.connector++;
        setField(resolved, prov, 'qty7d', stat.sold7d, 'connector');
        setField(resolved, prov, 'qty30d', stat.sold30d, 'connector');
        setField(resolved, prov, 'qty90d', stat.sold90d, 'connector');
        setField(resolved, prov, 'qty_lifetime', stat.sold, 'connector');
        setField(resolved, prov, 'last_sale_at', stat.lastSaleAt ?? null, 'connector');
        setField(resolved, prov, 'stock', stat.stock, 'connector');
      }

      // 2) STOCK_MOVEMENT — fallback for windows when there is no orders connector
      const mov = skuMovement[sku];
      if (mov) {
        coverage.movement++;
        setField(resolved, prov, 'qty7d', mov.dec7d, 'movement');
        setField(resolved, prov, 'qty30d', mov.dec30d, 'movement');
        setField(resolved, prov, 'qty90d', mov.dec90d, 'movement');
      }

      // 3) PROCUREMENT — lifecycle, capital, margin, lifetime
      const ps2 = procSignals[sku];
      if (ps2) {
        coverage.procurement++;
        setField(resolved, prov, 'stock', ps2.available_stock, 'procurement');
        setField(resolved, prov, 'cost', ps2.cost_unit, 'procurement');
        setField(resolved, prov, 'price', ps2.list_price ?? ps2.corporate_price ?? ps2.avg_sale_price, 'procurement');
        setField(resolved, prov, 'tied_capital', ps2.tied_capital, 'procurement');
        setField(resolved, prov, 'qty_lifetime', ps2.lifetime_qty, 'procurement');
        setField(resolved, prov, 'category', ps2.category, 'procurement');
        setField(resolved, prov, 'status', ps2.status, 'procurement');
        setField(resolved, prov, 'evaluation_label', ps2.evaluation_label, 'procurement');
        setField(resolved, prov, 'evaluation_score', ps2.evaluation_score, 'procurement');
        setField(resolved, prov, 'margin_pct', ps2.margin_pct, 'procurement');
        setField(resolved, prov, 'days_of_cover', ps2.days_of_cover, 'procurement');
        setField(resolved, prov, 'annual_revenue', ps2.annual_revenue, 'procurement');
        setField(resolved, prov, 'annual_profit', ps2.annual_profit, 'procurement');
      }

      // 4) IMPORT — product doc fields (lowest priority)
      const p = productsBySku.get(sku);
      if (p) {
        coverage.import++;
        setField(resolved, prov, 'stock', p.stock_level, 'import');
        setField(resolved, prov, 'cost', p.cost_price, 'import');
        setField(resolved, prov, 'price', p.price, 'import');
        setField(resolved, prov, 'qty7d', p.qty_sold_last_7d, 'import');
        setField(resolved, prov, 'qty30d', p.qty_sold_last_30d, 'import');
        setField(resolved, prov, 'qty90d', p.qty_sold_last_90d, 'import');
        setField(resolved, prov, 'qty_lifetime', p.qty_sold_lifetime, 'import');
        setField(resolved, prov, 'last_sale_at', p.last_sale_at ?? null, 'import');
        setField(resolved, prov, 'category', p.category, 'import');
        setField(resolved, prov, 'status', p.procurement_status, 'import');
        setField(resolved, prov, 'margin_pct', p.margin_percentage, 'import');
      }

      // 5) COMPUTED — tied_capital fallback (cost × stock) when procurement is missing
      if (
        resolved.tied_capital === undefined &&
        typeof resolved.cost === 'number' &&
        typeof resolved.stock === 'number'
      ) {
        resolved.tied_capital = +(resolved.cost * resolved.stock).toFixed(2);
        prov.tied_capital = 'computed';
      }

      map.set(sku, {
        resolved,
        provenance: prov,
        hasProcurement: !!ps2,
        hasWindowSource:
          prov.qty7d === 'connector' ||
          prov.qty7d === 'movement' ||
          prov.qty30d === 'connector' ||
          prov.qty30d === 'movement' ||
          prov.qty90d === 'connector' ||
          prov.qty90d === 'movement',
      });
    }

    return { map, coverage };
  }, [ec.skuStats, ec.skuMovement, ps.signalsBySku, products, preferProcurementStock]);

  const enrichProduct = useMemo(() => {
    return (p: Product): Product => {
      const sig = result.map.get(normalizeSkuKeyForSignals(p.sku || p.id));
      if (!sig) return p;
      const r = sig.resolved;
      const out: Product = { ...p };
      if (out.stock_level == null && typeof r.stock === 'number') out.stock_level = r.stock;
      if (out.cost_price == null && typeof r.cost === 'number') out.cost_price = r.cost;
      if (!out.price && typeof r.price === 'number') out.price = r.price;
      if (out.qty_sold_last_7d == null && typeof r.qty7d === 'number') out.qty_sold_last_7d = r.qty7d;
      if (out.qty_sold_last_30d == null && typeof r.qty30d === 'number') out.qty_sold_last_30d = r.qty30d;
      if (out.qty_sold_last_90d == null && typeof r.qty90d === 'number') out.qty_sold_last_90d = r.qty90d;
      if (out.qty_sold_lifetime == null && typeof r.qty_lifetime === 'number') out.qty_sold_lifetime = r.qty_lifetime;
      if (!out.last_sale_at && r.last_sale_at) out.last_sale_at = r.last_sale_at;
      if (!out.procurement_category && r.category && sig.provenance.category === 'procurement') {
        out.procurement_category = r.category;
      }
      if (!out.procurement_status && r.status) out.procurement_status = r.status;
      if (!out.margin_percentage && typeof r.margin_pct === 'number') out.margin_percentage = r.margin_pct;
      return out;
    };
  }, [result]);

  return {
    signalsBySku: result.map,
    enrichProduct,
    getSignal: (sku: string) => result.map.get(normalizeSkuKeyForSignals(sku)),
    coverage: result.coverage,
    isLoading: ec.isLoading || ps.isLoading,
  };
}
