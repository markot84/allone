/**
 * useProductSignals — Universal data layer για όλες τις εμπορικές πολιτικές.
 *
 * Συγχωνεύει τέσσερις πηγές δεδομένων με σταθερή ιεράρχηση και επιστρέφει
 * per-SKU resolved record + provenance per field. Καμία υπάρχουσα συμπεριφορά
 * δεν αλλάζει — είναι additive layer που τα callers (filters, scoring, AI
 * prompts) μπορούν να χρησιμοποιούν προαιρετικά.
 *
 * Source priority (από high σε low εμπιστοσύνη):
 *   1. CONNECTOR        — orders από συνδεδεμένα e-shops (skuStats από
 *                         ecommerce_summary). Ground truth για windows + last_sale_at.
 *   2. STOCK_MOVEMENT   — daily snapshot deltas (skuMovement). Έγκυρο για
 *                         brands χωρίς orders connector — net of returns.
 *   3. PROCUREMENT      — procurement_signals (ERP/inventory exports). Lifetime,
 *                         status, tied capital, margin, list/corp prices.
 *   4. IMPORT           — fields απευθείας στο product doc (από XLSX import).
 *
 * Σχεδιαστική σημείωση: τα **windows** (qty7d/30d/90d) ΔΕΝ γεμίζουν από
 * lifetime ή annual μετρήσεις. Αν δεν υπάρχει window-grade πηγή, μένουν undefined
 * και τα filters πρέπει να το αντιμετωπίζουν ως «άγνωστο» (όχι 0).
 */

import { useMemo } from 'react';
import { useEcommerceSummary } from './useEcommerceSummary';
import { useProcurementSignals } from './useProcurementSignals';
import type { Product } from '../types';

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
  // Annual (από procurement_fiscal_year — τελευταίο διαθέσιμο έτος)
  annual_revenue?: number;
  annual_profit?: number;
}

/** Map field → source που το έδωσε. Τιμές για undefined fields == 'none'. */
export type Provenance = Record<keyof Omit<ResolvedSignal, 'sku'>, SignalSource>;

export interface ProductSignal {
  resolved: ResolvedSignal;
  provenance: Provenance;
  /** True αν τουλάχιστον ένα field προέρχεται από procurement. */
  hasProcurement: boolean;
  /** True αν τουλάχιστον ένα window είναι orders-grade (connector ή movement). */
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
  /** Συνδυάζει product + signal σε ένα enriched object (αντικαθιστά μόνο null/undefined fields του product). */
  enrichProduct: (p: Product) => Product;
  /** Resolve helper για ad-hoc lookup (επιστρέφει undefined αν δεν υπάρχει SKU). */
  getSignal: (sku: string) => ProductSignal | undefined;
  /** Πόσα SKUs έχουμε ανά πηγή (debug/diagnostics). */
  coverage: {
    connector: number;
    movement: number;
    procurement: number;
    import: number;
  };
  isLoading: boolean;
}

/**
 * Build resolved signals για όλα τα SKUs που εμφανίζονται σε οποιαδήποτε πηγή.
 * Δέχεται προαιρετικά μια λίστα Products για να πιάσει και τα import-only SKUs.
 */
export function useProductSignals(products?: Product[]): UseProductSignalsResult {
  const ec = useEcommerceSummary();
  const ps = useProcurementSignals();

  const result = useMemo(() => {
    const skuStats = ec.skuStats || {};
    const skuMovement = ec.skuMovement || {};
    const procSignals = ps.signalsBySku || {};

    // Συγκεντρώνουμε όλα τα γνωστά SKUs
    const allSkus = new Set<string>();
    for (const k of Object.keys(skuStats)) allSkus.add(k);
    for (const k of Object.keys(skuMovement)) allSkus.add(k);
    for (const k of Object.keys(procSignals)) allSkus.add(k);
    if (products) {
      for (const p of products) {
        const s = (p.sku || '').trim();
        if (s) allSkus.add(s);
      }
    }

    const productsBySku = new Map<string, Product>();
    if (products) {
      for (const p of products) {
        const s = (p.sku || '').trim();
        if (s && !productsBySku.has(s)) productsBySku.set(s, p);
      }
    }

    const map = new Map<string, ProductSignal>();
    const coverage = { connector: 0, movement: 0, procurement: 0, import: 0 };

    for (const sku of allSkus) {
      const resolved: ResolvedSignal = { sku };
      const prov: Provenance = { ...EMPTY_PROVENANCE };

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

      // 2) STOCK_MOVEMENT — fallback για windows όταν δεν έχουμε orders connector
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

      // 5) COMPUTED — tied_capital fallback (cost × stock) όταν procurement λείπει
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
  }, [ec.skuStats, ec.skuMovement, ps.signalsBySku, products]);

  const enrichProduct = useMemo(() => {
    return (p: Product): Product => {
      const sig = result.map.get((p.sku || '').trim());
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
    getSignal: (sku: string) => result.map.get((sku || '').trim()),
    coverage: result.coverage,
    isLoading: ec.isLoading || ps.isLoading,
  };
}
