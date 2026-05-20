import * as admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Busboy from 'busboy';
// build: 1451841 — conversions=metrics.conversions only, untilStr=yesterday, no REMOVED filter

const GEMINI_SECRET = defineSecret('GEMINI_API_KEY');
/** SMTP: mailbox που κάνει login (συχνά ίδιο με noreply ή service account Gmail) */
const SMTP_EMAIL_SECRET = defineSecret('SMTP_EMAIL');
/** SMTP: κωδικός ή App Password */
const SMTP_PASSWORD_SECRET = defineSecret('SMTP_PASSWORD');
import { sanitizeOAuthReturnOrigin } from './oauthRedirect';
import { validateImportUrl } from './urlValidator';
import { parseCSV, parseXLSXBuffer, parseXLSXAllSheets, csvToObjects } from './parseFile';
import { validateProduct } from './validateProduct';
import { validateCampaign } from './validateCampaign';
import {
  getGoogleAdsAuthUrl,
  handleGoogleAdsCallback,
  fetchGoogleAdsCampaigns,
  selectGoogleAdsAccount,
  setDb as setGoogleAdsDb,
} from './googleAdsConnector';
import {
  getMetaAuthUrl,
  handleMetaCallback,
  fetchMetaCampaigns,
  selectMetaAccount,
  setDb as setMetaDb,
} from './metaConnector';
import { sendNotificationEmail, setDb as setEmailDb } from './emailNotifier';
import {
  getMerchantAuthUrl,
  handleMerchantCallback,
  fetchPriceBenchmarks,
  selectMerchantAccount,
  setDb as setMerchantDb,
} from './merchantConnector';
import {
  fetchCompetitorAds,
  setDb as setCompetitorDb,
} from './competitorMonitor';
import { computeAggregatesForBrand, computeAggregatesForAllBrands } from './aggregateStats';
import { evaluateAllBrandsServerSide } from './serverAlerts';
import { sendDigestForAllBrands } from './dailyDigest';
import { createTransporter, SENDER } from './smtpConfig';
import {
  getShopifyAuthUrl,
  handleShopifyCallback,
  fetchShopifyData,
  setDb as setShopifyDb,
} from './shopifyConnector';
import {
  saveWooCredentials,
  fetchWooCommerceData,
  setDb as setWooDb,
} from './woocommerceConnector';
import {
  saveOpenCartCredentials,
  fetchOpenCartData,
  setDb as setOpenCartDb,
} from './opencartConnector';
import {
  saveMagentoCredentials,
  fetchMagentoData,
  updateMagentoSyncScope,
  setDb as setMagentoDb,
} from './magentoConnector';
import {
  saveMegaventoryCredentials,
  fetchMegaventoryData,
  updateMegaventoryConnectorSettings,
  setDb as setMegaventoryDb,
} from './megaventoryConnector';
import {
  saveSoftOneCredentials,
  fetchSoftOneData,
  setDb as setSoftOneDb,
} from './softoneConnector';
import {
  saveEpsilonNetCredentials,
  fetchEpsilonNetData,
  setDb as setEpsilonNetDb,
} from './epsilonNetConnector';
import {
  saveEntersoftCredentials,
  fetchEntersoftData,
  setDb as setEntersoftDb,
} from './entersoftConnector';
import {
  computeEcommerceSummary,
  setDb as setEcommerceAggDb,
} from './ecommerceAggregator';
import {
  computeDataAnalysisRfmDiagnostic,
  refreshDataAnalysisRfmAggregate,
  setDb as setDataAnalysisRfmDb,
} from './dataAnalysisRfmAggregator';
import {
  refreshProductIntelligenceAggregate,
  refreshCompetitiveInventoryLookup,
  queryProductIntelligenceRows,
  setDb as setProductIntelligenceDb,
} from './productIntelligenceAggregator';
import {
  captureStockSnapshot,
  computeStockMovement,
  refreshStockMovement,
  setDb as setStockMovementDb,
} from './stockMovementTracker';
import {
  refreshProcurementSignals,
  setDb as setProcurementSignalsDb,
} from './procurementSignals';
import {
  getGA4AuthUrl,
  handleGA4Callback,
  fetchGA4Data,
  setDb as setGA4Db,
} from './ga4Connector';
import {
  getSearchConsoleAuthUrl,
  handleSearchConsoleCallback,
  fetchSearchConsoleData,
  setDb as setSearchConsoleDb,
} from './searchConsole';
import {
  getTikTokAuthUrl,
  handleTikTokCallback,
  fetchTikTokCampaigns,
  selectTikTokAccount,
  setDb as setTikTokDb,
} from './tiktokConnector';
import { persistInterestLead } from './interestLead';
import { applyStrictCors, enforceRateLimit, getClientIp, sendRateLimitExceeded } from './security';
import { encryptToken } from './tokenCrypto';

admin.initializeApp();
const db = getFirestore();
setMetaDb(db);
setGoogleAdsDb(db);
setEmailDb(db);
setMerchantDb(db);
setCompetitorDb(db);
setShopifyDb(db);
setWooDb(db);
setOpenCartDb(db);
setMagentoDb(db);
setMegaventoryDb(db);
setSoftOneDb(db);
setEpsilonNetDb(db);
setEntersoftDb(db);
setEcommerceAggDb(db);
setDataAnalysisRfmDb(db);
setProductIntelligenceDb(db);
setStockMovementDb(db);
setProcurementSignalsDb(db);
setGA4Db(db);
setSearchConsoleDb(db);
setTikTokDb(db);

const BATCH_SIZE = 500;

/**
 * Super-admin allowlist (UIDs + emails) lives in Firestore at appConfig/superAdmins.
 * Doc shape: { uids: string[], emails: string[] }. Seeded once via .tmp/seed-super-admins.mjs.
 * Cached per cold-start to avoid hitting Firestore on every auth check.
 */
let superAdminCache: { uids: Set<string>; emails: Set<string>; fetchedAt: number } | null = null;
const SUPER_ADMIN_CACHE_TTL_MS = 5 * 60_000;

async function loadSuperAdmins(): Promise<{ uids: Set<string>; emails: Set<string> }> {
  const now = Date.now();
  if (superAdminCache && now - superAdminCache.fetchedAt < SUPER_ADMIN_CACHE_TTL_MS) {
    return { uids: superAdminCache.uids, emails: superAdminCache.emails };
  }
  try {
    const cfg = await db.doc('appConfig/superAdmins').get();
    const data = cfg.data() ?? {};
    const uidArr = Array.isArray(data.uids) ? data.uids : [];
    const emailArr = Array.isArray(data.emails) ? data.emails : [];
    const uids = new Set(uidArr.filter((x): x is string => typeof x === 'string'));
    const emails = new Set(
      emailArr.filter((x): x is string => typeof x === 'string').map((e) => e.toLowerCase())
    );
    superAdminCache = { uids, emails, fetchedAt: now };
    return { uids, emails };
  } catch (err) {
    logger.warn('[superAdmins] Firestore read failed; allowlist empty until next retry', err);
    return { uids: new Set(), emails: new Set() };
  }
}

