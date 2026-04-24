/**
 * Sync logic with `src/utils/productLineStats.ts` — Magento parent line items (configurable/bundle/grouped).
 */
export type ProductLineItemLike = {
  sku?: string;
  title?: string;
  name?: string;
  quantity?: number;
  price?: number;
  productType?: string;
  parentItemId?: string | number | null;
  rowTotal?: number;
};

const MAGENTO_PARENT_LINE_TYPES = new Set(['configurable', 'bundle', 'grouped']);

function lineHasParentItemId(line: ProductLineItemLike): boolean {
  const pid = line.parentItemId;
  if (pid === undefined || pid === null) return false;
  const n = typeof pid === 'number' ? pid : parseFloat(String(pid).trim());
  return Number.isFinite(n) && n > 0;
}

export function shouldSkipMagentoLineForTopProducts(line: ProductLineItemLike): boolean {
  const t = String(line.productType || '')
    .trim()
    .toLowerCase();
  if (!t) return false;
  if (lineHasParentItemId(line)) return false;
  return MAGENTO_PARENT_LINE_TYPES.has(t);
}

export function lineRevenueAndQtyForTopProducts(
  platform: string,
  line: ProductLineItemLike
): { revenue: number; quantity: number } | null {
  if (platform === 'magento' && shouldSkipMagentoLineForTopProducts(line)) {
    return null;
  }
  const qty = Math.max(0, Number(line.quantity) || 0);
  if (qty <= 0) return null;

  const unit = Number(line.price) || 0;
  const rt = line.rowTotal;
  let revenue: number;
  if (platform === 'magento' && typeof rt === 'number' && !Number.isNaN(rt) && rt >= 0) {
    revenue = rt;
  } else {
    revenue = unit * qty;
  }
  if (revenue < 0) revenue = 0;
  return { revenue, quantity: qty };
}
