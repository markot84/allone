/**
 * Build server-side aggregations for a brand by calling the COMPILED aggregator
 * logic directly via the Admin SDK. MUST run from the functions/ directory so that
 * firebase-admin resolves to functions/node_modules (same instance the aggregators
 * use → FieldValue sentinels + default app match).
 *
 * Prereq:  npm run build   (in functions/)
 * Usage:   node refresh-demo-aggregates.mjs [serviceAccountKey.json] [--brand=sportflow-demo]
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import * as ecom from './lib/ecommerceAggregator.js';
import * as stock from './lib/stockMovementTracker.js';
import * as prodIntel from './lib/productIntelligenceAggregator.js';
import * as rfm from './lib/dataAnalysisRfmAggregator.js';
import * as aggStats from './lib/aggregateStats.js';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'performance-plus-4a5b2';
const args = process.argv.slice(2);
const flags = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const keyPath = args.find((a) => !a.startsWith('--')) || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const BRAND_ID = (flags.brand || 'sportflow-demo').toString();

// Default app (no name) so getFirestore() inside aggregateStats resolves correctly.
initializeApp(
  keyPath ? { credential: cert(keyPath), projectId: PROJECT_ID } : { credential: applicationDefault(), projectId: PROJECT_ID }
);
const db = getFirestore();

for (const m of [ecom, stock, prodIntel, rfm]) {
  if (typeof m.setDb === 'function') m.setDb(db);
}

async function step(label, fn) {
  process.stdout.write(`→ ${label}… `);
  try {
    const r = await fn();
    console.log('ok', r && typeof r === 'object' ? JSON.stringify(r).slice(0, 160) : '');
  } catch (e) {
    console.log('FAILED:', e?.message || e);
  }
}

(async () => {
  console.log(`\nBuilding aggregations for brand "${BRAND_ID}"\n`);
  await step('ecommerce summary (+ sku_stats, business revenue)', () => ecom.computeEcommerceSummary(BRAND_ID));
  await step('stock movement', () => stock.refreshStockMovement(BRAND_ID));
  await step('dashboard aggregates', () => aggStats.computeAggregatesForBrand(BRAND_ID));
  await step('product intelligence', () => prodIntel.refreshProductIntelligenceAggregate(BRAND_ID));
  await step('data analysis RFM', () => rfm.refreshDataAnalysisRfmAggregate(BRAND_ID));
  console.log('\n✅ Aggregations rebuilt.\n');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