async function isUidSuperAdmin(uid: string): Promise<boolean> {
  const { uids, emails } = await loadSuperAdmins();
  if (uids.has(uid)) return true;
  if (emails.size === 0) return false;
  try {
    const u = await admin.auth().getUser(uid);
    const em = u.email?.toLowerCase();
    if (em && emails.has(em)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

async function verifyBrandMembership(uid: string, brandId: string): Promise<boolean> {
  if (await isUidSuperAdmin(uid)) return true;
  const memberDoc = await db.doc(`brands/${brandId}/members/${uid}`).get();
  if (memberDoc.exists) return true;
  const brandDoc = await db.doc(`brands/${brandId}`).get();
  if (!brandDoc.exists) return false;
  return brandDoc.data()?.createdBy === uid;
}

/** Σύνδεση/αποσύνδεση/sync connectors: ιδιοκτήτης, διαχειριστής, δημιουργός brand, super admin */
async function verifyBrandConnectorManagement(uid: string, brandId: string): Promise<boolean> {
  if (await isUidSuperAdmin(uid)) return true;
  const brandDoc = await db.doc(`brands/${brandId}`).get();
  if (!brandDoc.exists) return false;
  if (brandDoc.data()?.createdBy === uid) return true;
  const memberDoc = await db.doc(`brands/${brandId}/members/${uid}`).get();
  if (!memberDoc.exists) return false;
  const raw = (memberDoc.data()?.role as string | undefined) ?? 'member';
  const role = raw.trim().toLowerCase();
  return role === 'owner' || role === 'admin';
}

type ImportType = 'products' | 'campaigns' | 'segments' | 'procurement';

interface MagentoSearchTermInput {
  term?: unknown;
  hits?: unknown;
  results?: unknown;
}

interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: string[];
  type: ImportType;
  timestamp: string;
}

async function verifyApiKey(apiKey: string): Promise<{ brandId: string } | null> {
  const snap = await db
    .collection('api_keys')
    .where('key', '==', apiKey)
    .where('active', '==', true)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { brandId: doc.data().brandId as string };
}

function parseFile(
  buffer: Buffer,
  filename: string,
  type: ImportType
): Record<string, string>[] {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
    const rows = parseXLSXBuffer(buffer, type);
    return csvToObjects(rows, type);
  }

  if (lower.endsWith('.csv')) {
    const text = buffer.toString('utf-8');
    const rows = parseCSV(text);
    return csvToObjects(rows, type);
  }

  throw new Error(`Unsupported file type: ${filename}. Use .csv, .xlsx, or .xls`);
}

async function batchWrite(
  collectionName: string,
  items: { id: string; data: Record<string, unknown> }[],
  brandId: string
): Promise<void> {
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = items.slice(i, i + BATCH_SIZE);

    for (const item of chunk) {
      const ref = db.collection(collectionName).doc(item.id);
      batch.set(
        ref,
        {
          ...item.data,
          brandId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    logger.info(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: wrote ${chunk.length} docs to ${collectionName}`);
  }
}

// ── Procurement sheet name → Firestore collection suffix mapping ──────────────
const PROCUREMENT_SHEET_MAP: Record<string, string> = {
  'ΔΙΑΧΕΙΡΙΣΗ ΑΠΟΘΕΜΑΤΟΣ': 'inventory',
  'ΚΟΣΤΟΛΟΓΗΣΗ': 'costing',
  'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΩΝ': 'item_evaluation',
  'ΑΞΙΟΛΟΓΗΣΗ ΠΕΛΑΤΩΝ': 'customer_evaluation',
  'ΤΙΜΟΛΟΓΙΑΚΗ ΠΟΛΙΤΙΚΗ': 'pricing_policy',
  'ΑΠΟΛΟΓΙΣΤΙΚΟ ΕΤΟΣ': 'fiscal_year',
  'ΣΤΑΤΙΣΤΙΚΑ': 'statistics',
};

interface ProcurementImportResult {
  success: boolean;
  sheets: Record<string, number>;
  totalImported: number;
  errors: string[];
  timestamp: string;
}

async function importProcurement(
  buffer: Buffer,
  brandId: string
): Promise<ProcurementImportResult> {
  const allSheets = parseXLSXAllSheets(buffer);
  const sheets: Record<string, number> = {};
  const errors: string[] = [];
  let totalImported = 0;

  for (const [sheetName, rows] of allSheets.entries()) {
    const sheetKey = sheetName.trim().toUpperCase();
    // Find matching key (case-insensitive, ignore accents won't be perfect but good enough)
    const collectionSuffix = Object.entries(PROCUREMENT_SHEET_MAP).find(
      ([k]) => sheetKey === k.toUpperCase() || sheetKey.includes(k.toUpperCase()) || k.toUpperCase().includes(sheetKey)
    )?.[1];

    if (!collectionSuffix) {
      logger.warn(`[Procurement] Unknown sheet: "${sheetName}" — skipping`);
      continue;
    }

    const collection = `procurement_${collectionSuffix}`;

    try {
      // Convert rows to objects preserving original Greek column names
      const headerRowIdx = rows.findIndex((r) => r.some((c) => c.length > 1));
      if (headerRowIdx === -1 || rows.length <= headerRowIdx + 1) {
        sheets[collectionSuffix] = 0;
        continue;
      }

      const headers = rows[headerRowIdx];
      const dataRows = rows.slice(headerRowIdx + 1).filter((r) => r.some((c) => c !== ''));

      const items = dataRows.map((row, idx) => {
        const obj: Record<string, unknown> = {
          sheetType: collectionSuffix,
          rowIndex: idx,
          brandId,
          createdAt: new Date().toISOString(),
        };
        headers.forEach((h, i) => {
          if (h) obj[h] = row[i] ?? '';
        });
        const id = String(row[0] || idx).replace(/[/\\]/g, '_').trim() || String(idx);
        return { id, data: obj };
      });

      if (items.length > 0) {
        await batchWrite(collection, items, brandId);
      }

      sheets[collectionSuffix] = items.length;
      totalImported += items.length;
      logger.info(`[Procurement] ${collection}: imported ${items.length} rows`);
    } catch (err) {
      const msg = `Sheet "${sheetName}" failed: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      logger.error(`[Procurement] ${msg}`);
    }
  }

  return {
    success: errors.length === 0,
    sheets,
    totalImported,
    errors: errors.slice(0, 20),
    timestamp: new Date().toISOString(),
  };
}

async function importProducts(
  objects: Record<string, string>[],
  brandId: string
): Promise<ImportResult> {
  const errors: string[] = [];
  const items: { id: string; data: Record<string, unknown> }[] = [];
  const suppliers = new Map<string, string>();

  for (let i = 0; i < objects.length; i++) {
    const result = validateProduct(objects[i], i);
    if (!result.valid || !result.data) {
      if (result.error) errors.push(result.error);
      continue;
    }
    const p = result.data;
    items.push({ id: p.id, data: p as unknown as Record<string, unknown> });

    if (p.supplier) {
      suppliers.set(p.supplier, p.supplier);
    }
  }

  if (items.length > 0) {
    await batchWrite('products', items, brandId);
    // Stock snapshot μετά από product import — ξεκινά/ανανεώνει το tracking
    // για brands χωρίς connector (e-tennis, και άλλα όπου το stock έρχεται από imports).
    try {
      await refreshStockMovement(brandId);
    } catch (e) {
      logger.warn(`[importProducts] stock movement refresh failed for ${brandId}:`, e);
    }
  }

  if (suppliers.size > 0) {
    const supplierItems = Array.from(suppliers.values()).map((name) => ({
      id: name.replace(/[/\\]/g, '_').trim(),
      data: { name, tod: 60, lead_time: 0 } as Record<string, unknown>,
    }));
    await batchWrite('suppliers', supplierItems, brandId);
    logger.info(`Auto-created ${supplierItems.length} suppliers`);
  }

  return {
    success: true,
    imported: items.length,
    failed: errors.length,
    errors: errors.slice(0, 50),
    type: 'products',
    timestamp: new Date().toISOString(),
  };
}

async function importCampaigns(
  objects: Record<string, string>[],
  brandId: string,
  channelOverride?: string
): Promise<ImportResult> {
  const errors: string[] = [];
  const items: { id: string; data: Record<string, unknown> }[] = [];

  for (let i = 0; i < objects.length; i++) {
    const result = validateCampaign(objects[i], i, channelOverride);
    if (!result.valid || !result.data) {
      if (result.error) errors.push(result.error);
      continue;
    }
    const c = result.data;
    items.push({ id: c.id, data: c as unknown as Record<string, unknown> });
  }

  if (items.length > 0) {
    await batchWrite('campaigns', items, brandId);
  }

  return {
    success: true,
    imported: items.length,
    failed: errors.length,
    errors: errors.slice(0, 50),
    type: 'campaigns',
    timestamp: new Date().toISOString(),
  };
}

async function logImportJob(
  brandId: string,
  result: ImportResult,
  filename: string,
  source: string
): Promise<void> {
  await db.collection('import_jobs').add({
    brandId,
    type: result.type,
    fileName: filename,
    source,
    status: result.success ? 'completed' : 'failed',
    imported: result.imported,
    failed: result.failed,
    errors: result.errors,
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * HTTP Import Endpoint
 *
 * POST /importData
 * Headers: Authorization: Bearer {API_KEY}
 * Body: multipart/form-data
 *   - file: CSV/XLSX file
 *   - type: "products" | "campaigns" | "segments"
 *   - channel: (optional) force campaign channel e.g. "Google Ads", "Meta"
 *
 * OR Body: application/json
 *   - fileUrl: URL to download the file
 *   - type: "products" | "campaigns"
 *   - channel: (optional)
 */
export const importData = onRequest(
  {
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 5,
    cors: true,
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization header. Use: Bearer {API_KEY}' });
      return;
    }

    const apiKey = authHeader.slice(7).trim();
    const auth = await verifyApiKey(apiKey);
    if (!auth) {
      res.status(403).json({ error: 'Invalid or inactive API key' });
      return;
    }

    const { brandId } = auth;
    logger.info(`Import request for brand: ${brandId}`);

    try {
      if (
        req.headers['content-type'] &&
        req.headers['content-type'].includes('application/json')
      ) {
        const { fileUrl, type, channel } = req.body as {
          fileUrl?: string;
          type?: string;
          channel?: string;
        };

        if (!fileUrl || !type) {
          res.status(400).json({ error: 'Missing fileUrl or type in JSON body' });
          return;
        }

        const urlCheck = validateImportUrl(fileUrl);
        if (!urlCheck.ok) {
          res.status(400).json({ error: `Invalid fileUrl: ${urlCheck.reason}` });
          return;
        }

        const response = await fetch(fileUrl);
        if (!response.ok) {
          res.status(400).json({ error: `Failed to download file from URL: ${response.status}` });
          return;
        }

        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        const urlFilename = fileUrl.split('/').pop() || 'import.csv';

        if (type === 'procurement') {
          const procResult = await importProcurement(buffer, brandId);
          res.status(200).json(procResult);
          return;
        }

        const objects = parseFile(buffer, urlFilename, type as ImportType);

        let result: ImportResult;
        if (type === 'campaigns') {
          result = await importCampaigns(objects, brandId, channel);
        } else {
          result = await importProducts(objects, brandId);
        }

        await logImportJob(brandId, result, urlFilename, 'api_url');
        computeAggregatesForBrand(brandId).catch(e => logger.warn('[import] aggregate refresh failed:', e));
        res.status(200).json(result);
        return;
      }

      // Multipart form data
      const bb = Busboy({ headers: req.headers });
      let fileBuffer: Buffer | null = null;
      let fileName = 'import.csv';
      let importType: ImportType = 'products';
      let channelOverride: string | undefined;

      const fields: Record<string, string> = {};

      bb.on('field', (name: string, val: string) => {
        fields[name] = val;
      });

      bb.on('file', (_fieldname: string, file: NodeJS.ReadableStream, info: { filename: string }) => {
        fileName = info.filename || 'import.csv';
        const chunks: Buffer[] = [];
        file.on('data', (chunk: Buffer) => chunks.push(chunk));
        file.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      await new Promise<void>((resolve, reject) => {
        bb.on('finish', resolve);
        bb.on('error', reject);
        bb.end(req.rawBody);
      });

      importType = (fields.type as ImportType) || 'products';
      channelOverride = fields.channel;

      if (!fileBuffer) {
        res.status(400).json({ error: 'No file uploaded' });
        return;
      }

      logger.info(`Processing ${fileName} as ${importType} for brand ${brandId}`);

      if (importType === 'procurement') {
        const procResult = await importProcurement(fileBuffer, brandId);
        res.status(200).json(procResult);
        return;
      }

      const objects = parseFile(fileBuffer, fileName, importType);
      logger.info(`Parsed ${objects.length} rows from ${fileName}`);

      let result: ImportResult;
      if (importType === 'campaigns') {
        result = await importCampaigns(objects, brandId, channelOverride);
      } else {
        result = await importProducts(objects, brandId);
      }

      await logImportJob(brandId, result, fileName, 'api_upload');
      computeAggregatesForBrand(brandId).catch(e => logger.warn('[import] aggregate refresh failed:', e));

      res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Import failed:', message);
      res.status(500).json({ error: `Import failed: ${message}` });
    }
  }
);

/**
 * Generate API Key endpoint
 * POST /generateApiKey
 * Headers: Authorization: Bearer {FIREBASE_ID_TOKEN}
 * Body: { brandId: string }
 */
export const generateApiKey = onRequest(
  { region: 'europe-west1', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST' });
      return;
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Firebase ID token' });
      return;
    }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      const { brandId } = req.body as { brandId?: string };
      if (!brandId) {
        res.status(400).json({ error: 'Missing brandId' });
        return;
      }

      if (!(await verifyBrandMembership(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Not a member of this brand' });
        return;
      }

      const { v4: uuidv4 } = await import('uuid');
      const key = `pp_${uuidv4().replace(/-/g, '')}`;

      await db.collection('api_keys').add({
        key,
        brandId,
        active: true,
        createdBy: decoded.uid,
        createdAt: FieldValue.serverTimestamp(),
      });

      logger.info(`API key created for brand ${brandId} by ${decoded.uid}`);
      res.status(200).json({ apiKey: key, brandId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Generate API key failed:', message);
      res.status(500).json({ error: message });
    }
  }
);

// ─── Connector: Get OAuth URLs ─────────────────────────────────

/**
 * POST /connectorAuth
 * Body: { brandId, provider: "google_ads" | "meta" | "tiktok", redirectUri }
 * Returns: { authUrl }
 */
export const connectorAuth = onRequest(
  { region: 'europe-west1', cors: true, secrets: ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'TIKTOK_APP_ID', 'TIKTOK_APP_SECRET'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      const { brandId, provider, redirectUri, shopDomain, returnOrigin } = req.body as {
        brandId?: string;
        provider?: string;
        redirectUri?: string;
        shopDomain?: string;
        /** Browser origin where OAuth started — post-login redirect must match for Firebase Auth session */
        returnOrigin?: string;
      };

      if (!brandId || !provider || !redirectUri) {
        res.status(400).json({ error: 'Missing brandId, provider, or redirectUri' });
        return;
      }

      if (!(await verifyBrandConnectorManagement(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να διαχειριστεί connectors' });
        return;
      }

      // Drop stale account-picker lists from a prior OAuth attempt so the UI never shows another session's options.
      if (provider === 'ga4' || provider === 'search_console' || provider === 'google_ads' || provider === 'merchant' || provider === 'meta' || provider === 'tiktok') {
        const docRef = db.doc(`connectors/${brandId}`);
        if (provider === 'ga4') {
          await docRef.set(
            {
              ga4: {
                pendingAccountSelection: false,
                availableAccounts: FieldValue.delete(),
                oauthInitiatedByUid: FieldValue.delete(),
              },
            },
            { merge: true }
          );
        } else if (provider === 'search_console') {
          await docRef.set(
            {
              search_console: {
                pendingAccountSelection: false,
                availableAccounts: FieldValue.delete(),
                oauthInitiatedByUid: FieldValue.delete(),
              },
            },
            { merge: true }
          );
        } else if (provider === 'google_ads') {
          await docRef.set(
            {
              google_ads: {
                pendingAccountSelection: false,
                availableAccounts: FieldValue.delete(),
                oauthInitiatedByUid: FieldValue.delete(),
              },
            },
            { merge: true }
          );
        } else if (provider === 'merchant') {
          await docRef.set(
            {
              merchant: {
                pendingAccountSelection: false,
                availableAccounts: FieldValue.delete(),
                oauthInitiatedByUid: FieldValue.delete(),
              },
            },
            { merge: true }
          );
        } else if (provider === 'meta') {
          await docRef.set(
            {
              meta: {
                pendingAccountSelection: false,
                availableAccounts: FieldValue.delete(),
                oauthInitiatedByUid: FieldValue.delete(),
              },
            },
            { merge: true }
          );
        } else {
          await docRef.set(
            {
              tiktok: {
                pendingAccountSelection: false,
                availableAccounts: FieldValue.delete(),
                oauthInitiatedByUid: FieldValue.delete(),
              },
            },
            { merge: true }
          );
        }
      }

      const oauthInitiator = decoded.uid;
      let authUrl: string;
      if (provider === 'google_ads') {
        authUrl = getGoogleAdsAuthUrl(brandId, redirectUri, returnOrigin, oauthInitiator);
      } else if (provider === 'meta') {
        authUrl = getMetaAuthUrl(brandId, redirectUri, returnOrigin, oauthInitiator);
      } else if (provider === 'tiktok') {
        authUrl = getTikTokAuthUrl(brandId, redirectUri, returnOrigin, oauthInitiator);
      } else if (provider === 'merchant') {
        authUrl = getMerchantAuthUrl(brandId, redirectUri, returnOrigin, oauthInitiator);
      } else if (provider === 'ga4') {
        authUrl = getGA4AuthUrl(brandId, redirectUri, returnOrigin, oauthInitiator);
      } else if (provider === 'search_console') {
        authUrl = getSearchConsoleAuthUrl(brandId, redirectUri, returnOrigin, oauthInitiator);
      } else if (provider === 'shopify') {
        if (!shopDomain) {
          res.status(400).json({ error: 'Missing shopDomain for Shopify' });
          return;
        }
        authUrl = getShopifyAuthUrl(brandId, shopDomain, redirectUri, returnOrigin);
      } else {
        res.status(400).json({ error: `Unknown provider: ${provider}` });
        return;
      }

      res.status(200).json({ authUrl });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  }
);

// ─── Connector: OAuth Callback ─────────────────────────────────

/**
 * GET /connectorCallback?code=xxx&state=base64({brandId, provider})
 * Handles OAuth redirect from Google/Meta
 */
export const connectorCallback = onRequest(
  { region: 'europe-west1', cors: true, secrets: ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'TIKTOK_APP_ID', 'TIKTOK_APP_SECRET', 'CONNECTOR_TOKEN_KEY'] },
  async (req, res) => {
    const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string };

    // Google OAuth may redirect with ?error=access_denied instead of ?code=xxx
    if (oauthError && state) {
      try {
        const parsed = JSON.parse(Buffer.from(state, 'base64url').toString()) as {
          provider?: string;
          returnOrigin?: string;
        };
        const provider = parsed.provider || 'unknown';
        const origin = sanitizeOAuthReturnOrigin(parsed.returnOrigin);
        logger.warn(`[ConnectorCallback] OAuth denied: ${oauthError} for ${provider}`);
        res.redirect(
          `${origin}/?pp_oauth=1&connector=${encodeURIComponent(provider)}&status=error&message=${encodeURIComponent(oauthError === 'access_denied' ? 'Η πρόσβαση απορρίφθηκε' : oauthError)}`
        );
      } catch {
        res.status(400).send(`OAuth error: ${oauthError}`);
      }
      return;
    }

    if (!code || !state) {
      res.status(400).send('Missing code or state parameter');
      return;
    }

    try {
      const parsed = JSON.parse(Buffer.from(state, 'base64url').toString()) as {
        brandId: string;
        provider: string;
        redirectUri: string;
        returnOrigin?: string;
        shopDomain?: string;
        /** Firebase uid of admin who started OAuth (embedded in state from connectorAuth) */
        oauthInitiatedByUid?: string;
      };
      const { brandId, provider, redirectUri } = parsed;
      const oauthInitiatedByUid = parsed.oauthInitiatedByUid?.trim();
      const appOrigin = sanitizeOAuthReturnOrigin(parsed.returnOrigin);
      logger.info(`[ConnectorCallback] provider=${provider} brandId=${brandId}`);

      if (!redirectUri) {
        res.status(400).send('Missing redirectUri in state');
        return;
      }

      let result: { success: boolean; error?: string };

      if (provider === 'google_ads') {
        result = await handleGoogleAdsCallback(code, brandId, redirectUri, oauthInitiatedByUid);
      } else if (provider === 'meta') {
        const metaResult = await handleMetaCallback(code, redirectUri);
        if (metaResult.success && metaResult.data) {
          const { accessToken, expiresIn, availableAccounts, needsSelection } = metaResult.data;
          await db.doc(`connectors/${brandId}`).set(
            {
              meta: {
                connected: !needsSelection,
                pendingAccountSelection: needsSelection,
                accessToken: encryptToken(accessToken),
                expiresAt: Date.now() + expiresIn * 1000,
                availableAccounts,
                adAccountIds: needsSelection ? [] : availableAccounts.map((a) => a.id),
                adAccountNames: needsSelection ? [] : availableAccounts.map((a) => a.name),
                connectedAt: FieldValue.serverTimestamp(),
                oauthInitiatedByUid:
                  needsSelection && oauthInitiatedByUid ? oauthInitiatedByUid : FieldValue.delete(),
              },
            },
            { merge: true }
          );
          logger.info(`[Meta] Saved to Firestore for brand ${brandId}`);
          result = { success: true };
        } else {
          result = { success: false, error: metaResult.error };
        }
      } else if (provider === 'tiktok') {
        const tiktokResult = await handleTikTokCallback(code, redirectUri);
        if (tiktokResult.success && tiktokResult.data) {
          const {
            accessToken,
            refreshToken,
            expiresIn,
            refreshExpiresIn,
            availableAccounts,
            needsSelection,
          } = tiktokResult.data;
          await db.doc(`connectors/${brandId}`).set(
            {
              tiktok: {
                connected: !needsSelection,
                pendingAccountSelection: needsSelection,
                accessToken: encryptToken(accessToken),
                refreshToken: encryptToken(refreshToken),
                expiresAt: Date.now() + expiresIn * 1000,
                refreshExpiresAt: Date.now() + refreshExpiresIn * 1000,
                availableAccounts,
                adAccountIds: needsSelection ? [] : availableAccounts.map((a) => a.id),
                adAccountNames: needsSelection ? [] : availableAccounts.map((a) => a.name),
                connectedAt: FieldValue.serverTimestamp(),
                oauthInitiatedByUid:
                  needsSelection && oauthInitiatedByUid ? oauthInitiatedByUid : FieldValue.delete(),
              },
            },
            { merge: true }
          );
          logger.info(`[TikTok] Saved to Firestore for brand ${brandId}`);
          result = { success: true };
        } else {
          result = { success: false, error: tiktokResult.error };
        }
      } else if (provider === 'merchant') {
        result = await handleMerchantCallback(code, brandId, redirectUri, oauthInitiatedByUid);
      } else if (provider === 'ga4') {
        result = await handleGA4Callback(code, brandId, redirectUri, oauthInitiatedByUid);
      } else if (provider === 'search_console') {
        result = await handleSearchConsoleCallback(code, brandId, redirectUri, oauthInitiatedByUid);
      } else if (provider === 'shopify') {
        const shopDomain = parsed.shopDomain;
        if (!shopDomain) {
          res.status(400).send('Missing shopDomain in state');
          return;
        }
        result = await handleShopifyCallback(code, brandId, shopDomain);
      } else {
        res.status(400).send(`Unknown provider: ${provider}`);
        return;
      }

      if (result.success) {
        res.redirect(`${appOrigin}/?pp_oauth=1&connector=${encodeURIComponent(provider)}&status=success`);
      } else {
        res.redirect(
          `${appOrigin}/?pp_oauth=1&connector=${encodeURIComponent(provider)}&status=error&message=${encodeURIComponent(result.error || 'Unknown error')}`
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[ConnectorCallback] Error:', msg);
      res.status(500).send(`Callback error: ${msg}`);
    }
  }
);

// ─── Connector: Disconnect ─────────────────────────────────────

/**
 * POST /connectorDisconnect
 * Body: { brandId, provider }
 */
export const connectorDisconnect = onRequest(
  { region: 'europe-west1', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      const { brandId, provider } = req.body as { brandId?: string; provider?: string };
      if (!brandId || !provider) { res.status(400).json({ error: 'Missing params' }); return; }

      if (!(await verifyBrandConnectorManagement(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να διαχειριστεί connectors' });
        return;
      }

      const clearPayload: Record<string, unknown> = {
        connected: false,
        accessToken: '',
        refreshToken: '',
        pendingAccountSelection: false,
        availableAccounts: FieldValue.delete(),
        oauthInitiatedByUid: FieldValue.delete(),
      };
      if (provider === 'woocommerce') {
        clearPayload.consumerKey = '';
        clearPayload.consumerSecret = '';
      }
      if (provider === 'opencart') {
        clearPayload.apiKey = '';
        clearPayload.apiUsername = '';
        clearPayload.apiToken = '';
      }
      if (provider === 'magento') {
        // Full wipe: αλλιώς μένουν stale shopName/storeUrl/storeWebUrl και μπορεί να εμφανιστεί
        // λάθος store (π.χ. "e-tennis" αντί για "safeblock") στο connector card μετά από disconnect.
        clearPayload.accessToken = '';
        clearPayload.storeUrl = '';
        clearPayload.shopName = '';
        clearPayload.storeCode = '';
        clearPayload.storeName = '';
        clearPayload.storeId = null;
        clearPayload.restApiBase = '';
        clearPayload.storeWebUrl = '';
        clearPayload.mediaBaseUrl = '';
        clearPayload.magentoVersion = '';
      }
      if (provider === 'megaventory') {
        clearPayload.apiKey = '';
        clearPayload.accountName = '';
        clearPayload.currency = '';
        clearPayload.customReportId = '';
        clearPayload.customReportEnabled = false;
      }
      if (provider === 'softone') {
        clearPayload.serviceUrl = '';
        clearPayload.username = '';
        clearPayload.password = '';
        clearPayload.appId = '';
        clearPayload.company = '';
        clearPayload.branch = '';
        clearPayload.module = '';
        clearPayload.refId = '';
        clearPayload.syncSalesDocs = false;
        clearPayload.syncPurchaseDocs = false;
      }
      if (provider === 'epsilon_net') {
        clearPayload.subscriptionKey = '';
        clearPayload.email = '';
        clearPayload.password = '';
        clearPayload.lastItemsMaxRevision = 0;
      }
      if (provider === 'entersoft') {
        clearPayload.webApiBaseUrl = '';
        clearPayload.userId = '';
        clearPayload.password = '';
        clearPayload.branchId = '';
        clearPayload.langId = '';
        clearPayload.subscriptionId = '';
        clearPayload.subscriptionPassword = '';
        clearPayload.bridgeId = '';
        clearPayload.extraPin = '';
        clearPayload.publicQueryGroupId = '';
        clearPayload.publicQueryFilterId = '';
        clearPayload.publicQueryMethod = 'GET';
      }
      if (provider === 'shopify') {
        clearPayload.accessToken = '';
      }
      if (provider === 'search_console') {
        clearPayload.siteUrl = '';
        clearPayload.siteName = '';
      }

      await db.doc(`connectors/${brandId}`).set(
        { [provider]: clearPayload },
        { merge: true }
      );

      res.status(200).json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  }
);

// ─── Connector: Select Ad Account ──────────────────────────────

/**
 * POST /connectorSelectAccount
 * Body: { brandId, provider, accountId, accountName }
 */
export const connectorSelectAccount = onRequest(
  { region: 'europe-west1', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      const { brandId, provider, accountId, accountName } = req.body as {
        brandId?: string; provider?: string; accountId?: string; accountName?: string;
      };

      if (!brandId || !provider || !accountId) {
        res.status(400).json({ error: 'Missing brandId, provider, or accountId' });
        return;
      }

      if (!(await verifyBrandConnectorManagement(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να διαχειριστεί connectors' });
        return;
      }

      const snap = await db.doc(`connectors/${brandId}`).get();
      const conn = snap.data() as Record<string, Record<string, unknown>> | undefined;
      const sub = conn?.[provider];
      if (sub?.pendingAccountSelection) {
        const owner = sub.oauthInitiatedByUid as string | undefined;
        if (!owner || owner !== decoded.uid) {
          res.status(403).json({
            error:
              'Η επιλογή λογαριασμού δεν ταιριάζει με τον τρέχοντα χρήστη. Αποσυνδέστε ή ξανασυνδέστε το connector από Συνδέσεις.',
          });
          return;
        }
      }

      let result: { success: boolean; error?: string };
      if (provider === 'meta') {
        result = await selectMetaAccount(brandId, accountId, accountName || accountId);
      } else if (provider === 'tiktok') {
        result = await selectTikTokAccount(brandId, accountId, accountName || accountId);
      } else if (provider === 'google_ads') {
        await selectGoogleAdsAccount(brandId, accountId, accountName || accountId);
        result = { success: true };
      } else if (provider === 'merchant') {
        await selectMerchantAccount(brandId, accountId, accountName || accountId);
        result = { success: true };
      } else if (provider === 'ga4') {
        await db.doc(`connectors/${brandId}`).set(
          {
            ga4: {
              connected: true,
              pendingAccountSelection: false,
              propertyId: accountId,
              propertyName: accountName || `Property ${accountId}`,
              oauthInitiatedByUid: FieldValue.delete(),
            },
          },
          { merge: true }
        );
        result = { success: true };
      } else if (provider === 'search_console') {
        await db.doc(`connectors/${brandId}`).set(
          {
            search_console: {
              connected: true,
              pendingAccountSelection: false,
              siteUrl: accountId,
              siteName: accountName || accountId,
              oauthInitiatedByUid: FieldValue.delete(),
            },
          },
          { merge: true }
        );
        result = { success: true };
      } else {
        res.status(400).json({ error: `Account selection not supported for ${provider}` });
        return;
      }

      res.status(200).json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  }
);

// ─── Connector: Manual Sync ────────────────────────────────────

/**
 * POST /connectorSync
 * Body: { brandId, provider }
 */
export const connectorSync = onRequest(
  { region: 'europe-west1', cors: true, timeoutSeconds: 1200, memory: '2GiB', secrets: ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'TIKTOK_APP_ID', 'TIKTOK_APP_SECRET', 'CONNECTOR_TOKEN_KEY'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    let brandId = '';
    let provider = '';
    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      const body = req.body as { brandId?: string; provider?: string; forceFullSync?: boolean };
      brandId = body.brandId || '';
      provider = body.provider || '';
      const forceFullSync = body.forceFullSync === true;
      if (!brandId || !provider) { res.status(400).json({ error: 'Missing params' }); return; }

      if (!(await verifyBrandConnectorManagement(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να διαχειριστεί connectors' });
        return;
      }

      let result: any;
      if (provider === 'google_ads') {
        result = await fetchGoogleAdsCampaigns(brandId);
      } else if (provider === 'meta') {
        result = await fetchMetaCampaigns(brandId);
      } else if (provider === 'tiktok') {
        result = await fetchTikTokCampaigns(brandId);
      } else if (provider === 'merchant') {
        result = await fetchPriceBenchmarks(brandId);
      } else if (provider === 'competitor') {
        result = await fetchCompetitorAds(brandId);
      } else if (provider === 'shopify') {
        result = await fetchShopifyData(brandId);
      } else if (provider === 'woocommerce') {
        result = await fetchWooCommerceData(brandId);
      } else if (provider === 'opencart') {
        result = await fetchOpenCartData(brandId);
      } else if (provider === 'magento') {
        if (forceFullSync) {
          const db = admin.firestore();
          await db.doc(`connectors/${brandId}`).update({
            'magento.lastOrdersSyncAt': FieldValue.delete(),
            'magento.ordersHistoryCursor': FieldValue.delete(),
          });
          logger.info(`[connectorSync] Force full re-sync: cleared order sync state for ${brandId}`);
        }
        result = await fetchMagentoData(brandId);
      } else if (provider === 'megaventory') {
        const jobId = `megaventory_${brandId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
        await admin.firestore().collection('connector_sync_jobs').doc(jobId).set({
          brandId,
          provider,
          status: 'pending',
          requestedBy: decoded.uid,
          requestedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          mode: 'manual_full_refresh',
        }, { merge: true });
        result = {
          success: true,
          queued: true,
          jobId,
          imported: 0,
          message: 'Megaventory sync ξεκίνησε στο background με ανανέωση παραστατικών.',
        };
      } else if (provider === 'softone') {
        result = await fetchSoftOneData(brandId);
      } else if (provider === 'epsilon_net') {
        result = await fetchEpsilonNetData(brandId);
      } else if (provider === 'entersoft') {
        result = await fetchEntersoftData(brandId);
      } else if (provider === 'ga4') {
        result = await fetchGA4Data(brandId);
      } else if (provider === 'search_console') {
        result = await fetchSearchConsoleData(brandId);
      } else {
        res.status(400).json({ error: `Unknown provider: ${provider}` });
        return;
      }

      // ecommerce_summary (μόνο e-shop) + business_revenue_summary (ERP) μετά από sync connectors.
      if (
        ['shopify', 'woocommerce', 'opencart', 'magento', 'megaventory', 'softone'].includes(provider) &&
        result.queued !== true
      ) {
        try {
          await computeEcommerceSummary(brandId);
        } catch (e) {
          logger.warn(`[connectorSync] ecommerce summary refresh failed for ${brandId}:`, e);
        }
      }

      if (['shopify', 'woocommerce', 'opencart', 'magento'].includes(provider)) {
        // Stock movement tracking (universal — δουλεύει και για non-connector brands)
        try {
          await refreshStockMovement(brandId);
        } catch (e) {
          logger.warn(`[connectorSync] stock movement refresh failed for ${brandId}:`, e);
        }
      }

      res.status(200).json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[connectorSync] failed for brand=${brandId || 'unknown'} provider=${provider || 'unknown'}: ${msg}`);
      res.status(500).json({ error: msg });
    }
  }
);

export const processMegaventorySyncJobs = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'europe-west1',
    timeoutSeconds: 1800,
    memory: '2GiB',
    secrets: ['CONNECTOR_TOKEN_KEY'],
  },
  async () => {
    const db = admin.firestore();
    const snap = await db
      .collection('connector_sync_jobs')
      .where('provider', '==', 'megaventory')
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (snap.empty) return;

    const jobRef = snap.docs[0].ref;
    const job = await db.runTransaction(async (tx) => {
      const latest = await tx.get(jobRef);
      const data = latest.data() as { brandId?: string; status?: string } | undefined;
      if (!latest.exists || data?.status !== 'pending' || !data.brandId) return null;
      tx.update(jobRef, {
        status: 'running',
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { brandId: data.brandId };
    });

    if (!job) return;

    try {
      logger.info(`[MegaventoryJob] Starting Megaventory refresh for ${job.brandId}`);
      const result = await fetchMegaventoryData(job.brandId, { mode: 'manual' });
      try {
        await computeEcommerceSummary(job.brandId);
      } catch (e) {
        logger.warn(`[MegaventoryJob] ecommerce summary refresh failed for ${job.brandId}:`, e);
      }
      await jobRef.update({
        status: result.success ? 'completed' : 'failed',
        result,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(result.error ? { error: result.error } : { error: FieldValue.delete() }),
      });
      logger.info(`[MegaventoryJob] Completed catalog refresh for ${job.brandId}: ${JSON.stringify(result)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[MegaventoryJob] failed for ${job.brandId}: ${msg}`);
      await jobRef.update({
        status: 'failed',
        error: msg,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);

// ─── Connector: Save Credentials (WooCommerce) ────────────────

/**
 * POST /connectorSaveCredentials
 * Body: { brandId, provider: "woocommerce", storeUrl, consumerKey, consumerSecret }
 */
export const connectorSaveCredentials = onRequest(
  { region: 'europe-west1', cors: true, secrets: ['CONNECTOR_TOKEN_KEY'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      const { brandId, provider, storeUrl, consumerKey, consumerSecret } = req.body as {
        brandId?: string; provider?: string; storeUrl?: string; consumerKey?: string; consumerSecret?: string;
      };

      if (!brandId || !provider) {
        res.status(400).json({ error: 'Missing brandId or provider' });
        return;
      }

      if (!(await verifyBrandConnectorManagement(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να διαχειριστεί connectors' });
        return;
      }

      if (provider === 'woocommerce') {
        if (!storeUrl || !consumerKey || !consumerSecret) {
          res.status(400).json({ error: 'Missing storeUrl, consumerKey, or consumerSecret' });
          return;
        }
        const result = await saveWooCredentials(brandId, storeUrl, consumerKey, consumerSecret);
        res.status(200).json(result);
      } else if (provider === 'opencart') {
        const { apiUsername, apiKey: ocApiKey } = req.body as { apiUsername?: string; apiKey?: string };
        if (!storeUrl || !apiUsername || !ocApiKey) {
          res.status(400).json({ error: 'Missing storeUrl, apiUsername, or apiKey' });
          return;
        }
        const result = await saveOpenCartCredentials(brandId, storeUrl, apiUsername, ocApiKey);
        res.status(200).json(result);
      } else if (provider === 'magento') {
        const {
          accessToken: magToken,
          storeCode,
          syncAllStores,
          magentoSettingsOnly,
        } = req.body as {
          accessToken?: string;
          storeCode?: string;
          syncAllStores?: boolean;
          magentoSettingsOnly?: boolean;
        };
        if (magentoSettingsOnly) {
          if (syncAllStores === undefined) {
            res.status(400).json({ error: 'Για ρυθμίσεις Magento λείπει το syncAllStores' });
            return;
          }
          const scope = await updateMagentoSyncScope(brandId, Boolean(syncAllStores));
          if (!scope.ok) {
            res.status(400).json({ success: false, error: scope.error });
            return;
          }
          try {
            await computeEcommerceSummary(brandId);
          } catch (aggErr) {
            const msg = aggErr instanceof Error ? aggErr.message : String(aggErr);
            logger.warn(`[connectorSaveCredentials] computeEcommerceSummary after Magento settings: ${msg}`);
          }
          res.status(200).json({ success: true });
          return;
        }
        if (!storeUrl || !magToken) {
          res.status(400).json({ error: 'Missing storeUrl or accessToken' });
          return;
        }
        const result = await saveMagentoCredentials(brandId, storeUrl, magToken, storeCode, {
          syncAllStores: Boolean(syncAllStores),
        });
        res.status(200).json(result);
      } else if (provider === 'megaventory') {
        const { apiKey: mvKey, megaventorySettingsOnly, customReportId, customReportEnabled } = req.body as {
          apiKey?: string;
          megaventorySettingsOnly?: boolean;
          customReportId?: string;
          customReportEnabled?: boolean;
        };
        if (megaventorySettingsOnly) {
          const updated = await updateMegaventoryConnectorSettings(brandId, {
            customReportId: customReportId !== undefined ? customReportId : undefined,
            customReportEnabled: customReportEnabled !== undefined ? customReportEnabled : undefined,
          });
          if (!updated.ok) {
            res.status(400).json({ success: false, error: updated.error || 'Αποτυχία ενημέρωσης' });
            return;
          }
          res.status(200).json({ success: true });
          return;
        }
        if (!mvKey) {
          res.status(400).json({ error: 'Missing Megaventory apiKey' });
          return;
        }
        const result = await saveMegaventoryCredentials(brandId, mvKey, {
          ...(customReportId !== undefined ? { customReportId } : {}),
          ...(customReportEnabled !== undefined ? { customReportEnabled } : {}),
        });
        res.status(200).json(result);
      } else if (provider === 'softone') {
        const {
          serviceUrl,
          username,
          password,
          appId,
          company,
          branch,
          module,
          refId,
          syncSalesDocs,
          syncPurchaseDocs,
        } = req.body as {
          serviceUrl?: string;
          username?: string;
          password?: string;
          appId?: string;
          company?: string;
          branch?: string;
          module?: string;
          refId?: string;
          syncSalesDocs?: boolean;
          syncPurchaseDocs?: boolean;
        };
        if (!serviceUrl || !username || !password || !appId) {
          res.status(400).json({ error: 'Missing SoftOne serviceUrl, username, password, or appId' });
          return;
        }
        const result = await saveSoftOneCredentials(brandId, {
          serviceUrl,
          username,
          password,
          appId,
          company,
          branch,
          module,
          refId,
          syncSalesDocs,
          syncPurchaseDocs,
        });
        res.status(200).json(result);
      } else if (provider === 'epsilon_net') {
        const { subscriptionKey, email, password } = req.body as {
          subscriptionKey?: string;
          email?: string;
          password?: string;
        };
        if (!subscriptionKey || !email || !password) {
          res.status(400).json({ error: 'Missing Epsilon Net subscriptionKey, email, or password' });
          return;
        }
        const result = await saveEpsilonNetCredentials(brandId, { subscriptionKey, email, password });
        res.status(200).json(result);
      } else if (provider === 'entersoft') {
        const b = req.body as {
          webApiBaseUrl?: string;
          userId?: string;
          password?: string;
          branchId?: string;
          langId?: string;
          subscriptionId?: string;
          subscriptionPassword?: string;
          bridgeId?: string;
          extraPin?: string;
          publicQueryGroupId?: string;
          publicQueryFilterId?: string;
          publicQueryMethod?: 'GET' | 'POST';
        };
        if (!b.webApiBaseUrl || !b.userId || !b.password) {
          res.status(400).json({ error: 'Missing Entersoft webApiBaseUrl, userId, or password' });
          return;
        }
        const result = await saveEntersoftCredentials(brandId, {
          webApiBaseUrl: b.webApiBaseUrl,
          userId: b.userId,
          password: b.password,
          branchId: b.branchId,
          langId: b.langId,
          subscriptionId: b.subscriptionId,
          subscriptionPassword: b.subscriptionPassword,
          bridgeId: b.bridgeId,
          extraPin: b.extraPin,
          publicQueryGroupId: b.publicQueryGroupId,
          publicQueryFilterId: b.publicQueryFilterId,
          publicQueryMethod: b.publicQueryMethod,
        });
        res.status(200).json(result);
      } else {
        res.status(400).json({ error: `Credentials auth not supported for ${provider}` });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  }
);

// ─── Magento: Import Admin Search Terms ─────────────────────────

/**
 * POST /importMagentoSearchTerms
 * Body: { brandId, terms: [{ term, hits, results? }], uploadedFileName? }
 */
export const importMagentoSearchTerms = onRequest(
  { region: 'europe-west1', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);
      const { brandId, terms, uploadedFileName } = req.body as {
        brandId?: string;
        terms?: MagentoSearchTermInput[];
        uploadedFileName?: string;
      };

      if (!brandId || !Array.isArray(terms)) {
        res.status(400).json({ error: 'Missing brandId or terms' });
        return;
      }

      if (!(await verifyBrandConnectorManagement(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να εισάγει Magento search terms' });
        return;
      }

      const cleaned = terms
        .map((t) => {
          const term = String(t?.term ?? '').replace(/\s+/g, ' ').trim().slice(0, 250);
          const hits = Math.max(0, Number(t?.hits ?? 0) || 0);
          const results = Number(t?.results);
          return {
            term,
            hits,
            ...(Number.isFinite(results) && results >= 0 ? { results } : {}),
          };
        })
        .filter((t) => t.term.length > 0)
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 200);

      if (cleaned.length === 0) {
        res.status(400).json({ error: 'Δεν βρέθηκαν έγκυρα search terms στο αρχείο' });
        return;
      }

      await db.doc(`magento_popular_searches/${brandId}`).set(
        {
          brandId,
          terms: cleaned,
          syncedAt: FieldValue.serverTimestamp(),
          source: 'magento_admin_csv',
          termsProvenance: 'magento_admin_csv',
          uploadedFileName: String(uploadedFileName || '').slice(0, 180),
          uploadedByUid: decoded.uid,
        },
        { merge: true }
      );

      logger.info(`[Magento] Admin search terms imported: ${cleaned.length} for brand ${brandId}`);
      res.status(200).json({ success: true, imported: cleaned.length });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[Magento] Admin search terms import failed:', msg);
      res.status(500).json({ error: msg });
    }
  }
);

// ─── Nightly Jobs Health Monitor ────────────────────────────────

type NightlyJobKey =
  | 'scheduledSyncMarketing'
  | 'scheduledSyncEcommerce'
  | 'scheduledSyncWebAnalytics'
  | 'scheduledSyncErp'
  | 'scheduledSyncFollowups'
  | 'scheduledAggregates'
  | 'scheduledAlerts'
  | 'scheduledDigest';

async function markNightlyJob(
  job: NightlyJobKey,
  state: 'running' | 'success' | 'failed',
  opts?: { message?: string; durationMs?: number }
): Promise<void> {
  const patch: Record<string, unknown> = {
    timezone: 'Europe/Athens',
    updatedAt: FieldValue.serverTimestamp(),
    [`jobs.${job}.status`]: state,
    [`jobs.${job}.updatedAt`]: FieldValue.serverTimestamp(),
  };

  if (opts?.message) {
    patch[`jobs.${job}.lastMessage`] = opts.message.slice(0, 500);
  }
  if (typeof opts?.durationMs === 'number') {
    patch[`jobs.${job}.lastDurationMs`] = Math.max(0, Math.round(opts.durationMs));
  }

  if (state === 'running') {
    patch[`jobs.${job}.lastStartedAt`] = FieldValue.serverTimestamp();
  } else if (state === 'success') {
    patch[`jobs.${job}.lastFinishedAt`] = FieldValue.serverTimestamp();
    patch[`jobs.${job}.lastSuccessAt`] = FieldValue.serverTimestamp();
  } else {
    patch[`jobs.${job}.lastFinishedAt`] = FieldValue.serverTimestamp();
    patch[`jobs.${job}.lastErrorAt`] = FieldValue.serverTimestamp();
  }

  await db.doc('system_health/nightly_jobs').set(patch, { merge: true });
}

/** Περιορισμένη παραλληλία (χαμηλότερο σφάξιμο API της Google σε νυχτερινό batch). */
async function runPool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  const n = Math.max(1, Math.min(concurrency, items.length));
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) break;
      await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: n }, () => worker()));
}

/**
 * Cloud Functions Gen 2 onSchedule supports up to 3600s. Κάθε «κύμα» connectors έχει δικό του
 * invocation ώστε Magento/ERP να μην κόβουν GA4/GSC μέσα στο ίδιο timeout με τα Ads.
 */
const SCHEDULED_SYNC_TIMEOUT_SECONDS = 1800;
/** Παράλληλη επεξεργασία brands μέσα σε ένα κύμα. */
const NIGHTLY_CONNECTOR_SYNC_CONCURRENCY = 3;

const CONNECTOR_NIGHTLY_SECRETS = [
  'META_APP_ID',
  'META_APP_SECRET',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'TIKTOK_APP_ID',
  'TIKTOK_APP_SECRET',
  'CONNECTOR_TOKEN_KEY',
];

type NightlyConnectorWave = 'marketing' | 'ecommerce' | 'analytics' | 'erp';

async function executeBrandNightlyWave(
  brandId: string,
  data: FirebaseFirestore.DocumentData,
  wave: NightlyConnectorWave
): Promise<void> {
  const buildTasks = () => {
    const tasks: Array<Promise<unknown>> = [];
    const wrap = (label: string, p: Promise<unknown>) =>
      tasks.push(
        p
          .then((r) => {
            const result = r as { imported?: number; success?: boolean; error?: string } | undefined;
            const imported = result?.imported;
            if (result?.success === false || result?.error) {
              logger.warn(
                `[ScheduledSync/${wave}] ${label} for ${brandId}: imported ${imported ?? 0}, error: ${result.error || 'unknown'}`
              );
            } else {
              logger.info(`[ScheduledSync/${wave}] ${label} for ${brandId}: imported ${imported ?? '—'}`);
            }
          })
          .catch((err) => logger.error(`[ScheduledSync/${wave}] ${label} failed for ${brandId}:`, err))
      );
    return { tasks, wrap };
  };

  const phase = buildTasks();

  switch (wave) {
    case 'marketing':
      if (data.google_ads?.connected) phase.wrap('Google Ads', fetchGoogleAdsCampaigns(brandId));
      if (data.meta?.connected) phase.wrap('Meta', fetchMetaCampaigns(brandId));
      if (data.tiktok?.connected) phase.wrap('TikTok', fetchTikTokCampaigns(brandId));
      if (data.merchant?.connected) phase.wrap('Merchant', fetchPriceBenchmarks(brandId));
      break;
    case 'ecommerce':
      if (data.shopify?.connected) phase.wrap('Shopify', fetchShopifyData(brandId));
      if (data.woocommerce?.connected) phase.wrap('WooCommerce', fetchWooCommerceData(brandId));
      if (data.opencart?.connected) phase.wrap('OpenCart', fetchOpenCartData(brandId));
      if (data.magento?.connected) phase.wrap('Magento', fetchMagentoData(brandId));
      break;
    case 'analytics':
      if (data.ga4?.connected && data.ga4?.propertyId) phase.wrap('GA4', fetchGA4Data(brandId));
      if (data.search_console?.connected && data.search_console?.siteUrl)
        phase.wrap('Search Console', fetchSearchConsoleData(brandId));
      break;
    case 'erp':
      if (data.megaventory?.connected)
        phase.wrap('Megaventory', fetchMegaventoryData(brandId, { mode: 'scheduled' }));
      if (data.softone?.connected) phase.wrap('SoftOne', fetchSoftOneData(brandId));
      if (data.epsilon_net?.connected) phase.wrap('Epsilon Net', fetchEpsilonNetData(brandId));
      if (data.entersoft?.connected) phase.wrap('Entersoft', fetchEntersoftData(brandId));
      break;
    default:
      break;
  }

  await Promise.all(phase.tasks);

  if (wave === 'erp') {
    try {
      await computeEcommerceSummary(brandId);
    } catch (err) {
      logger.error(`[ScheduledSync/erp] ecommerce_summary refresh failed for ${brandId}:`, err);
    }
  }

  if (wave === 'ecommerce') {
    const hasEcommerce =
      data.shopify?.connected ||
      data.woocommerce?.connected ||
      data.opencart?.connected ||
      data.magento?.connected;
    if (hasEcommerce) {
      try {
        await computeEcommerceSummary(brandId);
        logger.info(`[ScheduledSync/ecommerce] E-commerce summary updated for ${brandId}`);
      } catch (err) {
        logger.error(`[ScheduledSync/ecommerce] E-commerce summary failed for ${brandId}:`, err);
      }
    }
  }
}

async function runNightlyConnectorWaveJob(wave: NightlyConnectorWave, jobKey: NightlyJobKey): Promise<void> {
  const startedAt = Date.now();
  await markNightlyJob(jobKey, 'running', { message: `Nightly wave "${wave}" started` });
  logger.info(`[ScheduledSync] Starting "${wave}" wave`);

  try {
    const connectorsSnap = await db.collection('connectors').get();
    let failedConnectorBrands = 0;

    await runPool(connectorsSnap.docs, NIGHTLY_CONNECTOR_SYNC_CONCURRENCY, async (docSnap) => {
      const brandId = docSnap.id;
      const data = docSnap.data();
      try {
        await executeBrandNightlyWave(brandId, data, wave);
      } catch (err) {
        failedConnectorBrands += 1;
        logger.error(`[ScheduledSync/${wave}] Unexpected failure for ${brandId}:`, err);
      }
    });

    const durationMs = Date.now() - startedAt;
    await markNightlyJob(jobKey, 'success', {
      durationMs,
      message: `Wave "${wave}" ok. connectors=${connectorsSnap.size} failedBrands=${failedConnectorBrands}`,
    });
    logger.info(`[ScheduledSync] "${wave}" wave completed`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;
    await markNightlyJob(jobKey, 'failed', { durationMs, message: msg });
    logger.error(`[ScheduledSync/${wave}] Fatal error:`, msg);
    throw error;
  }
}

async function runNightlyFollowupsJob(): Promise<void> {
  const startedAt = Date.now();
  await markNightlyJob('scheduledSyncFollowups', 'running', {
    message: 'Stock movement + competitor monitoring',
  });
  logger.info('[ScheduledSync] Starting follow-ups job');

  try {
    const allBrandsSnap = await db.collection('brands').get();
    for (const bdoc of allBrandsSnap.docs) {
      const brandId = bdoc.id;
      try {
        await refreshStockMovement(brandId);
      } catch (err) {
        logger.warn(`[ScheduledSync/followups] Stock movement failed for ${brandId}:`, err);
      }
    }

    const competitorSnap = await db.collection('competitor_settings').get();
    let competitorRuns = 0;
    for (const cdoc of competitorSnap.docs) {
      const brandId = cdoc.id;
      const cdata = cdoc.data();
      if (cdata.competitors?.length > 0) {
        competitorRuns += 1;
        try {
          const result = await fetchCompetitorAds(brandId);
          logger.info(
            `[ScheduledSync/followups] Competitors for ${brandId}: ${result.totalAds} ads (${result.newAds} new)`
          );
        } catch (err) {
          logger.error(`[ScheduledSync/followups] Competitors failed for ${brandId}:`, err);
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    await markNightlyJob('scheduledSyncFollowups', 'success', {
      durationMs,
      message: `Follow-ups ok. brands=${allBrandsSnap.size} competitorConfigs=${competitorRuns}`,
    });
    logger.info('[ScheduledSync] Follow-ups completed');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const durationMs = Date.now() - startedAt;
    await markNightlyJob('scheduledSyncFollowups', 'failed', { durationMs, message: msg });
    logger.error('[ScheduledSync/followups] Fatal error:', msg);
    throw error;
  }
}

const nightlyConnectorScheduleBase = {
  timeZone: 'Europe/Athens',
  region: 'europe-west1' as const,
  memory: '1GiB' as const,
  timeoutSeconds: SCHEDULED_SYNC_TIMEOUT_SECONDS,
  secrets: CONNECTOR_NIGHTLY_SECRETS,
};

// ─── Scheduled: Connector waves (πρωινό παράθυρο → το "χθες" έχει κλείσει πλήρως) ──

/** Διαφήμιση & Merchant — 05:00 */
export const scheduledSyncMarketing = onSchedule(
  { ...nightlyConnectorScheduleBase, schedule: 'every day 05:00' },
  async () => runNightlyConnectorWaveJob('marketing', 'scheduledSyncMarketing')
);

/** E-shop imports + ecommerce_summary — 05:20 */
export const scheduledSyncEcommerce = onSchedule(
  { ...nightlyConnectorScheduleBase, schedule: 'every day 05:20' },
  async () => runNightlyConnectorWaveJob('ecommerce', 'scheduledSyncEcommerce')
);

/** GA4 + Search Console — 05:40 */
export const scheduledSyncWebAnalytics = onSchedule(
  { ...nightlyConnectorScheduleBase, schedule: 'every day 05:40' },
  async () => runNightlyConnectorWaveJob('analytics', 'scheduledSyncWebAnalytics')
);

/** ERP connectors — 06:00 */
export const scheduledSyncErp = onSchedule(
  { ...nightlyConnectorScheduleBase, schedule: 'every day 06:00' },
  async () => runNightlyConnectorWaveJob('erp', 'scheduledSyncErp')
);

/** Απόθεμα / ανταγωνισμός — 06:40 (μετά το ERP κύμα 06:00 + έως 30′ timeout) */
export const scheduledSyncFollowups = onSchedule(
  { ...nightlyConnectorScheduleBase, schedule: 'every day 06:40' },
  async () => runNightlyFollowupsJob()
);

/** Data Analysis RFM aggregate — monthly compact summary refresh; manual refresh remains available on demand. */
export const scheduledDataAnalysisRfm = onSchedule(
  { timeZone: 'Europe/Athens', region: 'europe-west1', memory: '2GiB', timeoutSeconds: 1200, schedule: '20 7 1 * *' },
  async () => {
    const snap = await db.collection('connectors').where('magento.connected', '==', true).limit(5).get();
    for (const doc of snap.docs) {
      try {
        await refreshDataAnalysisRfmAggregate(doc.id);
      } catch (error) {
        logger.warn(`[scheduledDataAnalysisRfm] failed for ${doc.id}:`, error);
      }
    }
  }
);

/** Product Intelligence aggregate — connector-backed catalogs only; procurement/import brands keep the UI path. */
export const scheduledProductIntelligence = onSchedule(
  { timeZone: 'Europe/Athens', region: 'europe-west1', memory: '2GiB', timeoutSeconds: 1200, schedule: 'every day 07:40' },
  async () => {
    const snap = await db.collection('connectors').limit(20).get();
    for (const doc of snap.docs) {
      try {
        await refreshProductIntelligenceAggregate(doc.id);
      } catch (error) {
        logger.warn(`[scheduledProductIntelligence] failed for ${doc.id}:`, error);
      }
    }
  }
);

/**
 * Gemini Proxy
 * POST /geminiProxy
 * Headers: Authorization: Bearer {FIREBASE_ID_TOKEN}
 * Body: { systemPrompt: string, userPrompt: string, model?: string, temperature?: number }
 * Returns: { text: string }
 *
 * The API key never leaves the server — stored as Firebase Secret.
 */
export const geminiProxy = onRequest(
  /**
   * 120s timeout (διπλάσιο του default 60s): το Gemini API σπάνια κρατά τόσο, αλλά cold-start
   * + αργή Firestore initialization (όπως το «metadata filters: 8.5s» που είδαμε σε production
   * trace) μπορούσαν να μηδενίσουν τον διαθέσιμο χρόνο για το LLM call → DEADLINE_EXCEEDED.
   */
  { region: 'europe-west1', timeoutSeconds: 120, memory: '512MiB', secrets: [GEMINI_SECRET] },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase ID token
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    const idToken = authHeader.slice(7);
    let decodedUid = '';
    try {
      const decoded = await admin.auth().verifyIdToken(idToken);
      decodedUid = decoded.uid;
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Rate limit: 30 Gemini calls / 5 λεπτά ανά χρήστη — αποτρέπει κατάχρηση/κόστος
    const rl = await enforceRateLimit({
      key: `gemini:${decodedUid}`,
      limit: 30,
      windowSeconds: 300,
    });
    if (!rl.allowed) {
      sendRateLimitExceeded(res, rl.resetInSeconds, 'gemini');
      return;
    }

    const { systemPrompt, userPrompt, model = 'gemini-2.5-pro', temperature = 0 } = req.body as {
      systemPrompt?: string;
      userPrompt?: string;
      model?: string;
      temperature?: number;
    };

    if (!userPrompt) {
      res.status(400).json({ error: 'Missing userPrompt' });
      return;
    }

    try {
      const apiKey = GEMINI_SECRET.value();
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({
        model,
        ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
        generationConfig: { temperature },
      });

      const result = await geminiModel.generateContent(userPrompt);
      const text = result.response.text();
      res.status(200).json({ text });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[geminiProxy] Gemini error:', message);
      res.status(500).json({ error: `Gemini request failed: ${message}` });
    }
  }
);

// ── Email Notification Endpoint ─────────────────────────────────────────────

export const sendEmailNotification = onRequest(
  { region: 'europe-west1', cors: true, secrets: [SMTP_EMAIL_SECRET, SMTP_PASSWORD_SECRET] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('POST only'); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    let callerUid: string;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
      callerUid = decoded.uid;
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { userIds, title, body, type, brandId, entityType, entityId } = req.body;
    if (!userIds || !Array.isArray(userIds) || !title) {
      res.status(400).json({ error: 'Missing userIds or title' });
      return;
    }
    if (!brandId || typeof brandId !== 'string') {
      res.status(400).json({ error: 'Missing brandId' });
      return;
    }

    // Caller must be a member of the brand on whose behalf they are sending.
    if (!(await verifyBrandMembership(callerUid, brandId))) {
      logger.warn('[sendEmailNotification] caller not a member of brand', { callerUid, brandId });
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Every recipient must also be a member of the same brand — prevents an authenticated
    // user from emailing arbitrary uids by submitting them in the payload.
    const isSuper = await isUidSuperAdmin(callerUid);
    const allowedUserIds: string[] = [];
    for (const uid of userIds) {
      if (typeof uid !== 'string' || !uid) continue;
      if (isSuper) { allowedUserIds.push(uid); continue; }
      const memberDoc = await db.doc(`brands/${brandId}/members/${uid}`).get();
      if (memberDoc.exists) { allowedUserIds.push(uid); continue; }
      const brandDoc = await db.doc(`brands/${brandId}`).get();
      if (brandDoc.exists && brandDoc.data()?.createdBy === uid) { allowedUserIds.push(uid); continue; }
      logger.warn('[sendEmailNotification] dropping non-member recipient', { uid, brandId });
    }
    if (allowedUserIds.length === 0) {
      res.status(400).json({ error: 'No valid recipients for brand' });
      return;
    }

    logger.info('[sendEmailNotification] SMTP batch start', {
      recipientCount: allowedUserIds.length,
      droppedCount: userIds.length - allowedUserIds.length,
      title: String(title).slice(0, 120),
      brandId,
      type: type || '',
    });

    const transporter = createTransporter({
      email: SMTP_EMAIL_SECRET.value(),
      password: SMTP_PASSWORD_SECRET.value(),
    });
    if (!transporter) {
      logger.warn('[sendEmailNotification] SMTP secrets empty or invalid');
      res.status(503).json({ ok: false, reason: 'smtp_not_configured' });
      return;
    }

    const results: string[] = [];
    for (const uid of allowedUserIds) {
      try {
        await sendNotificationEmail(
          uid,
          { title, body: body || '', type: type || '', brandId, entityType, entityId },
          transporter
        );
        results.push(`${uid}: sent`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn('[sendEmailNotification] send failed', { uid, error: msg.slice(0, 200) });
        results.push(`${uid}: failed`);
      }
    }

    const sent = results.filter((r) => r.includes(': sent')).length;
    const failed = results.filter((r) => r.includes(': failed')).length;
    logger.info('[sendEmailNotification] batch done', { sent, failed, total: results.length });

    res.status(200).json({ ok: true, results });
  }
);

// ── Send Invite Email ────────────────────────────────────────────────────────

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHttpUrl(u: unknown): string {
  try {
    const parsed = new URL(String(u));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

export const sendInviteEmail = onRequest(
  { region: 'europe-west1', cors: true, secrets: [SMTP_EMAIL_SECRET, SMTP_PASSWORD_SECRET] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('POST only'); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    let callerUid: string;
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
      callerUid = decoded.uid;
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { to, brandId, brandName, inviteLink, role, department } = req.body;
    if (!to || !inviteLink) {
      res.status(400).json({ error: 'Missing to or inviteLink' });
      return;
    }
    if (!brandId || typeof brandId !== 'string') {
      res.status(400).json({ error: 'Missing brandId' });
      return;
    }

    // Caller must have invite-management rights on the brand (owner / admin / brand creator / super admin).
    if (!(await verifyBrandConnectorManagement(callerUid, brandId))) {
      logger.warn('[sendInviteEmail] caller lacks brand management rights', { callerUid, brandId });
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const safeInviteLink = safeHttpUrl(inviteLink);
    if (!safeInviteLink) {
      res.status(400).json({ error: 'Invalid inviteLink' });
      return;
    }

    // Validate that the link points to an actual, unused, non-expired invite for this brand.
    // This blocks the endpoint from being used to email arbitrary content under our SMTP identity.
    const tokenSeg = safeInviteLink.split('/').filter(Boolean).pop() || '';
    if (!tokenSeg) {
      res.status(400).json({ error: 'Invalid inviteLink' });
      return;
    }
    try {
      const inviteSnap = await db.collection('invites').where('token', '==', tokenSeg).limit(1).get();
      if (inviteSnap.empty) {
        res.status(400).json({ error: 'Unknown invite token' });
        return;
      }
      const inv = inviteSnap.docs[0].data() as { brandId?: string; usedAt?: string; expiresAt?: string };
      if (inv.brandId !== brandId) {
        logger.warn('[sendInviteEmail] invite/brand mismatch', { callerUid, brandId, inviteBrand: inv.brandId });
        res.status(400).json({ error: 'Invite does not belong to brand' });
        return;
      }
      if (inv.usedAt) {
        res.status(400).json({ error: 'Invite already used' });
        return;
      }
      if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
        res.status(400).json({ error: 'Invite expired' });
        return;
      }
    } catch (err) {
      logger.warn('[sendInviteEmail] invite lookup failed', err);
      res.status(500).json({ error: 'Invite lookup failed' });
      return;
    }

    const transporter = createTransporter({
      email: SMTP_EMAIL_SECRET.value(),
      password: SMTP_PASSWORD_SECRET.value(),
    });
    if (!transporter) {
      logger.warn('SMTP not configured — skipping invite email');
      res.status(200).json({ ok: false, reason: 'smtp_not_configured' });
      return;
    }

    const roleLabel = role === 'admin' ? 'Admin' : 'Member';
    const brandNameSafe = escapeHtml(brandName || 'Performance+');
    const brandNameRaw = escapeHtml(brandName || '');
    const deptLabelSafe = department ? escapeHtml(department) : '';
    const hrefSafe = escapeHtml(safeInviteLink);

    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
        <div style="background: #111; border-radius: 12px 12px 0 0; padding: 20px 24px; text-align: center;">
          <span style="color: #fff; font-size: 18px; font-weight: 700;">Performance+</span>
        </div>
        <div style="border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px; padding: 24px;">
          <h2 style="margin: 0 0 8px; font-size: 16px; color: #111827;">Πρόσκληση στο ${brandNameSafe}</h2>
          <p style="margin: 0 0 6px; font-size: 14px; color: #6B7280; line-height: 1.5;">
            Έχετε προσκληθεί να συμμετάσχετε στο <strong style="color: #111827;">${brandNameRaw}</strong> ως <strong>${roleLabel}</strong>${deptLabelSafe ? ` (${deptLabelSafe})` : ''}.
          </p>
          <p style="margin: 0 0 20px; font-size: 14px; color: #6B7280; line-height: 1.5;">
            Πατήστε τον παρακάτω σύνδεσμο για να αποδεχτείτε την πρόσκληση.
          </p>
          <a href="${hrefSafe}"
             style="display: inline-block; padding: 12px 28px; background: #F97316; color: #fff; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
            Αποδοχή πρόσκλησης
          </a>
          <p style="margin: 16px 0 0; font-size: 12px; color: #9CA3AF;">
            Ο σύνδεσμος λήγει σε 7 ημέρες. Αν δεν μπορείτε να κάνετε κλικ, αντιγράψτε αυτό το URL:<br/>
            <span style="color: #6B7280; word-break: break-all;">${hrefSafe}</span>
          </p>
        </div>
        <p style="text-align: center; margin-top: 16px; font-size: 11px; color: #9CA3AF;">
          Performance+ · noreply@performanceplus.gr
        </p>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: SENDER,
        to,
        subject: `[Performance+] Πρόσκληση στο ${brandName || 'brand'}`,
        html,
      });
      logger.info(`Invite email sent to ${to} for brand ${brandName}`);
      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error('Failed to send invite email:', err);
      res.status(500).json({ ok: false, error: 'Email send failed' });
    }
  }
);

// ── Aggregate Stats: On-Demand (callable) ───────────────────────────────────

export const refreshAggregates = onRequest(
  { region: 'europe-west1', cors: true, timeoutSeconds: 540, memory: '2GiB', secrets: ['CONNECTOR_TOKEN_KEY'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      const { brandId } = req.body as { brandId?: string };
      if (!brandId) { res.status(400).json({ error: 'Missing brandId' }); return; }

      if (!(await verifyBrandMembership(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Not a member of this brand' });
        return;
      }

      await computeAggregatesForBrand(brandId);
      // Refresh e-commerce summary (skuStats, revenueByDay, topProducts) — χωρίς re-sync platforms.
      try {
        await computeEcommerceSummary(brandId);
      } catch (e) {
        logger.warn('[refreshAggregates] ecommerce summary refresh failed (non-fatal):', e);
      }
      // Stock movement: capture σημερινό snapshot + recompute deltas (universal)
      try {
        await refreshStockMovement(brandId);
      } catch (e) {
        logger.warn('[refreshAggregates] stock movement refresh failed (non-fatal):', e);
      }
      // Procurement signals: re-aggregate (status, tied capital, margin, lifetime κλπ)
      try {
        await refreshProcurementSignals(brandId);
      } catch (e) {
        logger.warn('[refreshAggregates] procurement signals refresh failed (non-fatal):', e);
      }
      res.status(200).json({ success: true, brandId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[refreshAggregates]', msg);
      res.status(500).json({ error: msg });
    }
  }
);

// ── Data Analysis RFM: Diagnostic + On-Demand Aggregate ─────────────────────

export const refreshDataAnalysisRfm = onRequest(
  { region: 'europe-west1', cors: true, timeoutSeconds: 1200, memory: '2GiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);
      const { brandId, action } = req.body as { brandId?: string; action?: 'diagnostic' | 'run' };
      if (!brandId) { res.status(400).json({ error: 'Missing brandId' }); return; }

      if (action === 'diagnostic') {
        if (!(await verifyBrandMembership(decoded.uid, brandId))) {
          res.status(403).json({ error: 'Not a member of this brand' });
          return;
        }
        const result = await computeDataAnalysisRfmDiagnostic(brandId);
        res.status(200).json({ success: true, brandId, action: 'diagnostic', result });
        return;
      }

      if (!(await verifyBrandConnectorManagement(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να ανανεώσει το Data Analysis aggregate' });
        return;
      }
      const result = await refreshDataAnalysisRfmAggregate(brandId);
      res.status(200).json({ success: true, brandId, action: 'run', result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[refreshDataAnalysisRfm]', msg);
      res.status(500).json({ error: msg });
    }
  }
);

export const refreshProductIntelligence = onRequest(
  { region: 'europe-west1', cors: true, timeoutSeconds: 1200, memory: '2GiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);
      const { brandId } = req.body as { brandId?: string };
      if (!brandId) { res.status(400).json({ error: 'Missing brandId' }); return; }

      if (!(await verifyBrandConnectorManagement(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να ανανεώσει το Product Intelligence aggregate' });
        return;
      }

      const result = await refreshProductIntelligenceAggregate(brandId);
      res.status(200).json({ success: true, brandId, result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[refreshProductIntelligence]', msg);
      res.status(500).json({ error: msg });
    }
  }
);

export const queryProductIntelligence = onRequest(
  { region: 'europe-west1', cors: true, timeoutSeconds: 120, memory: '1GiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);
      const { brandId } = req.body as { brandId?: string };
      if (!brandId) { res.status(400).json({ error: 'Missing brandId' }); return; }

      if (!(await verifyBrandMembership(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Δεν υπάρχει πρόσβαση στο brand' });
        return;
      }

      const result = await queryProductIntelligenceRows(req.body);
      res.status(200).json({ success: true, brandId, result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[queryProductIntelligence]', msg);
      res.status(500).json({ error: msg });
    }
  }
);

export const refreshCompetitiveInventory = onRequest(
  { region: 'europe-west1', cors: true, timeoutSeconds: 1200, memory: '2GiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);
      const { brandId } = req.body as { brandId?: string };
      if (!brandId) { res.status(400).json({ error: 'Missing brandId' }); return; }

      if (!(await verifyBrandMembership(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Δεν υπάρχει πρόσβαση στο brand' });
        return;
      }

      const result = await refreshCompetitiveInventoryLookup(brandId);
      res.status(200).json({ success: true, brandId, result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[refreshCompetitiveInventory]', msg);
      res.status(500).json({ error: msg });
    }
  }
);

// ── Stock Movement: Manual Capture (callable) ───────────────────────────────

/**
 * POST /captureStock
 * Body: { brandId }
 * Καταγράφει σημερινό stock snapshot και υπολογίζει deltas (7d/30d/90d).
 * Δουλεύει για κάθε brand — connector ή import-only.
 */
export const captureStock = onRequest(
  { region: 'europe-west1', cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      const { brandId } = req.body as { brandId?: string };
      if (!brandId) { res.status(400).json({ error: 'Missing brandId' }); return; }

      if (!(await verifyBrandMembership(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Not a member of this brand' });
        return;
      }

      const captured = await captureStockSnapshot(brandId);
      const movement = await computeStockMovement(brandId);
      res.status(200).json({ success: true, brandId, captured, movement });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[captureStock]', msg);
      res.status(500).json({ error: msg });
    }
  }
);

// ── Procurement Signals: Manual Refresh (after upload) ─────────────────────

/**
 * POST /refreshSignals
 * Body: { brandId }
 * Re-aggregates procurement_inventory + pricing_policy + fiscal_year + item_evaluation
 * σε procurement_signals/{brandId}.skuSignalsJson. Καλείται μετά από procurement upload.
 */
export const refreshSignals = onRequest(
  { region: 'europe-west1', cors: true, timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      const { brandId } = req.body as { brandId?: string };
      if (!brandId) { res.status(400).json({ error: 'Missing brandId' }); return; }

      if (!(await verifyBrandMembership(decoded.uid, brandId))) {
        res.status(403).json({ error: 'Not a member of this brand' });
        return;
      }

      const result = await refreshProcurementSignals(brandId);
      res.status(200).json({ success: true, brandId, ...result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[refreshSignals]', msg);
      res.status(500).json({ error: msg });
    }
  }
);

// ── Aggregate Stats (μετά τα πρωινά connector waves και follow-ups ~06:40) ────────

export const scheduledAggregates = onSchedule(
  {
    schedule: 'every day 07:00',
    timeZone: 'Europe/Athens',
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const startedAt = Date.now();
    await markNightlyJob('scheduledAggregates', 'running', { message: 'Aggregate computation started' });
    try {
      logger.info('[scheduledAggregates] Starting daily aggregate computation');
      const count = await computeAggregatesForAllBrands();
      const durationMs = Date.now() - startedAt;
      await markNightlyJob('scheduledAggregates', 'success', {
        durationMs,
        message: `Completed for ${count} brands`,
      });
      logger.info(`[scheduledAggregates] Completed for ${count} brands`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      await markNightlyJob('scheduledAggregates', 'failed', { durationMs, message: msg });
      logger.error('[scheduledAggregates] Fatal error:', msg);
      throw error;
    }
  }
);

// ── Server-Side Alert Evaluation (runs after aggregates are fresh) ──────────

export const scheduledAlerts = onSchedule(
  {
    schedule: 'every day 07:15',
    timeZone: 'Europe/Athens',
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const startedAt = Date.now();
    await markNightlyJob('scheduledAlerts', 'running', { message: 'Alert evaluation started' });
    try {
      logger.info('[scheduledAlerts] Starting server-side alert evaluation');
      const { brands, alerts } = await evaluateAllBrandsServerSide();
      const durationMs = Date.now() - startedAt;
      await markNightlyJob('scheduledAlerts', 'success', {
        durationMs,
        message: `Completed: brands=${brands}, newAlerts=${alerts}`,
      });
      logger.info(`[scheduledAlerts] Completed: ${brands} brands, ${alerts} new alerts`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      await markNightlyJob('scheduledAlerts', 'failed', { durationMs, message: msg });
      logger.error('[scheduledAlerts] Fatal error:', msg);
      throw error;
    }
  }
);

// ── Daily Email Digest (runs after alerts are generated) ────────────────────

export const scheduledDigest = onSchedule(
  {
    schedule: 'every day 07:35',
    timeZone: 'Europe/Athens',
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: [SMTP_EMAIL_SECRET, SMTP_PASSWORD_SECRET],
  },
  async () => {
    const startedAt = Date.now();
    await markNightlyJob('scheduledDigest', 'running', { message: 'Daily digest started' });
    try {
      logger.info('[scheduledDigest] Starting daily email digest');
      const { brands, emails } = await sendDigestForAllBrands({
        email: SMTP_EMAIL_SECRET.value(),
        password: SMTP_PASSWORD_SECRET.value(),
      });
      const durationMs = Date.now() - startedAt;
      await markNightlyJob('scheduledDigest', 'success', {
        durationMs,
        message: `Completed: brands=${brands}, emails=${emails}`,
      });
      logger.info(`[scheduledDigest] Completed: ${brands} brands, ${emails} emails sent`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - startedAt;
      await markNightlyJob('scheduledDigest', 'failed', { durationMs, message: msg });
      logger.error('[scheduledDigest] Fatal error:', msg);
      throw error;
    }
  }
);

// ── Public: εκδήλωση ενδιαφέροντος (landing, χωρίς auth) ─────────────────────

export const submitInterestLead = onRequest(
  { region: 'europe-west1', secrets: [SMTP_EMAIL_SECRET, SMTP_PASSWORD_SECRET] },
  async (req, res) => {
    // Strict CORS (whitelisted origins only) — αποτρέπει scraping/abuse από τυχαία domains
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }

    // Rate limit: 5 υποβολές / 15 λεπτά ανά IP — αποτρέπει spam submissions
    const ip = getClientIp(req);
    const rl = await enforceRateLimit({
      key: `lead:${ip}`,
      limit: 5,
      windowSeconds: 15 * 60,
    });
    if (!rl.allowed) {
      sendRateLimitExceeded(res, rl.resetInSeconds, 'interest_lead');
      return;
    }

    try {
      const raw = req.body;
      const body: Record<string, unknown> =
        raw && typeof raw === 'object' && !Buffer.isBuffer(raw)
          ? (raw as Record<string, unknown>)
          : {};
      const forwardedFor = req.headers['x-forwarded-for'];
      const ff = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
      const result = await persistInterestLead(db, body, {
        forwardedFor: ff,
        smtp: {
          email: SMTP_EMAIL_SECRET.value(),
          password: SMTP_PASSWORD_SECRET.value(),
        },
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error || 'Invalid request' });
        return;
      }
      res.status(200).json({ ok: true, emailResult: result.emailResult ?? null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error('[submitInterestLead]', msg);
      if (/smtp|email notification|notify email/i.test(msg)) {
        res.status(502).json({
          error: 'Η υποβολή καταγράφηκε, αλλά δεν στάλθηκε email στο support. Δοκιμάστε ξανά ή επικοινωνήστε με support@notthesame.gr.',
        });
        return;
      }
      res.status(500).json({ error: 'Server error' });
    }
  }
);
