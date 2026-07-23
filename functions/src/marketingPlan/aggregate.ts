/**
 * PER-157 — server-side builder for `marketing_plan_insight/{brandId}`.
 *
 * Streams the brand's ~222k products (`.select()` + `.stream()` — the aggregateStats heap-safe
 * pattern), reads the procurement_signals doc, loads last-year orders per preset window, and runs
 * the PORTED `buildMarketingPlanInsight` once per preset. Writes one compact JSON-blob doc the
 * client reads instead of loading the catalog — killing the ~1.6s main-thread freeze (PER-157).
 *
 * Parity: the compute is byte-identical to the client (see marketingPlanInsightsParity.test.ts).
 * TZ note: GCP runs UTC; the period + last-year-window derivation (resolvePlanPeriod /
 * shiftIsoDateByYears) is therefore UTC-native and SELF-CONSISTENT here. The client's local-TZ
 * (Athens) plan dates can differ by ±1 day at month boundaries — the client renders the doc's
 * (server/UTC) dates, so there is no live mismatch.
 */
import { getFirestore, type Firestore, FieldValue, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { logger } from '../utils/logger';
import {
  buildMarketingPlanInsight,
  shiftIsoDateByYears,
  type MarketingPlanInsight,
  type MarketingPlanPeriod,
} from './marketingPlanInsights';
import { resolvePlanPeriod, MARKETING_PLAN_PRESETS, type Product } from './shared';
import { loadMarketingPlanOrdersByWindow, type OrderWindow } from './orders';

let _db: Firestore | null = null;
export function setDb(db: Firestore) { _db = db; }
function db(): Firestore { return _db ?? (_db = getFirestore()); }

/** The only product fields `buildMarketingPlanInsight` reads (+ doc id). Projected to stay heap-safe. */
const PRODUCT_FIELDS = [
  'sku', 'name', 'category', 'subcategory', 'brand',
  'available_stock', 'stock_on_hand', 'stock_level', 'cost_price', 'price',
];

/** sku → declared parent (magento_products itemGroupId); streamed + projected, ~25k docs max. */
async function loadParentSkuMap(brandId: string): Promise<Record<string, string>> {
  const query = db().collection('magento_products').where('brandId', '==', brandId).select('sku', 'itemGroupId');
  const map: Record<string, string> = {};
  for await (const doc of query.stream() as AsyncIterable<QueryDocumentSnapshot>) {
    const d = doc.data();
    const sku = String(d.sku || '').trim();
    const parent = String(d.itemGroupId || '').trim();
    if (sku && parent && parent !== sku) map[sku] = parent;
  }
  return map;
}

async function streamProducts(brandId: string): Promise<Product[]> {
  const query = db().collection('products').where('brandId', '==', brandId).select(...PRODUCT_FIELDS);
  const products: Product[] = [];
  for await (const doc of query.stream() as AsyncIterable<QueryDocumentSnapshot>) {
    products.push({ id: doc.id, ...doc.data() });
  }
  return products;
}

export interface RefreshMarketingPlanInsightResult {
  brandId: string;
  status: 'ready';
  productCount: number;
  signalCount: number;
  orderCounts: Record<string, number>;
  bytesJson: number;
}

/** Build + persist `marketing_plan_insight/{brandId}` for all presets. Sets status running→ready,
 *  or failed (with error) on throw. */
export async function refreshMarketingPlanInsightAggregate(
  brandId: string
): Promise<RefreshMarketingPlanInsightResult> {
  const ref = db().doc(`marketing_plan_insight/${brandId}`);
  await ref.set({ brandId, status: 'running', updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  try {
    // 1) products (streamed, projected) + 2) procurement signals
    const [products, sigSnap, parentSkuBySku] = await Promise.all([
      streamProducts(brandId),
      db().doc(`procurement_signals/${brandId}`).get(),
      loadParentSkuMap(brandId),
    ]);
    const sigData = sigSnap.data() || {};
    const signals = JSON.parse((sigData.skuSignalsJson as string) || '{}') as Record<string, any>;
    const signalCount = Object.keys(signals).length;

    // 3) periods (all presets) + their last-year order windows
    const periods: MarketingPlanPeriod[] = MARKETING_PLAN_PRESETS.map((presetId) => {
      const p = resolvePlanPeriod(presetId);
      return { presetId, periodLabel: p.periodLabel, fromDate: p.fromDate, toDate: p.toDate };
    });
    const windows: OrderWindow[] = periods.map((p) => ({
      key: p.presetId,
      sinceDate: shiftIsoDateByYears(p.fromDate, -1),
      untilDate: shiftIsoDateByYears(p.toDate, -1),
    }));
    const ordersByWindow = await loadMarketingPlanOrdersByWindow(db(), brandId, windows);

    // 4) compute insight per preset (shared products + signals)
    const byPreset: Record<string, MarketingPlanInsight> = {};
    const orderCounts: Record<string, number> = {};
    for (const period of periods) {
      const lastYearOrders = ordersByWindow[period.presetId] || [];
      orderCounts[period.presetId] = lastYearOrders.length;
      byPreset[period.presetId] = buildMarketingPlanInsight({
        period,
        lastYearOrders,
        inventoryProducts: products,
        procurementSignals: signals,
        parentSkuBySku,
      });
    }

    // 5) persist (JSON blob, the procurement_signals pattern — avoids the 20k index-entry limit)
    const insightsJson = JSON.stringify(byPreset);
    const sigComputedAt = (sigData.computedAt as { toMillis?: () => number })?.toMillis?.() ?? 0;
    const sourceFingerprint = `${products.length}|${signalCount}|${sigComputedAt}`;
    await ref.set({
      brandId,
      status: 'ready',
      insightsJson,
      presets: MARKETING_PLAN_PRESETS,
      productCount: products.length,
      signalCount,
      sourceFingerprint,
      computedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      error: FieldValue.delete(),
    }, { merge: true });

    logger.info(
      `[MarketingPlanInsight] ${brandId}: ${products.length} products, ${signalCount} signals, ` +
      `${(insightsJson.length / 1024).toFixed(1)}KB, orders=${JSON.stringify(orderCounts)}`
    );
    return { brandId, status: 'ready', productCount: products.length, signalCount, orderCounts, bytesJson: insightsJson.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[MarketingPlanInsight] ${brandId} failed: ${message}`, { err: error });
    await ref.set({ brandId, status: 'failed', error: message, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      .catch(() => { /* best-effort */ });
    throw error;
  }
}
