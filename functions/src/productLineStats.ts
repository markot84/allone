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

export function shouldSkipMagentoLineForTopProducts(line: ProductLineItemLike): boolean {
  const t = String(line.productType || '')
    .trim()
    .toLowerCase();
  if (!t) return false;
  if (lineHasParentItemId(line)) return false;
  return MAGENTO_PARENT_LINE_TYPES.has(t);
}

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

export type AggregatedProductLine = { sku: string; name: string; revenue: number; quantity: number };

function rowTotalOf(line: ProductLineItemLike): number {
  const rt = line.rowTotal;
  return typeof rt === 'number' && !Number.isNaN(rt) && rt >= 0 ? rt : 0;
}

function lineSkuName(line: ProductLineItemLike): { sku: string; name: string } {
  const sku = String(line.sku || line.title || line.name || '').trim();
  return { sku, name: String(line.title || line.name || sku) };
}

/**
 * Sync logic with `src/utils/productLineStats.ts` — ενοποίηση γονικής/παιδικής γραμμής Magento.
 * revenue = parent.row_total αν > 0, αλλιώς άθροισμα παιδιών, αλλιώς price×qty. SKU/όνομα γονικής.
 */
export function aggregateOrderLinesForTopProducts(
  platform: string,
  lines: ProductLineItemLike[] | undefined | null
): AggregatedProductLine[] {
  const arr = lines || [];
  if (arr.length === 0) return [];

  if (platform !== 'magento') {
    const out: AggregatedProductLine[] = [];
    for (const li of arr) {
      const r = lineRevenueAndQtyForTopProducts(platform, li);
      if (!r) continue;
      const { sku, name } = lineSkuName(li);
      if (!sku) continue;
      out.push({ sku, name, revenue: r.revenue, quantity: r.quantity });
    }
    return out;
  }

  const hasItemStructure = arr.some((li) => li.itemId != null && li.itemId !== '');
  if (!hasItemStructure) {
    const out: AggregatedProductLine[] = [];
    for (const li of arr) {
      const r = lineRevenueAndQtyForTopProducts(platform, li);
      if (!r) continue;
      const { sku, name } = lineSkuName(li);
      if (!sku) continue;
      out.push({ sku, name, revenue: r.revenue, quantity: r.quantity });
    }
    return out;
  }

  const byItemId = new Map<string, ProductLineItemLike>();
  const childrenByParent = new Map<string, ProductLineItemLike[]>();
  for (const li of arr) {
    if (li.itemId != null && li.itemId !== '') byItemId.set(String(li.itemId), li);
  }
  for (const li of arr) {
    if (!lineHasParentItemId(li)) continue;
    const key = String(li.parentItemId);
    const list = childrenByParent.get(key) || [];
    list.push(li);
    childrenByParent.set(key, list);
  }

  const out: AggregatedProductLine[] = [];
  for (const li of arr) {
    if (lineHasParentItemId(li) && byItemId.has(String(li.parentItemId))) continue;

    const qty = Math.max(0, Number(li.quantity) || 0);
    if (qty <= 0) continue;

    const iid = li.itemId != null && li.itemId !== '' ? String(li.itemId) : null;
    const children = iid ? childrenByParent.get(iid) || [] : [];

    let revenue = rowTotalOf(li);
    if (revenue <= 0) {
      const childRt = children.reduce((s, c) => s + rowTotalOf(c), 0);
      revenue = childRt > 0 ? childRt : (Number(li.price) || 0) * qty;
    }
    if (revenue < 0) revenue = 0;

    const { sku, name } = lineSkuName(li);
    if (!sku) continue;
    out.push({ sku, name, revenue, quantity: qty });
  }
  return out;
}
