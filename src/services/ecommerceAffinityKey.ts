import type { EcommerceRawLineItem } from './ecommerceRawOrders';

/** Structural Magento types — not merchandising categories. */
const IGNORE_PRODUCT_TYPES_FOR_AFFINITY = new Set([
  'simple',
  'configurable',
  'grouped',
  'bundle',
  'virtual',
  'downloadable',
]);

/** Normalize SKU for joins (trim + uppercase). */
export function normalizeSku(raw: string | undefined | null): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** Heuristic bucket label for line-level aggregates when catalog match is missing. */
export function ecommerceLineAffinityKey(item: EcommerceRawLineItem): string {
  const rawType = item.productType?.trim();
  const t = rawType?.toLowerCase() ?? '';
  if (rawType && !IGNORE_PRODUCT_TYPES_FOR_AFFINITY.has(t)) {
    return rawType;
  }
  return item.name?.trim() || item.title?.trim() || item.sku?.trim() || item.productId?.trim() || 'Άλλο';
}
