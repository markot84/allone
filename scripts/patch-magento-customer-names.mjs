/**
 * patch-magento-customer-names.mjs
 *
 * Patches `customerName` onto e-tennis magento_orders documents in Firestore.
 *
 * Background
 * ----------
 * The `customerName` field was added to the Magento connector in the 511f535
 * commit. All previously synced docs (~110K for e-tennis) have NO name data
 * stored in Firestore (the old connector never saved raw firstname/lastname
 * fields). This script fetches names directly from the Magento REST API using
 * a minimal field set (entity_id + names only — no line items, no products),
 * which completes in ~6-15 minutes instead of a full 3-4 hour re-sync.
 *
 * Prerequisites
 * -------------
 * 1. Service account key from Firebase Console → Project Settings → Service Accounts
 *    Set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 *    OR pass path as first CLI argument.
 *
 * 2. To decrypt the stored Magento token automatically:
 *    Set CONNECTOR_TOKEN_KEY=<64-hex-char key from Secret Manager>
 *    If this is not available, provide the plain token via MAGENTO_TOKEN env var.
 *    (Get plain token from Magento Admin → System → Integrations → e-tennis)
 *
 * 3. Optional:
 *    BRAND_ID=e-tennis        (default: e-tennis)
 *    DRY_RUN=true             (log only, no Firestore writes)
 *    MAGENTO_PAGE_SIZE=300    (orders per Magento API call)
 *    SKIP_SYNC_STATE=true     (don't restore connectors/e-tennis sync state)
 *    SKIP_AGGREGATION=true    (don't trigger ecommerceAggregator at the end)
 *    AGGREGATOR_URL=https://... (explicit aggregator Cloud Function URL)
 *
 * Usage
 * -----
 *   GOOGLE_APPLICATION_CREDENTIALS=./serviceAccount.json \
 *   CONNECTOR_TOKEN_KEY=abc123... \
 *   node scripts/patch-magento-customer-names.mjs
 *
 *   # Dry run first:
 *   DRY_RUN=true node scripts/patch-magento-customer-names.mjs ./serviceAccount.json
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createDecipheriv, scryptSync } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import https from 'https';
import http from 'http';

// ── Config ──────────────────────────────────────────────────────────────────

const BRAND_ID       = process.env.BRAND_ID       || 'e-tennis';
const DRY_RUN        = process.env.DRY_RUN        === 'true';
const PAGE_SIZE      = parseInt(process.env.MAGENTO_PAGE_SIZE || '300', 10);
const WRITE_BATCH    = 500;   // Firestore max
const LOG_EVERY      = 1000;  // log progress every N docs

// The Magento connector config for e-tennis (from connectors/e-tennis doc)
const DEFAULT_MAGENTO_BASE   = 'https://www.e-tennis.gr';
// Use 'all' store code to get orders across all Magento store views for this brand.
// The connector might store storeCode='storeviewgreek', but for a complete name fetch
// we want all stores (e-tennis runs GR/BG/RO/CY views on the same backend).
const DEFAULT_STORE_CODE     = 'all';

// Minimum fields we need from Magento (saves bandwidth / time vs full sync)
const MAGENTO_FIELDS = [
  'items[entity_id,customer_firstname,customer_lastname,billing_address[firstname,lastname]]',
  'total_count',
].join(',');

// ── Token decryption (mirrors tokenCrypto.ts) ────────────────────────────────

const ENC_PREFIX = 'enc:v1:';

function decryptToken(value) {
  if (!value) return '';
  if (!value.startsWith(ENC_PREFIX)) return value; // plain text token

  const keyHex = process.env.CONNECTOR_TOKEN_KEY?.trim() || '';
  if (!keyHex) {
    console.error('[crypto] CONNECTOR_TOKEN_KEY not set — cannot decrypt token.');
    console.error('         Set CONNECTOR_TOKEN_KEY or provide MAGENTO_TOKEN directly.');
    return '';
  }

  let key;
  if (/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    key = Buffer.from(keyHex, 'hex');
  } else {
    key = scryptSync(keyHex, 'pp.connector.token.salt.v1', 32);
  }

  try {
    const body = value.slice(ENC_PREFIX.length);
    const idx = body.indexOf(':');
    if (idx < 1) return '';
    const nonce   = Buffer.from(body.slice(0, idx), 'base64url');
    const payload = Buffer.from(body.slice(idx + 1), 'base64url');
    if (nonce.length !== 12 || payload.length < 17) return '';
    const tag = payload.slice(payload.length - 16);
    const ct  = payload.slice(0, payload.length - 16);
    const dec = createDecipheriv('aes-256-gcm', key, nonce);
    dec.setAuthTag(tag);
    return Buffer.concat([dec.update(ct), dec.final()]).toString('utf8');
  } catch (err) {
    console.error('[crypto] decrypt failed:', err.message);
    return '';
  }
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

function fetchJson(url, headers = {}, retries = 3) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib    = parsed.protocol === 'https:' ? https : http;

    const attempt = (attemptsLeft) => {
      const req = lib.get(url, { headers }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(new Error(`JSON parse error: ${e.message}\nBody: ${body.slice(0, 200)}`)); }
          } else if (res.statusCode === 429 || res.statusCode >= 500) {
            if (attemptsLeft > 1) {
              const delay = (4 - attemptsLeft) * 2000;
              console.warn(`  HTTP ${res.statusCode} — retrying in ${delay}ms (${attemptsLeft - 1} left)`);
              setTimeout(() => attempt(attemptsLeft - 1), delay);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          }
        });
        res.on('error', reject);
      });
      req.on('error', (err) => {
        if (attemptsLeft > 1) {
          console.warn(`  Network error (${err.message}) — retrying...`);
          setTimeout(() => attempt(attemptsLeft - 1), 2000);
        } else {
          reject(err);
        }
      });
      req.setTimeout(30000, () => {
        req.destroy(new Error('Request timeout (30s)'));
      });
    };

    attempt(retries);
  });
}

// ── Magento helpers ──────────────────────────────────────────────────────────

/**
 * Fetch one page of orders with minimal fields from Magento REST API.
 * Returns { items, total_count }
 */
