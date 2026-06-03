import { useMemo } from 'react';
import { useProducts } from './useProducts';
import { useProcurement } from './useProcurement';
import { usePlan } from './usePlan';
import type { Product } from '../types';
import { classifyProcurementInventoryRow } from '../utils/procurementInventoryClassify';
import { excludeDemoProducts, normalizeSpreadsheetCellToFirstAvailableDate } from '../utils/productUtils';

/** Πρώτο header που ταιριάζει (substring, case-insensitive) με κάποιο keyword — σειρά = προτεραιότητα. */
function findColByKeywords(rows: Record<string, unknown>[], keywords: readonly string[]): string {
  if (!rows.length) return keywords[0] ?? '';
  const headers = Object.keys(rows[0]);
  for (const kw of keywords) {
    const kUp = kw.toUpperCase();
    const hit = headers.find(h => h.toUpperCase().includes(kUp));
    if (hit) return hit;
  }
  return keywords[0] ?? '';
}

type PricingSlice = {
  avg?: number;
  list?: number;
  corp?: number;
  totalCost?: number;
  primaryCost?: number;
};

/** Αντιστοίχιση SKU → τιμές/κόστη από procurement_pricing_policy (ίδια λογική με procurementSignals). */
function buildPricingBySku(pricingRows: Record<string, unknown>[]): Map<string, PricingSlice> {
  const map = new Map<string, PricingSlice>();
  if (!pricingRows.length) return map;

  const skuCol = findColByKeywords(pricingRows, ['ΚΩΔΙΚΟΣ']);
  const avgCol = findColByKeywords(pricingRows, ['ΜΕΣΗ_ΤΙΜΗ_ΠΩΛΗΣΗΣ', 'ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ']);
  const listCol = findColByKeywords(pricingRows, ['ΤΙΜΟΚΑΤΑΛΟΓΟΣ_ΒΑΣΗΣ', 'ΤΙΜΟΚΑΤΑΛΟΓΟΣ ΒΑΣΗΣ']);
  const corpCol = findColByKeywords(pricingRows, ['ΕΤΑΙΡΙΚΟΣ_ΚΑΤΑΛΟΓΟΣ', 'ΕΤΑΙΡΙΚΟΣ ΚΑΤΑΛΟΓΟΣ']);
  const totalCostCol = findColByKeywords(pricingRows, ['ΣΥΝΟΛΙΚΟ_ΚΟΣΤΟΣ', 'ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ']);
  const primaryCostCol = findColByKeywords(pricingRows, [
    'ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ_Μ_Μ',
    'ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ',
    'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ',
  ]);

  for (const row of pricingRows) {
    const sku = String(row[skuCol] ?? '').trim();
    if (!sku) continue;
    const slice: PricingSlice = {};
    const avg = parseNum(row[avgCol]);
    const list = parseNum(row[listCol]);
    const corp = parseNum(row[corpCol]);
    const totalCost = parseNum(row[totalCostCol]);
    const primaryCost = parseNum(row[primaryCostCol]);
    if (avg > 0) slice.avg = avg;
    if (list > 0) slice.list = list;
    if (corp > 0) slice.corp = corp;
    if (totalCost > 0) slice.totalCost = totalCost;
    if (primaryCost > 0) slice.primaryCost = primaryCost;
    if (Object.keys(slice).length) map.set(sku, slice);
  }
  return map;
}

/** Σειρά από συγκεκριμένα προς γενικά — best-effort αν το template έχει διαφορετικές κεφαλίδες. */
const PROCUREMENT_FIRST_AVAILABLE_KEYWORDS = [
  'ΗΜ.ΠΡΩΤΗΣ',
  'ΠΡΩΤΗΣ ΠΑΡΑΛ',
  'ΠΡΩΤΗ ΠΑΡΑΛΑΒΗ',
  'ΠΡΩΤΗ ΕΙΣΑΓΩΓΗ',
  'ΗΜΕΡΟΜΗΝΙΑ ΠΡΩΤΗΣ ΠΑΡΑΛΑΒΗΣ',
  'FIRST_AVAILABLE_DATE',
  'FIRST_AVAILABLE',
  'FIRST_RECEIPT',
  'DATE_FIRST_RECEIPT',
] as const;

