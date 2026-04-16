import { useMemo } from 'react';
import { useProducts } from './useProducts';
import { useProcurement } from './useProcurement';
import { usePlan } from './usePlan';
import type { Product } from '../types';
import { excludeDemoProducts } from '../utils/productUtils';

function findCol(rows: Record<string, unknown>[], keyword: string): string {
  if (!rows.length) return keyword;
  const kUp = keyword.toUpperCase();
  return Object.keys(rows[0]).find(k => k.toUpperCase().includes(kUp)) ?? keyword;
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
export function useProductSource() {
  const productHook = useProducts();
  const { isEnterprise } = usePlan();
  const { data: procData, isLoading: procurementLoading } = useProcurement();

  const procProducts = useMemo((): Product[] => {
    if (!isEnterprise) return [];
    const invRows = (procData.inventory ?? []) as Record<string, unknown>[];
    if (!invRows.length) return [];

    const codeCol = findCol(invRows, 'ΚΩΔΙΚΟΣ');
    const descCol = findCol(invRows, 'ΠΕΡΙΓΡΑΦΗ');
    const stockCol = findCol(invRows, 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ');
    const costCol = findCol(invRows, 'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ');
    const evalCol = findCol(invRows, 'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ');
    const refillCol = findCol(invRows, 'ΑΝΑΤΡΟΦΟΔΟΣΙΑ');
    const priceCol = findCol(invRows, 'ΤΙΜΗ ΠΩΛΗΣΗΣ');
    const groupCol = findCol(invRows, 'ΟΜΑΔΑ');

    return invRows.map((row, idx) => {
      const code = String(row[codeCol] ?? '').trim();
      const desc = String(row[descCol] ?? '').trim();
      const stock = parseNum(row[stockCol]);
      const cost = parseNum(row[costCol]);
      const price = parseNum(row[priceCol]) || cost;
      const evalGrade = String(row[evalCol] ?? 'B').trim().toUpperCase();
      const needsRefill = parseNum(row[refillCol]) > 0;
      const group = String(row[groupCol] ?? '').trim();

      const marginPct = price > 0 && cost > 0 ? ((price - cost) / price) * 100 : 0;
      const marginTier: Product['margin_tier'] = marginPct > 30 ? 'high' : marginPct > 15 ? 'medium' : 'low';

      let tag: string | undefined;
      if (stock === 0 || evalGrade === 'C') tag = 'dead';
      else if (needsRefill) tag = 'low';
      else if (evalGrade === 'A') tag = 'healthy';
      else tag = 'excess';

      return {
        id: code || `proc-${idx}`,
        name: desc || code,
        sku: code,
        category: group,
        margin_tier: marginTier,
        margin_percentage: Math.round(marginPct * 10) / 10,
        stock_level: stock,
        stock_capacity: stock * 2,
        stock_age_days: 0,
        priority_tag: tag,
        price,
        cost_price: cost,
      } as Product;
    });
  }, [isEnterprise, procData.inventory]);

  const usingProcurement = procProducts.length > 0;
  // Demo products φιλτράρονται και εδώ για να ισχύει σε όλους τους aggregates.
  const products = excludeDemoProducts(usingProcurement ? procProducts : productHook.products);

  /** Μέχρι να ολοκληρωθεί και το procurement (Enterprise), μην εμφανίζεις κενή σελίδα «χωρίς προϊόντα». */
  const isLoading =
    productHook.isLoading || (isEnterprise && procurementLoading);

  return {
    products,
    count: products.length,
    isLoading,
    hasImported: productHook.hasImported || usingProcurement,
    usingProcurement,
  };
}