async function fetchMagentoOrdersPage(baseUrl, storeCode, token, pageNum, pageSize) {
  const params = new URLSearchParams({
    'searchCriteria[pageSize]':    String(pageSize),
    'searchCriteria[currentPage]': String(pageNum),
    'fields': MAGENTO_FIELDS,
  });
  const url = `${baseUrl}/rest/${storeCode}/V1/orders?${params}`;
  return fetchJson(url, {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  });
}

function buildCustomerName(item) {
  const fn = String(item.customer_firstname || item.billing_address?.firstname || '').trim();
  const ln = String(item.customer_lastname  || item.billing_address?.lastname  || '').trim();
  return [fn, ln].filter(Boolean).join(' ');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log(`patch-magento-customer-names  |  brand: ${BRAND_ID}`);
  if (DRY_RUN) console.log('*** DRY RUN — no Firestore writes ***');
  console.log('='.repeat(60));

  // ── 1. Init Firebase Admin ────────────────────────────────────────────────
  const keyPath = process.argv[2] || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('ERROR: provide service account key path as argument or via GOOGLE_APPLICATION_CREDENTIALS');
    process.exit(1);
  }

  const absoluteKeyPath = resolve(process.cwd(), keyPath);
  const serviceAccount  = JSON.parse(readFileSync(absoluteKeyPath, 'utf8'));
  const app = initializeApp({ credential: cert(serviceAccount) });
  const db  = getFirestore(app);
  console.log('Firebase Admin initialized.');

  // ── 2. Read Magento credentials from Firestore connectors/{brandId} ────────
  let magentoToken  = process.env.MAGENTO_TOKEN || '';
  let magentoBase   = process.env.MAGENTO_BASE  || DEFAULT_MAGENTO_BASE;
  let storeCode     = process.env.MAGENTO_STORE || DEFAULT_STORE_CODE;

  if (!magentoToken) {
    console.log('Reading Magento credentials from Firestore…');
    const connSnap = await db.doc(`connectors/${BRAND_ID}`).get();
    if (!connSnap.exists) {
      console.error(`ERROR: connectors/${BRAND_ID} not found in Firestore.`);
      process.exit(1);
    }
    const connData = connSnap.data();
    const magento  = connData?.magento || {};
    const encrypted = magento.accessToken || '';
    magentoToken = decryptToken(encrypted);
    if (!magentoToken) {
      console.error('ERROR: Could not obtain a Magento access token.');
      console.error('  Set CONNECTOR_TOKEN_KEY or provide MAGENTO_TOKEN directly.');
      process.exit(1);
    }
    magentoBase = magento.restApiBase || DEFAULT_MAGENTO_BASE;
    // Always use 'all' store scope when fetching names so we cover every
    // store view (GR/BG/RO/CY). The individual storeCode in the connector
    // is only used for targeted syncs; here we want all orders.
    storeCode   = DEFAULT_STORE_CODE;
    console.log(`  Magento base: ${magentoBase}  storeCode: ${storeCode}`);
  } else {
    console.log(`Using MAGENTO_TOKEN from env. Base: ${magentoBase}  storeCode: ${storeCode}`);
  }

  // ── 3. Page through Magento to build entity_id → customerName map ─────────
  console.log('\nStep 1: Fetching customer names from Magento API…');
  console.log(`  Endpoint: ${magentoBase}/rest/${storeCode}/V1/orders (minimal fields)`);

  const nameMap = new Map(); // entity_id (string) → customerName (string)
  let page = 1;
  let totalMagentoOrders = 0;

  while (true) {
    const result = await fetchMagentoOrdersPage(magentoBase, storeCode, magentoToken, page, PAGE_SIZE);
    const items  = result.items || [];

    if (page === 1) {
      totalMagentoOrders = result.total_count || 0;
      console.log(`  Total Magento orders: ${totalMagentoOrders}`);
      console.log(`  Pages to fetch: ${Math.ceil(totalMagentoOrders / PAGE_SIZE)}`);
    }

    for (const item of items) {
      const eid  = String(item.entity_id);
      const name = buildCustomerName(item);
      if (eid && name) nameMap.set(eid, name);
    }

    if (page % 10 === 0 || items.length < PAGE_SIZE) {
      console.log(`  Fetched page ${page} (${nameMap.size} names so far)`);
    }

    if (items.length < PAGE_SIZE) break;
    page++;
    // Small delay to be courteous to the Magento server
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`  Done. ${nameMap.size} names collected from ${totalMagentoOrders} Magento orders.`);

  // ── 4. Stream e-tennis magento_orders from Firestore ─────────────────────
  console.log(`\nStep 2: Reading e-tennis magento_orders from Firestore…`);

  const ordersRef = db.collection('magento_orders');
  const query     = ordersRef.where('brandId', '==', BRAND_ID);
  const snap      = await query.get();

  console.log(`  Total e-tennis docs: ${snap.size}`);

  // ── 5. Identify docs missing customerName and patch them ──────────────────
  const toUpdate = []; // { ref, customerName }
  let alreadyHasName = 0;
  let noMatchInMagento = 0;
  let emptyName = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.customerName) {
      alreadyHasName++;
      continue;
    }
    const orderId = String(data.orderId || '');
    if (!orderId) { noMatchInMagento++; continue; }
    const name = nameMap.get(orderId) || '';
    if (!name) { noMatchInMagento++; continue; }
    toUpdate.push({ ref: doc.ref, customerName: name });
  }

  console.log(`  Already have customerName: ${alreadyHasName}`);
  console.log(`  Will patch:                ${toUpdate.length}`);
  console.log(`  No Magento match / empty:  ${noMatchInMagento}`);

  if (toUpdate.length === 0) {
    console.log('\nNothing to patch. Done!');
    await summarize(db, BRAND_ID, snap.size, alreadyHasName, 0, noMatchInMagento, emptyName);
    process.exit(0);
  }

  // ── 6. Batch-write customerName ──────────────────────────────────────────
  console.log(`\nStep 3: Writing customerName to Firestore (batch size ${WRITE_BATCH})…`);
  let written = 0;

  for (let i = 0; i < toUpdate.length; i += WRITE_BATCH) {
    const chunk = toUpdate.slice(i, i + WRITE_BATCH);
    if (!DRY_RUN) {
      const batch = db.batch();
      for (const { ref, customerName } of chunk) {
        batch.update(ref, { customerName });
      }
      await batch.commit();
    }
    written += chunk.length;
    if (written % LOG_EVERY === 0 || i + WRITE_BATCH >= toUpdate.length) {
      console.log(`  Written: ${written} / ${toUpdate.length}`);
    }
  }

  console.log(`  Done. ${written} docs patched.${DRY_RUN ? ' (DRY RUN — not actually written)' : ''}`);

  // ── 7. Restore sync state ─────────────────────────────────────────────────
  if (process.env.SKIP_SYNC_STATE !== 'true') {
    console.log('\nStep 4: Restoring Magento sync state in connectors/e-tennis…');
    if (!DRY_RUN) {
      await db.doc(`connectors/${BRAND_ID}`).update({
        // lastOrdersSyncAt: set to now so the next incremental sync only
        // looks at NEW orders created after this script ran.
        'magento.lastOrdersSyncAt': new Date(),
        // historyLoadedUntilYear: 2023 matches the current 3-year window
        // and prevents a full historical re-fetch on the next scheduled sync.
        'magento.historyLoadedUntilYear': 2023,
      });
      console.log('  Sync state restored (lastOrdersSyncAt=now, historyLoadedUntilYear=2023).');
    } else {
      console.log('  (dry run — skipped)');
    }
  }

  // ── 8. Re-aggregation instructions ───────────────────────────────────────
  // refreshAggregates requires a Firebase user ID token (not service account),
  // so we cannot call it directly from this script.
  console.log('\nStep 5: Re-aggregation (manual step required)');
  console.log('  The ecommerce_summary needs to be recomputed after the patch.');
  console.log('  Easiest options:');
  console.log('    A) App UI: go to Data Connectors → Magento → click "Sync now"');
  console.log('       (triggers a quick incremental sync that also re-aggregates)');
  console.log('    B) Firebase Console → Functions → connectorSync → Test with:');
  console.log(`       { "brandId": "${BRAND_ID}", "platform": "magento" }`);
  console.log('    C) Performance+ app → Settings → "Refresh aggregates" button');

  await summarize(db, BRAND_ID, snap.size, alreadyHasName, written, noMatchInMagento, emptyName);
  process.exit(0);
}

async function summarize(db, brandId, total, alreadyHad, patched, noMatch, empty) {
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Brand:                ${brandId}`);
  console.log(`Total docs:           ${total}`);
  console.log(`Already had name:     ${alreadyHad}`);
  console.log(`Patched this run:     ${patched}`);
  console.log(`No Magento match:     ${noMatch}  (guest orders or deleted customers)`);
  if (DRY_RUN) console.log('*** DRY RUN — no actual writes were made ***');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