const ERP_PRODUCT_SOURCE_MARKERS = [
  'erp',
  'megaventory',
  'softone',
  'entersoft',
  'epsilon',
] as const;

function hasErpProductSource(product: Product): boolean {
  const raw = (product as Product & { source?: unknown; feedSourceType?: unknown }).source
    ?? (product as Product & { source?: unknown; feedSourceType?: unknown }).feedSourceType
    ?? '';
  const source = String(raw).trim().toLowerCase();
  return ERP_PRODUCT_SOURCE_MARKERS.some((marker) => source.includes(marker));
}

function findColByOrderedKeywords(rows: Record<string, unknown>[], keywords: readonly string[]): string | null {
  if (!rows.length) return null;
  const headers = Object.keys(rows[0]);
  for (const kw of keywords) {
    const kUp = kw.toUpperCase();
    const hit = headers.find(h => h.toUpperCase().includes(kUp));
    if (hit) return hit;
  }
  return null;
}

function parseNum(v: unknown): number {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v).trim().replace(/\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(s) || 0;
}

/**
 * Unified product source: uses procurement inventory for Enterprise plans,
 * falls back to regular product import otherwise.
 */
type UseProductSourceOptions = {
  maxProducts?: number;
};

export function useProductSource(options: UseProductSourceOptions = {}) {
  const productHook = useProducts({ maxDocs: options.maxProducts });
  const { isEnterprise } = usePlan();
  const { data: procData, isLoading: procurementLoading } = useProcurement();

  const procProducts = useMemo((): Product[] => {
    if (!isEnterprise) return [];
    const allInvRows = ((procData?.inventory ?? []) as unknown[]) as Record<string, unknown>[];
    if (!allInvRows.length) return [];
    const invRows = options.maxProducts ? allInvRows.slice(0, options.maxProducts) : allInvRows;

    const pricingRows = ((procData?.pricing_policy ?? []) as unknown[]) as Record<string, unknown>[];
    const pricingBySku = buildPricingBySku(pricingRows);

    // Ορισμένα templates χρησιμοποιούν «MASTER» αντί για «ΚΩΔΙΚΟΣ» στο inventory sheet.
    const codeCol = findColByKeywords(invRows, ['ΚΩΔΙΚΟΣ', 'MASTER']);
    const descCol = findColByKeywords(invRows, ['ΠΕΡΙΓΡΑΦΗ']);
    const stockCol = findColByKeywords(invRows, ['ΔΙΑΘΕΣΙΜΟ_ΥΠΟΛΟΙΠΟ', 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ']);
    const costCol = findColByKeywords(invRows, [
      'ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ_Μ_Μ',
      'ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ',
      'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ',
    ]);
    const evalCol = findColByKeywords(invRows, ['ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ', 'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ']);
    const refillCol = findColByKeywords(invRows, ['ΠΟΣΟΤΗΤΑ_ΑΝΑΤΡΟΦΟΔΟΣΗΣ', 'ΑΝΑΤΡΟΦΟΔΟΣΙΑ']);
    const priceCol = findColByKeywords(invRows, ['ΤΙΜΗ ΠΩΛΗΣΗΣ', 'ΤΙΜΗ_ΠΩΛΗΣΗΣ', 'ΜΕΣΗ_ΤΙΜΗ_ΠΩΛΗΣΗΣ']);
    const groupCol = findColByKeywords(invRows, ['ΟΜΑΔΑ_ΡΟΗΣ', 'ΚΑΤΗΓΟΡΙΑ', 'ΟΜΑΔΑ']);
    const statusCol = findColByKeywords(invRows, ['STATUS_ΚΩΔΙΚΟΥ', 'STATUS ΚΩΔΙΚΟΥ']);
    const firstAvailCol = findColByOrderedKeywords(invRows, PROCUREMENT_FIRST_AVAILABLE_KEYWORDS);

    return invRows.map((row, idx) => {
      const code = String(row[codeCol] ?? '').trim();
      const desc = String(row[descCol] ?? '').trim();
      const stock = parseNum(row[stockCol]);
      let cost = parseNum(row[costCol]);
      const invPriceRaw = parseNum(row[priceCol]);
      let price = invPriceRaw || cost;

      const pr = code ? pricingBySku.get(code) : undefined;
      if (pr) {
        const fromPricingPrice = pr.avg || pr.list || pr.corp || 0;
        if (invPriceRaw <= 0 && fromPricingPrice > 0) price = fromPricingPrice;
        const costFromPricing =
          pr.totalCost && pr.totalCost > 0 ? pr.totalCost : pr.primaryCost && pr.primaryCost > 0 ? pr.primaryCost : 0;
        if (cost <= 0 && costFromPricing > 0) cost = costFromPricing;
      }

      const evalGrade = String(row[evalCol] ?? 'B').trim().toUpperCase();
      const needsRefill = parseNum(row[refillCol]) > 0;
      const statusUpper = String(row[statusCol] ?? '').trim().toUpperCase();
      const group = String(row[groupCol] ?? '').trim();
      const first_available_date = firstAvailCol
        ? normalizeSpreadsheetCellToFirstAvailableDate(row[firstAvailCol])
        : undefined;

      const marginPct = price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0;
      const marginTier: Product['margin_tier'] = marginPct > 30 ? 'high' : marginPct > 15 ? 'medium' : 'low';

      const tag = classifyProcurementInventoryRow({
        stock,
        evalGrade,
        needsRefill,
        statusUpper,
      });

      return {
        id: code || `proc-${idx}`,
        name: desc || code,
        sku: code,
        category: group,
        margin_tier: marginTier,
        margin_percentage: Math.round(marginPct * 10) / 10,
        stock_level: stock,
        stock_capacity: stock * 2,
        // Μην βάζουμε stock_age_days: 0 — ερμηνευόταν λανθασμένα ως «νέο SKU 0 ημ.» στο triage.
        priority_tag: tag,
        procurement_status: statusUpper || undefined,
        price,
        cost_price: cost,
        ...(first_available_date ? { first_available_date } : {}),
      } as Product;
    });
  }, [isEnterprise, procData?.inventory, procData?.pricing_policy, options.maxProducts]);

  const usingProcurement = procProducts.length > 0;
  const importedProductsAreErp = useMemo(
    () => productHook.products.some(hasErpProductSource),
    [productHook.products]
  );
  const sourceKind: 'erp' | 'products_import' | 'pending' =
    usingProcurement || importedProductsAreErp || isEnterprise
      ? 'erp'
      : productHook.hasImported
        ? 'products_import'
        : 'pending';
  const sourceLabel =
    sourceKind === 'erp'
      ? 'ERP'
      : sourceKind === 'products_import'
        ? 'Products import'
        : 'Pending';
  // Demo products φιλτράρονται και εδώ για να ισχύει σε όλους τους aggregates.
  const products = excludeDemoProducts(usingProcurement ? procProducts : productHook.products);

  /** Μέχρι να ολοκληρωθεί και το procurement (Enterprise), μην εμφανίζεις κενή σελίδα «χωρίς προϊόντα». */
  const isLoading =
    usingProcurement ? false : productHook.isLoading || (isEnterprise && procurementLoading);

  return {
    products,
    count: products.length,
    totalCount: usingProcurement ? products.length : productHook.totalCount,
    isLoading,
    hasImported: productHook.hasImported || usingProcurement,
    usingProcurement,
    sourceKind,
    sourceLabel,
  };
}
