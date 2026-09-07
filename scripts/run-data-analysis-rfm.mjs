/**
 * Runs the Data Analysis RFM aggregator for one brand, exactly as the scheduled job and the
 * «Ανανέωση Ανάλυσης» button do, but from a terminal with Application Default Credentials.
 *   node scripts/run-data-analysis-rfm.mjs <brandId> [projectId]
 * Build the functions first (cd functions && npm run build) — this imports the compiled lib so the
 * code that runs is the code that was deployed. Writes data_analysis_rfm/{brandId} and the
 * brand's data_analysis_rfm rows in segment_customers; the ERP writer's rows are untouched.
 *
 * firebase-admin is resolved from functions/node_modules on purpose: the compiled lib builds its
 * FieldValue/Timestamp objects from that copy, and a Firestore instance from the root copy rejects
 * them as "objects with custom prototypes".
 */
import { createRequire } from 'node:module';

const requireFromFunctions = createRequire(new URL('../functions/package.json', import.meta.url));
const admin = requireFromFunctions('firebase-admin');
const aggregator = requireFromFunctions('./lib/dataAnalysisRfmAggregator.js');

const [brandId = '', projectId = 'performanceplus-staging'] = process.argv.slice(2);
if (!brandId) {
  console.error('usage: node scripts/run-data-analysis-rfm.mjs <brandId> [projectId]');
  process.exit(1);
}

admin.initializeApp({ projectId });
aggregator.setDb(admin.firestore());

const t0 = Date.now();
console.log(`project=${projectId} brand=${brandId} — running refreshDataAnalysisRfmAggregate…`);
const result = await aggregator.refreshDataAnalysisRfmAggregate(brandId);
console.log(`done in ${Math.round((Date.now() - t0) / 1000)}s`);
const summary = { status: result.status, processedOrders: result.processedOrders, pages: result.pages, syncVersion: result.syncVersion, error: result.error };
console.log(JSON.stringify(summary));
