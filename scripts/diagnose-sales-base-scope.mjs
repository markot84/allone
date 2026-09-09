/**
 * Read-only probe: reconcile the SKU universes that Sales Optimization, Product Intelligence and
 * the "no sale in 90 days" figures each count.
 *   node scripts/diagnose-sales-base-scope.mjs <brand-substring> [projectId]
 *
 * Rebuilds, from the same Product Intelligence pages the app reads:
 *   - grouped (parent/model) in-stock set  → what useInStockProducts serves by default
 *   - the same set after getEffectiveStockLevel() > 0 → what useBoundedProductSource passes to
 *     SalesBaseSetupModal, i.e. the modal's «all» count
 *   - variant-level in-stock set → the pre-PER-319 universe
 *   - how many of each have no sale in the last 90 days
 * Uses Application Default Credentials. Nothing brand-specific: every number comes from the
 * brand's own aggregate.
 */
import admin from 'firebase-admin';

const [brandFilter = '', projectId = 'performanceplus-staging'] = process.argv.slice(2);
if (!brandFilter) {
  console.error('usage: node scripts/diagnose-sales-base-scope.mjs <brand-substring> [projectId]');
  process.exit(1);
}
admin.initializeApp({ projectId });
const db = admin.firestore();

const IN_STOCK = ['healthy', 'low', 'dead', 'excess'];
const DAY = 86400000;

/** Mirrors src/utils/productUtils.ts getEffectiveStockLevel. */
const effectiveStock = (p) => p.stock_on_hand ?? p.stock_level ?? 0;

const daysSince = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : Math.floor((Date.now() - t) / DAY);
};

/** No sale in the last 90 days, by the strongest signal each row carries. */
function noSale90(p) {
  if (p.qty_sold_last_90d != null) return p.qty_sold_last_90d === 0;
  const d = daysSince(p.last_sale_at);
  if (d != null) return d > 90;
  if (p.qty_sold_period != null) return p.qty_sold_period === 0;
  return null; // no signal at all
}

async function loadPages(brandId, counts, grouped) {
  const rows = [];
  for (const bucket of IN_STOCK) {
    const n = counts?.[bucket] ?? 0;
    for (let page = 1; page <= n; page += 1) {
      const id = grouped ? `${brandId}_g_${bucket}_${page}` : `${brandId}_${bucket}_${page}`;
      const snap = await db.doc(`product_intelligence_pages/${id}`).get();
      if (snap.exists) for (const r of snap.get('products') || []) rows.push(r);
    }
  }
  return rows;
}

function report(label, rows) {
  const withStock = rows.filter((r) => effectiveStock(r) > 0);
  const noSale = withStock.filter((r) => noSale90(r) === true).length;
  const unknown = withStock.filter((r) => noSale90(r) === null).length;
  console.log(
    `${label.padEnd(38)} rows=${String(rows.length).padStart(6)}  effectiveStock>0=${String(withStock.length).padStart(6)}` +
    `  noSale90d=${String(noSale).padStart(6)}  noSignal=${String(unknown).padStart(6)}`
  );
  return withStock.length;
}

const brands = await db.collection('brands').get();
const matched = brands.docs.filter((d) =>
  String(d.get('name') || d.id).toLowerCase().includes(brandFilter.toLowerCase())
);

for (const b of matched) {
  const agg = (await db.doc(`product_intelligence/${b.id}`).get()).data();
  if (!agg) { console.log(`\n##### ${b.id}: no product_intelligence`); continue; }

  console.log(`\n##### brand ${b.id}  name=${b.get('name')}  project=${projectId}`);
  const s = agg.summary, g = agg.groupedSummary;
  const sum = (x) => x ? (x.healthy_stock?.count ?? 0) + (x.low_stock?.count ?? 0) + (x.dead_stock?.count ?? 0) + (x.excess_stock?.count ?? 0) : null;
  console.log(`aggregate: totalCount=${agg.totalCount}  summary in-stock=${sum(s)}  groupedSummary in-stock=${sum(g)} (total_skus=${g?.total_skus ?? '—'})`);
  console.log(`pages: variant=${JSON.stringify(agg.pagesByBucket)}  grouped=${JSON.stringify(agg.groupedPagesByBucket ?? null)}\n`);

  if (agg.groupedPagesByBucket) {
    report('GROUPED in-stock (app default)', await loadPages(b.id, agg.groupedPagesByBucket, true));
  }
  report('VARIANT in-stock (pre-PER-319)', await loadPages(b.id, agg.pagesByBucket, false));
}

process.exit(0);
