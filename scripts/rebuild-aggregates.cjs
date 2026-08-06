/**
 * Rebuild a brand's aggregates locally, without the HTTP layer.
 *
 * Usage: node scripts/rebuild-aggregates.cjs <brandId>
 *   e.g. node scripts/rebuild-aggregates.cjs sportflow-demo
 *
 * Why this exists: `ecommerce_summary`, `data_analysis_rfm` and `product_intelligence` are built by
 * Cloud Functions, and the only way to ask for them from outside is the HTTPS wrapper — which needs
 * a Firebase ID token. Minting one for a user requires a service account key, because
 * `createCustomToken` has to sign a blob and user ADC cannot. That makes a routine "rebuild the demo
 * brand" step depend on a downloaded private key.
 *
 * But the wrapper only does two things: verify the caller is a member of the brand, then call the
 * aggregator. The aggregator itself is an ordinary exported function over Firestore. Anyone holding
 * Admin credentials has already cleared the check the wrapper performs, so calling it directly is
 * the same work with one less hop — and it runs the REAL production code out of `functions/lib`,
 * not a reimplementation that could drift from it.
 *
 * Requires: `cd functions && npm run build` at least once, and Application Default Credentials
 * (`gcloud auth application-default login`) for a principal with Firestore access.
 *
 * Two of the three modules keep a module-level Firestore handle and expose `setDb`; the third falls
 * back to `admin.firestore()`. Hence the mixed initialisation below — it is not redundant.
 */
const path = require('node:path');

const FUNCTIONS_DIR = path.join(__dirname, '..', 'functions');

/**
 * Resolved out of `functions/node_modules`, NOT the repo root.
 *
 * The aggregators call `admin.firestore()` and `FieldValue.serverTimestamp()` against whichever
 * copy of firebase-admin they themselves resolved. Loading a second copy here gives you two
 * unrelated module instances: `initializeApp` on one leaves the other with no default app, and a
 * sentinel minted by one is an unrecognised object to the other ("Couldn't serialize object of type
 * ServerTimestampTransform"). Both failures look like configuration problems and are not.
 */
const admin = require(require.resolve('firebase-admin', { paths: [FUNCTIONS_DIR] }));

const brandId = process.argv[2];
if (!brandId) {
  console.error('Usage: node scripts/rebuild-aggregates.cjs <brandId>');
  process.exit(1);
}

const projectId = process.env.FIREBASE_PROJECT_ID || 'allone-9e685';
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
const db = admin.firestore();

const lib = (name) => {
  const file = path.join(FUNCTIONS_DIR, 'lib', `${name}.js`);
  try {
    return require(file);
  } catch (err) {
    console.error(`Cannot load ${name}. Run \`cd functions && npm run build\` first.\n  ${err.message}`);
    process.exit(1);
  }
};

const ecommerce = lib('ecommerceAggregator');
const rfm = lib('dataAnalysisRfmAggregator');
const productIntelligence = lib('productIntelligenceAggregator');

rfm.setDb(db);
productIntelligence.setDb(db);

const steps = [
  ['ecommerce_summary', () => ecommerce.computeEcommerceSummary(brandId)],
  ['data_analysis_rfm', () => rfm.refreshDataAnalysisRfmAggregate(brandId)],
  ['product_intelligence', () => productIntelligence.refreshProductIntelligenceAggregate(brandId)],
];

(async () => {
  console.log(`Rebuilding aggregates for "${brandId}" in ${projectId}…\n`);
  let failed = 0;
  for (const [name, run] of steps) {
    const started = Date.now();
    try {
      await run();
      console.log(`✓ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    } catch (err) {
      failed += 1;
      console.error(`✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
})();
