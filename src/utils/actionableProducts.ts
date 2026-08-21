import { getEffectiveStockLevel } from './productUtils';
import type { MagentoProductEnrichment } from '../hooks/useMagentoProductEnrichment';
import type { Product } from '../types';

export type ProductEnrichmentLookup = (sku: string) => MagentoProductEnrichment | null | undefined;

export interface DecisionProductRow {
  key: string;
  representative: Product;
  representativeEnrichment?: MagentoProductEnrichment | null;
  skus: string[];
  totalStock: number;
  totalValue: number;
  minPrice: number;
  maxPrice: number;
  category: string;
  variantCount: number;
  priorityTag: string;
  marginPercentage: number;
}

const INACTIVE_STATUS_MARKERS = [
  'inactive',
  'disabled',
  'discontinued',
  'deleted',
  'archived',
  'ανενεργ',
  'ανενεργο',
  'καταργ',
  'διακοπ',
  'εξαντλη',
];

export function getEffectiveStock(product: Product): number {
  return getEffectiveStockLevel(product); // PER-306: one canonical stock order (was available_stock-first = ERP on-hand incl. unreceived POs)
}

export function hasInactiveProductStatus(product: Product): boolean {
  const raw = [product.status, product.procurement_status].filter(Boolean).join(' ').toLowerCase();
  if (!raw) return false;
  return INACTIVE_STATUS_MARKERS.some((marker) => raw.includes(marker));
}

export function isActionableStockProduct(product: Product): boolean {
  return getEffectiveStock(product) > 0 && !hasInactiveProductStatus(product);
}

function normalizeSkuPart(value: string): string {
  return value.trim().replace(/\s+/g, '').toUpperCase();
}

/** Declared relations only (Magento itemGroupId) — the old split/first-segment fallback grouped
 * unrelated SKUs by prefix coincidence; without a declared parent a SKU is its own group (matches PI). */
export function getProductDecisionKey(
  product: Product,
  enrichment?: MagentoProductEnrichment | null
): string {
  const itemGroupId = normalizeSkuPart(enrichment?.itemGroupId ?? '');
  if (itemGroupId) return itemGroupId;
  return normalizeSkuPart(product.sku || product.id);
}

export function groupProductsForDecisionExport(
  products: Product[],
  lookupEnrichment?: ProductEnrichmentLookup
): DecisionProductRow[] {
  const groups = new Map<string, DecisionProductRow>();

  for (const product of products) {
    if (!isActionableStockProduct(product)) continue;
    const enrichment = lookupEnrichment?.(product.sku || '') ?? null;
    const key = getProductDecisionKey(product, enrichment);
    if (!key) continue;

    const stock = getEffectiveStock(product);
    const price = Number(product.price ?? 0) || 0;
    const value = stock * price;
    const margin = Number(product.margin_percentage ?? 0) || 0;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        representative: product,
        representativeEnrichment: enrichment,
        skus: product.sku ? [product.sku] : [],
        totalStock: stock,
        totalValue: value,
        minPrice: price,
        maxPrice: price,
        category: product.category || '',
        variantCount: 1,
        priorityTag: String(product.priority_tag || ''),
        marginPercentage: margin,
      });
      continue;
    }

    if (product.sku && !existing.skus.includes(product.sku)) existing.skus.push(product.sku);
    existing.totalStock += stock;
    existing.totalValue += value;
    existing.minPrice = Math.min(existing.minPrice, price);
    existing.maxPrice = Math.max(existing.maxPrice, price);
    existing.variantCount += 1;
    existing.marginPercentage = Math.round(
      ((existing.marginPercentage * (existing.variantCount - 1)) + margin) / existing.variantCount * 10
    ) / 10;
    if (!existing.category && product.category) existing.category = product.category;

    const currentValue = getEffectiveStock(existing.representative) * (Number(existing.representative.price ?? 0) || 0);
    if (value > currentValue) {
      existing.representative = product;
      existing.representativeEnrichment = enrichment;
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (b.totalValue !== a.totalValue) return b.totalValue - a.totalValue;
    return a.key.localeCompare(b.key, 'el');
  });
}

