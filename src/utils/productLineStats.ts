/**
 * Ποσοστά top products / sold-by-SKU: Magento δίνει ξεχωριστές γραμμές γονέα (configurable/bundle/grouped)
 * και παιδιά (simple). Αν αθροίσουμε και τα δύο, ποσότητα/έσοδα φουσκώνουν (~2x).
 * Έσοδα γραμμής: προτιμάμε `row_total` (μετά εκπτώσεις) αντί για price×qty.
 */
export type ProductLineItemLike = {
  sku?: string;
  title?: string;
  name?: string;
  quantity?: number;
  price?: number;
  productType?: string;
  /** Magento order item_id — χρησιμοποιείται για απόρριψη γονικής γραμμής */
  itemId?: string | number | null;
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

/**
 * true = μην μετρήσεις αυτή τη γραμμή στα top products (Magento γονική γραμμή).
 * Παλιά documents χωρίς productType: false (συνεχίζουμε· χρειάζεται νέο sync για διόρθωση).
 */
export function shouldSkipMagentoLineForTopProducts(line: ProductLineItemLike): boolean {
  const t = String(line.productType || '')
    .trim()
    .toLowerCase();
  if (!t) return false;
  if (lineHasParentItemId(line)) return false;
  return MAGENTO_PARENT_LINE_TYPES.has(t);
}

/** Αφαιρεί τη γραμμή γονέα που φέρει `item_id` σαν `parent_item_id` σε άλλη γραμμή (αρχεία χωρίς product_type). */
export function filterMagentoLineItemsForTopProducts(
  platform: string,
  lines: ProductLineItemLike[] | undefined | null
): ProductLineItemLike[] {
  const arr = lines || [];
  if (platform !== 'magento' || arr.length === 0) return arr;
  const referencedParentIds = new Set<string>();
  for (const li of arr) {
    const pid = li.parentItemId;
    if (pid !== undefined && pid !== null) {
      referencedParentIds.add(String(pid));
    }
  }
  return arr.filter((li) => {
    const iid = li.itemId;
    if (iid === undefined || iid === null) return true;
    return !referencedParentIds.has(String(iid));
  });
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
