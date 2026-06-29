import * as admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from './utils/logger';
import { defineSecret } from 'firebase-functions/params';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Busboy from 'busboy';
// conversions=metrics.conversions only, untilStr=yesterday, no REMOVED filter

const GEMINI_SECRET = defineSecret('GEMINI_API_KEY');
/** SMTP: login mailbox (often the same as noreply or a service-account Gmail) */
const SMTP_EMAIL_SECRET = defineSecret('SMTP_EMAIL');
/** SMTP: password or App Password */
const SMTP_PASSWORD_SECRET = defineSecret('SMTP_PASSWORD');
// OpenCart sync egresses through fixed-IP VPC connector pp-opencart-connector (store firewall
// allowlist); it exists only in prod, so gate on GCLOUD_PROJECT — non-prod deploys without VPC.
const PROD_PROJECT_ID = 'performance-plus-4a5b2';
const OPENCART_EGRESS_OPTIONS: { vpcConnector?: string; vpcConnectorEgressSettings?: 'ALL_TRAFFIC' } =
  process.env.GCLOUD_PROJECT === PROD_PROJECT_ID
    ? { vpcConnector: 'pp-opencart-connector', vpcConnectorEgressSettings: 'ALL_TRAFFIC' }
    : {};
import { nestDottedKeys } from './firestorePatch';
import { sanitizeOAuthReturnOrigin } from './oauthRedirect';
import { validateImportUrl, safeFetch } from './urlValidator';
import { verifyState } from './oauthState';
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
  runOpenCartBackfillJob,
  ensureOpenCartBackfillJobQueued,
  isOpenCartInitialBackfillIncomplete,
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
  listMegaventoryLocations,
  recomputeMegaventoryProductTotals,
  mergeMegaventoryApiCatalogProducts,
  setDb as setMegaventoryDb,
} from './megaventoryConnector';
import { decideStaleRecovery, isJobWriteOwned, MAX_STALE_RESUMES } from './megaventorySyncPlan';
import { randomUUID } from 'crypto';
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
  computeErpSkuVelocity,
  setDb as setEcommerceAggDb,
} from './ecommerceAggregator';
import { shouldRunPostSyncAggregations } from './syncPolicy';
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
  classifyAggregateRecovery,
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
import { refreshMarketingPlanInsightAggregate } from './marketingPlan/aggregate';
import {
  getGA4AuthUrl,
  handleGA4Callback,
  fetchGA4Data,
  fetchGA4PeriodTotals,
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
import { ALERT } from './utils/alertKeys';
import { runWithLogContext } from './utils/logContext';
import { getRequestId } from './utils/requestContext';

// Mirror of CLIENT_ALERT.unkeyed (src/utils/alertKeys.ts) for the client error sink fallback.
const ALERT_CLIENT_UNKEYED = 'client_unkeyed';
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

/** Super-admin allowlist at appConfig/superAdmins ({ uids, emails }); cached per cold-start. */
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
    logger.warn('[superAdmins] Firestore read failed; allowlist empty until next retry', { err });
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

/** Authoritative "belongs to ANY brand?" check against membership docs — fallback for
 * when the cached `users/{uid}.brandIds` is empty/stale. */
async function userHasAnyBrandMembership(uid: string): Promise<boolean> {
  const snap = await db.collectionGroup('members').where('userId', '==', uid).limit(1).get();
  return !snap.empty;
}

/** Connect/disconnect/sync connectors: owner, admin, brand creator, or super admin */
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
      logger.error(`[Procurement] ${msg}`, { alertKey: ALERT.importDataFailed, err });
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
    // Stock snapshot after product import — starts/refreshes tracking for brands
    // without a connector (where stock comes from imports).
    try {
      await refreshStockMovement(brandId);
    } catch (e) {
      logger.warn(`[importProducts] stock movement refresh failed for ${brandId}:`, { err: e });
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

/** POST /importData (Bearer API_KEY) — multipart file or JSON fileUrl; type=products|campaigns|
 * segments|procurement, optional channel override. */
export const importData = onRequest(
  {
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 300,
    maxInstances: 5,
  },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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

        // safeFetch re-validates the host via DNS + blocks private ranges and
        // re-checks every redirect hop (SSRF guard).
        let response: Response;
        try {
          response = await safeFetch(fileUrl);
        } catch (e) {
          logger.error('fetchImportUrl fileUrl fetch failed:', { alertKey: ALERT.importDataFailed, err: e }); res.status(400).json({ error: 'Failed to fetch fileUrl' });
          return;
        }
        if (!response.ok) {
          res.status(400).json({ error: `Failed to download file from URL: ${response.status}` });
          return;
        }

        // Cap the download size — refuse oversized bodies before buffering.
        const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
        const declaredLen = Number(response.headers.get('content-length') || 0);
        if (declaredLen && declaredLen > MAX_IMPORT_BYTES) {
          res.status(413).json({ error: 'File too large (max 50MB)' });
          return;
        }
        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        if (buffer.length > MAX_IMPORT_BYTES) {
          res.status(413).json({ error: 'File too large (max 50MB)' });
          return;
        }
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
        computeAggregatesForBrand(brandId).catch(e => logger.warn('[import] aggregate refresh failed:', { err: e }));
        res.status(200).json(result);
        return;
      }

      // Multipart form data
      const bb = Busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
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
      computeAggregatesForBrand(brandId).catch(e => logger.warn('[import] aggregate refresh failed:', { err: e }));

      res.status(200).json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Import failed:', { alertKey: ALERT.importDataFailed, err: error });
      res.status(500).json({ error: 'Import failed — check file format and try again' });
    }
  }
);

/** Server-side fetch of an import/feed URL for the import UI (CORS workaround). Generic outbound
 * fetcher → validateImportUrl + safeFetch SSRF guard, ID-token auth + per-user rate limit. */
export const fetchImportUrl = onRequest(
  { region: 'europe-west1', timeoutSeconds: 60, memory: '256MiB' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    let uid = '';
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
      uid = decoded.uid;
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    await runWithLogContext({ uid, requestId: getRequestId(req) }, async () => {
      // Outbound fetcher → rate limit per user (20 / 5 min) to prevent relay abuse.
      const rl = await enforceRateLimit({ key: `fetchImportUrl:${uid}`, limit: 20, windowSeconds: 300 });
      if (!rl.allowed) {
        sendRateLimitExceeded(res, rl.resetInSeconds, 'fetchImportUrl');
        return;
      }

      const { url } = (req.body ?? {}) as { url?: string };
      if (!url || typeof url !== 'string') {
        res.status(400).json({ error: 'Missing url' });
        return;
      }
      const check = validateImportUrl(url);
      if (!check.ok) {
        res.status(400).json({ error: `Invalid url: ${check.reason}` });
        return;
      }

      let upstream: Awaited<ReturnType<typeof safeFetch>>;
      try {
        upstream = await safeFetch(url);
      } catch (e) {
        logger.error('fetchImportUrl url fetch failed:', { alertKey: ALERT.fetchImportUrlFailed, err: e }); res.status(400).json({ error: 'Failed to fetch URL' });
        return;
      }
      if (!upstream.ok) {
        res.status(502).json({ error: `Upstream responded ${upstream.status}` });
        return;
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > 50 * 1024 * 1024) {
        res.status(413).json({ error: 'File too large (max 50MB)' });
        return;
      }
      res.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
      res.status(200).send(buf);
    });
  }
);

/** POST /generateApiKey (Bearer FIREBASE_ID_TOKEN) — Body: { brandId }. */
export const generateApiKey = onRequest(
  { region: 'europe-west1' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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

      await runWithLogContext({ uid: decoded.uid, requestId: getRequestId(req) }, async () => {
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
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Generate API key failed:', { alertKey: ALERT.generateApiKeyFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Client error sink: browser errors re-emitted to the logger (Cloud Monitoring → Slack);
// flood-capped per identity (uid, else IP), best-effort auth (unauthenticated reports accepted).

const CLIENT_ERROR_FLOOD_CAP = 60; // reports/min/identity
const CLIENT_ERROR_WINDOW_MS = 60_000;
const clientErrorCounters = new Map<string, { count: number; resetAt: number }>();

function clientErrorFlooding(identity: string, now: number): boolean {
  const cur = clientErrorCounters.get(identity);
  if (!cur || now >= cur.resetAt) {
    clientErrorCounters.set(identity, { count: 1, resetAt: now + CLIENT_ERROR_WINDOW_MS });
    return false;
  }
  cur.count += 1;
  return cur.count > CLIENT_ERROR_FLOOD_CAP;
}

export const logClientError = onRequest(
  { region: 'europe-west1', timeoutSeconds: 10, memory: '256MiB', maxInstances: 10 },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST' });
      return;
    }

    // Best-effort identity: verified uid if a valid token is present, else client IP.
    let uid: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        uid = (await admin.auth().verifyIdToken(authHeader.slice(7).trim())).uid;
      } catch {
        uid = null; // invalid/expired token → treat as anonymous, don't reject
      }
    }
    const identity = uid ?? `ip:${getClientIp(req)}`;

    // Flood cap (memory-backed, per-instance) — accept-and-drop so the client never retries.
    if (clientErrorFlooding(identity, Date.now())) {
      res.status(200).json({ ok: true, dropped: true });
      return;
    }

    try {
      await runWithLogContext({ uid, requestId: getRequestId(req) }, async () => {
        const d = (req.body ?? {}) as Record<string, unknown>;
        const cap = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n) : undefined);
        const ctx = (d.context ?? {}) as Record<string, unknown>;
        const message = cap(d.message, 300) || 'client error';
        const alertKey = cap(d.alertKey, 80) || ALERT_CLIENT_UNKEYED;

        // Re-emit through the structured logger so it hits the alertable metric. `source: 'client'`
        // lets operators filter browser-origin alerts from backend ones.
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
        logger.error(message, {
          alertKey,
          source: 'client',
          userId: uid,
          clientRequestId: cap(ctx.requestId, 200),
          page: cap(ctx.page, 200),
          name: cap(ctx.name, 120),
          code: cap(ctx.code, 120),
          stack: cap(ctx.stack, 4000),
          // Source location (window.onerror without an Error object → no stack): the only triage handle.
          fileName: cap(ctx.source, 300),
          line: num(ctx.line),
          col: num(ctx.col),
        });

        res.status(200).json({ ok: true, dropped: false });
      });
    } catch (err) {
      logger.error('logClientError sink failed', { alertKey: ALERT.clientErrorSinkFailed, err });
      res.status(500).json({ error: 'Internal error' });
    }
  }
);

// ─── Connector: Get OAuth URLs ─────────────────────────────────

/** POST /connectorAuth — Body: { brandId, provider, redirectUri } → { authUrl }. */
export const connectorAuth = onRequest(
  // CONNECTOR_TOKEN_KEY: used by signState() to HMAC-sign the OAuth state.
  { region: 'europe-west1', secrets: ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'TIKTOK_APP_ID', 'TIKTOK_APP_SECRET', 'CONNECTOR_TOKEN_KEY'] },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      await runWithLogContext({ uid: decoded.uid, requestId: getRequestId(req) }, async () => {
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
        // getTikTokAuthUrl throws when TIKTOK_APP_ID is missing/placeholder (e.g. "pending"
        // while the Marketing API app awaits approval) — surface a clear error instead of
        // bouncing the user to TikTok's portal, which rejects a non-numeric app_id.
        try {
          authUrl = getTikTokAuthUrl(brandId, redirectUri, returnOrigin, oauthInitiator);
        } catch {
          res.status(400).json({ error: 'Το TikTok app δεν έχει ρυθμιστεί ακόμη (εκκρεμεί έγκριση Marketing API / λείπει το app_id).' });
          return;
        }
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
        // normalizeShopDomain throws on non-myshopify hosts — user input error, not a 500.
        try {
          authUrl = getShopifyAuthUrl(brandId, shopDomain, redirectUri, returnOrigin);
        } catch {
          res.status(400).json({ error: 'Invalid shopDomain: expected {store}.myshopify.com' });
          return;
        }
      } else {
        res.status(400).json({ error: `Unknown provider: ${provider}` });
        return;
      }

      res.status(200).json({ authUrl });
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Request failed:', { alertKey: ALERT.connectorAuthFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Connector: OAuth Callback ─────────────────────────────────

/** GET /connectorCallback?code=xxx&state=base64({brandId, provider}) — OAuth redirect handler. */
export const connectorCallback = onRequest(
  { region: 'europe-west1', secrets: ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'TIKTOK_APP_ID', 'TIKTOK_APP_SECRET', 'CONNECTOR_TOKEN_KEY'] },
  async (req, res) => {
    const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string };

    // Google OAuth may redirect with ?error=access_denied instead of ?code=xxx
    if (oauthError && state) {
      try {
        // Lenient parse — this branch only builds an error-redirect; returnOrigin is
        // re-validated by sanitizeOAuthReturnOrigin regardless of signature.
        const parsed = (verifyState<{ provider?: string; returnOrigin?: string }>(state)) ?? {};
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
      // Verify HMAC signature + expiry — a forged/tampered state (e.g. carrying a victim's brandId)
      // is rejected, so tokens only land on the brand the signer intended.
      const parsed = verifyState<{
        brandId: string;
        provider: string;
        redirectUri: string;
        returnOrigin?: string;
        shopDomain?: string;
        /** Firebase uid of admin who started OAuth (embedded in state from connectorAuth) */
        oauthInitiatedByUid?: string;
      }>(state);
      if (!parsed || !parsed.brandId || !parsed.provider) {
        res.status(400).send('Invalid or expired OAuth state');
        return;
      }
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
      const cid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      logger.error(`[ConnectorCallback] Error (cid=${cid}):`, { alertKey: ALERT.connectorCallbackFailed, err: error });
      // Don't leak internal error detail to the browser; reference the log via cid.
      res.status(500).send(`Callback error (ref: ${cid}). Please try reconnecting.`);
    }
  }
);

// ─── Connector: Disconnect ─────────────────────────────────────

/** POST /connectorDisconnect — Body: { brandId, provider }. */
export const connectorDisconnect = onRequest(
  { region: 'europe-west1' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      await runWithLogContext({ uid: decoded.uid, requestId: getRequestId(req) }, async () => {
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
        clearPayload.authType = '';
        clearPayload.clientId = '';
        clearPayload.clientSecret = '';
        clearPayload.username = '';
        clearPayload.password = '';
      }
      if (provider === 'magento') {
        // Full wipe: otherwise stale shopName/storeUrl/storeWebUrl remain and the wrong store
        // can show on the connector card after disconnect.
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
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Request failed:', { alertKey: ALERT.connectorDisconnectFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Connector: Select Ad Account ──────────────────────────────

/** POST /connectorSelectAccount — Body: { brandId, provider, accountId, accountName }. */
export const connectorSelectAccount = onRequest(
  { region: 'europe-west1' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      await runWithLogContext({ uid: decoded.uid, requestId: getRequestId(req) }, async () => {
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
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Request failed:', { alertKey: ALERT.connectorSelectAccountFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Connector: Manual Sync ────────────────────────────────────

/** POST /connectorSync — Body: { brandId, provider }. */
export const connectorSync = onRequest(
  { region: 'europe-west1', timeoutSeconds: 1200, memory: '4GiB', cpu: 2, secrets: ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'SHOPIFY_API_KEY', 'SHOPIFY_API_SECRET', 'TIKTOK_APP_ID', 'TIKTOK_APP_SECRET', 'CONNECTOR_TOKEN_KEY'], ...OPENCART_EGRESS_OPTIONS },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    let brandId = '';
    let provider = '';
    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      await runWithLogContext({ uid: decoded.uid, requestId: getRequestId(req) }, async () => {
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
        const jobId = `opencart_${brandId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
        const jobRef = admin.firestore().collection('connector_sync_jobs').doc(jobId);
        const existing = await jobRef.get();
        const existingStatus = existing.data()?.status;
        if (existingStatus === 'pending' || existingStatus === 'running') {
          result = {
            success: true,
            queued: true,
            jobId,
            imported: 0,
            message: 'OpenCart sync ήδη σε εξέλιξη στο background.',
          };
        } else {
          const queued = await ensureOpenCartBackfillJobQueued(brandId, { mode: 'manual_backfill' });
          result = {
            success: true,
            queued: true,
            jobId,
            imported: 0,
            message: queued.queued
              ? 'OpenCart sync ξεκίνησε στο background. Θα ολοκληρωθεί αυτόματα — δεν χρειάζεται να περιμένεις.'
              : 'OpenCart backfill ήδη ολοκληρωμένο.',
          };
        }
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

      // ecommerce_summary + business_revenue_summary post-sync, only on success/import — a clean
      // failure doesn't justify the heavy recomputes (a fresh syncedAt would hide the failed import).
      const runPostSyncAggregations = shouldRunPostSyncAggregations(result);
      if (
        ['shopify', 'woocommerce', 'opencart', 'magento', 'megaventory', 'softone'].includes(provider) &&
        runPostSyncAggregations
      ) {
        try {
          await computeEcommerceSummary(brandId);
        } catch (e) {
          logger.warn(`[connectorSync] ecommerce summary refresh failed for ${brandId}:`, { err: e });
        }
      }

      if (['shopify', 'woocommerce', 'opencart', 'magento'].includes(provider) && runPostSyncAggregations) {
        // Stock movement tracking (universal — works for non-connector brands too)
        try {
          await refreshStockMovement(brandId);
        } catch (e) {
          logger.warn(`[connectorSync] stock movement refresh failed for ${brandId}:`, { err: e });
        }
      }

      if (
        ['shopify', 'woocommerce', 'opencart', 'magento', 'megaventory', 'softone'].includes(provider) &&
        runPostSyncAggregations
      ) {
        try {
          await refreshProductIntelligenceAggregate(brandId);
        } catch (e) {
          logger.warn(`[connectorSync] product intelligence refresh failed for ${brandId}:`, { err: e });
        }
      }
      if (!runPostSyncAggregations && result.queued !== true) {
        logger.info(`[connectorSync] post-sync aggregations skipped for ${brandId} (${provider}): sync failed with nothing imported`);
      }

      res.status(200).json(result);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[connectorSync] failed for brand=${brandId || 'unknown'} provider=${provider || 'unknown'}: ${msg}`, { alertKey: ALERT.connectorSyncFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/** GA4-deduplicated period totals for a specific range (daily totalUsers/newUsers don't sum — GA4
 * dedups per period). Firestore cache TTL 3h, written server-side only. */
export const ga4PeriodTotals = onRequest(
  // CONNECTOR_TOKEN_KEY: decryptToken needs it for the GA4 refresh token, else "GA4 token unavailable".
  { region: 'europe-west1', secrets: ['GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'CONNECTOR_TOKEN_KEY'] },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.slice(7).trim());
      await runWithLogContext({ uid: decoded.uid, requestId: getRequestId(req) }, async () => {
      const body = req.body as { brandId?: string; startDate?: string; endDate?: string };
      const brandId = body.brandId || '';
      const startDate = body.startDate || '';
      const endDate = body.endDate || '';
      if (!brandId || !startDate || !endDate) { res.status(400).json({ error: 'Missing params' }); return; }

      if (!(await verifyBrandMembership(decoded.uid, brandId))) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }

      const docId = `${brandId}__${startDate}__${endDate}`.replace(/[^A-Za-z0-9_-]/g, '_');
      const cacheRef = db.doc(`ga4_period_cache/${docId}`);
      const TTL_MS = 3 * 60 * 60 * 1000;

      const cached = await cacheRef.get();
      if (cached.exists) {
        const c = cached.data() as { totals?: unknown; computedAtMs?: number };
        if (c.totals && typeof c.computedAtMs === 'number' && Date.now() - c.computedAtMs < TTL_MS) {
          res.status(200).json({ success: true, totals: c.totals, cached: true });
          return;
        }
      }

      const r = await fetchGA4PeriodTotals(brandId, startDate, endDate);
      if (!r.success || !r.totals) {
        res.status(502).json({ success: false, error: r.error || 'GA4 period totals failed' });
        return;
      }

      await cacheRef.set({
        brandId,
        startDate,
        endDate,
        totals: r.totals,
        computedAtMs: Date.now(),
        computedAt: FieldValue.serverTimestamp(),
      });
      res.status(200).json({ success: true, totals: r.totals, cached: false });
      });
    } catch (error) {
      const cid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      logger.error(`[ga4PeriodTotals] failed (cid=${cid}):`, { alertKey: ALERT.ga4PeriodTotalsFailed, err: error });
      // Generic error to the client + correlation id for support; detail stays in logs.
      res.status(500).json({ error: 'Internal error', correlationId: cid });
    }
  }
);

async function resumeIncompleteOpenCartBackfills(db: FirebaseFirestore.Firestore): Promise<number> {
  const connectorsSnap = await db
    .collection('connectors')
    .where('opencart.connected', '==', true)
    .limit(50)
    .get();
  let queued = 0;
  for (const cdoc of connectorsSnap.docs) {
    const oc = cdoc.data().opencart as Record<string, unknown> | undefined;
    if (!isOpenCartInitialBackfillIncomplete(oc)) continue;
    const result = await ensureOpenCartBackfillJobQueued(cdoc.id, { mode: 'watchdog_resume' });
    if (result.queued) {
      logger.info(`[OpenCartJob] Watchdog re-queued ${cdoc.id}: ${result.reason}`);
      queued += 1;
    }
  }
  return queued;
}

/** Rebuild PI when OpenCart catalog is synced but aggregate stayed at 0 (e.g. stale SKU parsing). */
async function repairEmptyOpenCartProductIntelligence(db: FirebaseFirestore.Firestore): Promise<void> {
  const connectorsSnap = await db
    .collection('connectors')
    .where('opencart.connected', '==', true)
    .limit(20)
    .get();

  for (const cdoc of connectorsSnap.docs) {
    const oc = cdoc.data().opencart as Record<string, unknown> | undefined;
    const lastSyncProducts = Number(oc?.lastSyncProducts ?? 0);
    if (lastSyncProducts <= 0) continue;
    if (isOpenCartInitialBackfillIncomplete(oc)) continue;

    const brandId = cdoc.id;
    const piRef = db.doc(`product_intelligence/${brandId}`);
    const pi = await piRef.get();
    const piData = pi.data();
    if (piData?.status === 'running') continue;
    if (Number(piData?.totalCount ?? 0) > 0) continue;

    const repairAt = piData?.repairAttemptAt?.toDate?.() as Date | undefined;
    if (repairAt && Date.now() - repairAt.getTime() < 5 * 60 * 1000) continue;

    await piRef.set({ repairAttemptAt: FieldValue.serverTimestamp() }, { merge: true });
    logger.info(`[PIWatchdog] Rebuilding product intelligence for ${brandId} (lastSyncProducts=${lastSyncProducts})`);
    try {
      const result = await refreshProductIntelligenceAggregate(brandId);
      logger.info(`[PIWatchdog] ${brandId}: totalCount=${result.totalCount ?? 0}`);
    } catch (error) {
      logger.warn(`[PIWatchdog] failed for ${brandId}:`, { err: error });
    }
    return;
  }
}

export const processOpenCartSyncJobs = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'europe-west1',
    timeoutSeconds: 1800,
    memory: '2GiB',
    secrets: ['CONNECTOR_TOKEN_KEY'],
    ...OPENCART_EGRESS_OPTIONS,
  },
  async () => runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
    const db = admin.firestore();
    const STALE_RUNNING_MS = 40 * 60 * 1000;

    const staleRunning = await db
      .collection('connector_sync_jobs')
      .where('provider', '==', 'opencart')
      .where('status', '==', 'running')
      .limit(5)
      .get();
    for (const doc of staleRunning.docs) {
      const updatedAt = doc.data().updatedAt?.toDate?.() as Date | undefined;
      if (updatedAt && Date.now() - updatedAt.getTime() > STALE_RUNNING_MS) {
        logger.warn(`[OpenCartJob] Recovering stale running job ${doc.id}`);
        await doc.ref.update({
          status: 'pending',
          error: 'Recovered stale running job',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    await resumeIncompleteOpenCartBackfills(db);
    await repairEmptyOpenCartProductIntelligence(db);

    const snap = await db
      .collection('connector_sync_jobs')
      .where('provider', '==', 'opencart')
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (snap.empty) return;

    const jobRef = snap.docs[0].ref;
    const job = await db.runTransaction(async (tx) => {
      const latest = await tx.get(jobRef);
      const data = latest.data() as {
        brandId?: string;
        status?: string;
        batchesRun?: number;
        totalImported?: number;
      } | undefined;
      if (!latest.exists || data?.status !== 'pending' || !data.brandId) return null;
      tx.update(jobRef, {
        status: 'running',
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        brandId: data.brandId,
        batchesRun: typeof data.batchesRun === 'number' ? data.batchesRun : 0,
        totalImported: typeof data.totalImported === 'number' ? data.totalImported : 0,
      };
    });

    if (!job) return;

    try {
      logger.info(`[OpenCartJob] Starting backfill for ${job.brandId} (prior batches: ${job.batchesRun})`);
      const result = await runOpenCartBackfillJob(job.brandId, {
        initialBatchesRun: job.batchesRun,
        initialTotalImported: job.totalImported,
      });

      if (result.complete) {
        try {
          await computeEcommerceSummary(job.brandId);
        } catch (e) {
          logger.warn(`[OpenCartJob] ecommerce summary refresh failed for ${job.brandId}:`, { err: e });
        }
        try {
          await refreshStockMovement(job.brandId);
        } catch (e) {
          logger.warn(`[OpenCartJob] stock movement refresh failed for ${job.brandId}:`, { err: e });
        }
        try {
          const piResult = await refreshProductIntelligenceAggregate(job.brandId);
          logger.info(
            `[OpenCartJob] Product intelligence refreshed for ${job.brandId}: totalCount=${piResult.totalCount ?? 0}`
          );
        } catch (e) {
          logger.warn(`[OpenCartJob] product intelligence refresh failed for ${job.brandId}:`, { err: e });
        }
      }

      await jobRef.update({
        status: result.complete
          ? (result.success ? 'completed' : 'failed')
          : 'pending',
        batchesRun: result.batchesRun,
        totalImported: result.totalImported,
        ...(result.message ? { lastBatchMessage: result.message } : { lastBatchMessage: FieldValue.delete() }),
        result,
        ...(result.complete
          ? { completedAt: FieldValue.serverTimestamp() }
          : { completedAt: FieldValue.delete() }),
        updatedAt: FieldValue.serverTimestamp(),
        ...(result.error ? { error: result.error } : { error: FieldValue.delete() }),
      });
      logger.info(`[OpenCartJob] Batch finished for ${job.brandId}: ${JSON.stringify(result)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[OpenCartJob] failed for ${job.brandId}: ${msg}`, { alertKey: ALERT.syncJobProcessingFailed, err });
      await jobRef.update({
        status: 'pending',
        error: msg,
        updatedAt: FieldValue.serverTimestamp(),
      });
    }
  })
);

/** Clear resumable catalog state so a brand isn't livelocked in processing-only mode
 * (productCatalogComplete=true) after a failure/timeout; best-effort, next sync re-ingests fresh. */
async function resetMegaventoryResumableState(db: admin.firestore.Firestore, brandId: string): Promise<void> {
  try {
    await db.doc(`connectors/${brandId}`).update({
      'megaventory.ingestionComplete': FieldValue.delete(),
      'megaventory.productCatalogComplete': FieldValue.delete(),
      'megaventory.productCatalogCursor': FieldValue.delete(),
      'megaventory.processingStage': FieldValue.delete(),
      // Clear per-cycle ancillary done flags so a failed pass re-ingests them. manualInvoiceCursor/
      // Complete are NOT reset — resume-friendly, so a retry continues the invoice walk from checkpoint.
      'megaventory.ordersIngestComplete': FieldValue.delete(),
      'megaventory.stockIngestComplete': FieldValue.delete(),
      'megaventory.suppliersIngestComplete': FieldValue.delete(),
      // deleted-scan: the complete-flag is per-cycle, but the CURSOR survives (resume-friendly like
      // the invoice walk — the first 133k-product backlog import should not restart from scratch).
      'megaventory.deletedScanComplete': FieldValue.delete(),
    });
  } catch (e) {
    logger.warn(`[MegaventoryJob] could not reset resumable state for ${brandId}`, { err: e });
  }
}

export const processMegaventorySyncJobs = onSchedule(
  {
    schedule: 'every 1 minutes',
    region: 'europe-west1',
    timeoutSeconds: 1800, // onSchedule hard cap is 1800s (30min). Completing >30min brands relies on the budget+continuation below (re-enqueued across passes), not a longer single run.
    memory: '4GiB', // prod-scale: post-ingestion custom-report/procurement normalization OOM'd at 2GiB after the heavy stages now run to completion.
    cpu: 2, // more I/O concurrency for the heavy Firestore read/write stages (stock-filter recompute, gap-fill); the 30-min cap is worked around by the per-stage checkpointing, not raw speed.
    secrets: ['CONNECTOR_TOKEN_KEY'],
  },
  async () => runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
    const db = admin.firestore();
    // > the 1800s (30min) run ceiling so the stale-sweep can't mark a legitimately-running job failed mid-flight.
    const STALE_RUNNING_MS = 40 * 60 * 1000;

    const staleRunning = await db
      .collection('connector_sync_jobs')
      .where('provider', '==', 'megaventory')
      .where('status', '==', 'running')
      .limit(5)
      .get();
    for (const doc of staleRunning.docs) {
      const data = doc.data();
      const updatedAt = data.updatedAt?.toDate?.() as Date | undefined;
      if (!updatedAt || Date.now() - updatedAt.getTime() <= STALE_RUNNING_MS) continue;
      // ≥40min stale ⇒ past the 30min hard cap ⇒ the pass is definitely dead (no concurrent writer).
      // Resume it from checkpoints (catalog-complete + invoice/deleted cursors persist) instead of
      // failing outright; bounded by MAX_STALE_RESUMES so a genuinely-stuck brand can't livelock.
      const staleResumes = Number(data.staleRecoveryAttempts ?? 0);
      const recovery = decideStaleRecovery(staleResumes);
      if (recovery.action === 'resume') {
        logger.warn(`[MegaventoryJob] Stale running job ${doc.id} → re-enqueue to resume from checkpoint (${staleResumes + 1}/${MAX_STALE_RESUMES})`);
        await doc.ref.update({
          status: 'pending',
          claimToken: FieldValue.delete(),
          staleRecoveryAttempts: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          continuationAttempts: FieldValue.delete(),
        });
        continue;
      }
      // Never inherit a prior pass's result.success (that masked failures and livelocked the brand).
      logger.warn(`[MegaventoryJob] Recovering stale running job ${doc.id} → failed (timed out, ${staleResumes} resumes exhausted)`);
      await doc.ref.update({
        status: recovery.status,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        error: recovery.error,
        continuationAttempts: FieldValue.delete(),
        staleRecoveryAttempts: FieldValue.delete(),
      });
      if (recovery.resetCatalogState && typeof data.brandId === 'string') {
        await resetMegaventoryResumableState(db, data.brandId);
      }
    }

    const snap = await db
      .collection('connector_sync_jobs')
      .where('provider', '==', 'megaventory')
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (snap.empty) return;

    const jobRef = snap.docs[0].ref;
    // Zombie-finalization guard: each claim gets a unique token; a pass may finalize only while its
    // token still matches, so an outlived invocation can't overwrite a sweep/re-claim's state.
    const claimToken = randomUUID();
    const job = await db.runTransaction(async (tx) => {
      const latest = await tx.get(jobRef);
      const data = latest.data() as { brandId?: string; status?: string; continuationAttempts?: number; mode?: string; filterStage?: string; refreshVelocity?: boolean } | undefined;
      if (!latest.exists || data?.status !== 'pending' || !data.brandId) return null;
      tx.update(jobRef, {
        status: 'running',
        claimToken,
        startedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { brandId: data.brandId, continuationAttempts: Number(data.continuationAttempts ?? 0), mode: data.mode, filterStage: data.filterStage, refreshVelocity: Boolean(data.refreshVelocity) };
    });

    if (!job) return;

    /** Apply a terminal/continuation patch only if this pass still owns the job. */
    const updateJobIfOwned = async (
      patch: admin.firestore.UpdateData<admin.firestore.DocumentData>
    ): Promise<boolean> =>
      db.runTransaction(async (tx) => {
        const latest = await tx.get(jobRef);
        const data = latest.data() as { status?: string; claimToken?: string } | undefined;
        if (!latest.exists || !isJobWriteOwned({ currentStatus: data?.status, currentClaimToken: data?.claimToken, claimToken })) {
          return false;
        }
        tx.update(jobRef, patch);
        return true;
      });

    try {
      // post_refresh_only: the nightly ERP wave hands PI refresh here (a ~220k-SKU aggregate takes
      // 7–11 min and overran the 1800s cap inline). No sync work in this mode.
      if (job.mode === 'post_refresh_only') {
        logger.info(`[MegaventoryJob] Post-refresh-only job for ${job.brandId} (nightly wave handoff)`);
        let piError: string | null = null;
        try {
          if (job.refreshVelocity) {
            // Refresh all-channel ERP velocity windows before the rebuild (no-op for non-Megaventory
            // brands); non-fatal so a velocity hiccup never blocks the PI rebuild. Runs here, in the
            // worker's own budget, instead of inline in scheduledProductIntelligence's 20-min loop.
            await computeErpSkuVelocity(job.brandId).catch((e) =>
              logger.warn(`[MegaventoryJob] erp velocity failed for ${job.brandId} (non-fatal):`, { err: e }),
            );
          }
          const piResult = await refreshProductIntelligenceAggregate(job.brandId);
          logger.info(
            `[MegaventoryJob] Product intelligence refreshed for ${job.brandId}: totalCount=${piResult.totalCount ?? 0}`
          );
          // PER-157: rebuild the marketing_plan_insight aggregate now that products + signals have
          // settled. Non-fatal — a marketing-plan hiccup must never fail the PI handoff; the page
          // falls back to local compute when the doc is stale.
          await refreshMarketingPlanInsightAggregate(job.brandId).catch((e) =>
            logger.warn(`[MegaventoryJob] marketing_plan_insight refresh failed for ${job.brandId} (non-fatal):`, { err: e }),
          );
        } catch (e) {
          piError = e instanceof Error ? e.message : String(e);
          logger.warnAlert(`[MegaventoryJob] post-refresh-only PI refresh failed for ${job.brandId}:`, { alertKey: ALERT.syncJobProcessingFailed, err: e });
        }
        // No resetMegaventoryResumableState here even on failure — no catalog state was touched.
        const finalized = await updateJobIfOwned({
          status: piError ? 'failed' : 'completed',
          claimToken: FieldValue.delete(),
          result: { success: !piError, postRefreshOnly: true },
          error: piError ?? FieldValue.delete(),
          completedAt: FieldValue.serverTimestamp(),
          postRefreshCompletedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          continuationAttempts: FieldValue.delete(),
        });
        if (!finalized) {
          logger.warn(`[MegaventoryJob] ${job.brandId} lost post-refresh-only job ownership before finalization — keeping the sweep's verdict`);
        }
        return;
      }

      // stock_filter_recompute: a warehouse-filter change. Re-derive per-product totals from the
      // already-synced megaventory_stock (no ERP re-fetch), CHECKPOINTED across passes
      // (totals → gapfill → finalize) so no single sub-stage hits the 30-min onSchedule cap on large
      // brands (e.g. e-tennis ~88k SKUs / ~350k stock rows). Falls back to a normal sync if stock was
      // never synced for this brand.
      if (job.mode === 'stock_filter_recompute') {
        const stockSynced = await admin.firestore().collection('megaventory_stock').where('brandId', '==', job.brandId).limit(1).get();
        if (stockSynced.empty) {
          logger.warn(`[MegaventoryJob] stock_filter_recompute for ${job.brandId} but no megaventory_stock — falling back to full sync`);
          // fall through to the normal fetchMegaventoryData path below
        } else {
          const stage = job.filterStage || 'totals';
          logger.info(`[MegaventoryJob] Stock-filter recompute for ${job.brandId} — stage=${stage}`);
          // Each pass does ONE heavy step then re-enqueues the next, so the scheduler resumes it next
          // minute — keeping every pass well inside the 30-min cap.
          const advance = (next: string) => updateJobIfOwned({
            status: 'pending', filterStage: next, claimToken: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(), continuationAttempts: FieldValue.delete(),
          });
          try {
            if (stage === 'totals') {
              await recomputeMegaventoryProductTotals(job.brandId);
              if (!(await advance('gapfill'))) logger.warn(`[MegaventoryJob] ${job.brandId} lost ownership after stock-filter 'totals'`);
              return;
            }
            if (stage === 'gapfill') {
              await mergeMegaventoryApiCatalogProducts(admin.firestore(), job.brandId, []);
              if (!(await advance('finalize'))) logger.warn(`[MegaventoryJob] ${job.brandId} lost ownership after stock-filter 'gapfill'`);
              return;
            }
            // stage === 'finalize'
            await computeEcommerceSummary(job.brandId);
            await refreshProductIntelligenceAggregate(job.brandId);
            const finalized = await updateJobIfOwned({
              status: 'completed', filterStage: FieldValue.delete(), claimToken: FieldValue.delete(),
              result: { success: true, stockFilterRecompute: true },
              error: FieldValue.delete(), completedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(), continuationAttempts: FieldValue.delete(),
            });
            if (!finalized) logger.warn(`[MegaventoryJob] ${job.brandId} lost ownership before stock-filter finalization`);
            return;
          } catch (e) {
            const recErr = e instanceof Error ? e.message : String(e);
            logger.warnAlert(`[MegaventoryJob] stock-filter recompute (${stage}) failed for ${job.brandId}: ${recErr}`, { alertKey: ALERT.syncJobProcessingFailed });
            await updateJobIfOwned({
              status: 'failed', filterStage: FieldValue.delete(), claimToken: FieldValue.delete(),
              result: { success: false, stockFilterRecompute: true, stage }, error: recErr,
              completedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
              continuationAttempts: FieldValue.delete(),
            });
            return;
          }
        }
      }

      logger.info(`[MegaventoryJob] Starting Megaventory refresh for ${job.brandId}`);
      const result = await fetchMegaventoryData(job.brandId, { mode: 'manual' });
      // Soft-budget exhausted before finishing → re-enqueue for the every-1-min scheduler to
      // continue. Bounded to avoid livelock; post-steps below are skipped until the sync completes.
      const MAX_CONTINUATIONS = 8;
      if (result.success && result.needsContinuation && job.continuationAttempts < MAX_CONTINUATIONS) {
        const reEnqueued = await updateJobIfOwned({
          status: 'pending',
          claimToken: FieldValue.delete(),
          continuationAttempts: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
          result,
        });
        if (!reEnqueued) {
          logger.warn(`[MegaventoryJob] ${job.brandId} lost job ownership before continuation re-enqueue (stale-swept or re-claimed) — skipping`);
          return;
        }
        logger.info(`[MegaventoryJob] ${job.brandId} needs continuation (pass ${job.continuationAttempts + 1}/${MAX_CONTINUATIONS}) — re-enqueued`);
        return;
      }
      const completedClean = result.success && !result.needsContinuation;
      const finalized = await updateJobIfOwned({
        status: completedClean ? 'completed' : 'failed',
        claimToken: FieldValue.delete(),
        result,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        continuationAttempts: FieldValue.delete(),
        staleRecoveryAttempts: FieldValue.delete(),
        ...(completedClean
          ? { error: FieldValue.delete() }
          : { error: result.error || `Sync did not complete within ${MAX_CONTINUATIONS} continuation passes` }),
      });
      if (!finalized) {
        // The stale sweep (or a newer claim) took the job from us — its verdict stands. Skip the
        // post-steps too: a newer pass owns the brand now and will refresh aggregates itself.
        logger.warn(`[MegaventoryJob] ${job.brandId} lost job ownership before finalization (stale-swept or re-claimed) — keeping the sweep's verdict`);
        return;
      }
      logger.info(`[MegaventoryJob] Completed catalog refresh for ${job.brandId}: ${JSON.stringify(result)}`);

      try {
        await computeEcommerceSummary(job.brandId);
      } catch (e) {
        logger.warn(`[MegaventoryJob] ecommerce summary refresh failed for ${job.brandId}:`, { err: e });
      }
      if (result.success) {
        try {
          const piResult = await refreshProductIntelligenceAggregate(job.brandId);
          logger.info(
            `[MegaventoryJob] Product intelligence refreshed for ${job.brandId}: totalCount=${piResult.totalCount ?? 0}`
          );
        } catch (e) {
          logger.warn(`[MegaventoryJob] product intelligence refresh failed for ${job.brandId}:`, { err: e });
        }
      }
      await jobRef.update({
        postRefreshCompletedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[MegaventoryJob] failed for ${job.brandId}: ${msg}`, { alertKey: ALERT.syncJobProcessingFailed, err });
      const failedWritten = await updateJobIfOwned({
        status: 'failed',
        claimToken: FieldValue.delete(),
        error: msg,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        continuationAttempts: FieldValue.delete(),
      });
      if (failedWritten) {
        // Clear resumable state on failure so the brand re-ingests fresh next time
        // instead of being stuck with productCatalogComplete=true.
        await resetMegaventoryResumableState(db, job.brandId);
      } else {
        // Stale-swept (which already reset the state) or re-claimed by a newer pass — don't stomp
        // the newer pass's status/resumable state from a zombie error handler.
        logger.warn(`[MegaventoryJob] ${job.brandId} lost job ownership before failure write — skipping state reset`);
      }
    }
  })
);

// ─── Connector: Save Credentials (WooCommerce) ────────────────

/** POST /connectorSaveCredentials — Body: { brandId, provider, ...provider-specific credentials }. */
export const connectorSaveCredentials = onRequest(
  { region: 'europe-west1', secrets: ['CONNECTOR_TOKEN_KEY'], ...OPENCART_EGRESS_OPTIONS },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);

      await runWithLogContext({ uid: decoded.uid, requestId: getRequestId(req) }, async () => {
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
        const {
          clientId,
          clientSecret,
          token,
          username,
          password,
        } = req.body as {
          clientId?: string;
          clientSecret?: string;
          token?: string;
          username?: string;
          password?: string;
        };
        const hasOAuthCredentials = Boolean(clientId && clientSecret && token && username && password);
        if (!storeUrl || !hasOAuthCredentials) {
          res.status(400).json({ error: 'Missing OpenCart credentials' });
          return;
        }
        const result = await saveOpenCartCredentials(brandId, storeUrl, {
          clientId,
          clientSecret,
          token,
          username,
          password,
        });
        if (result.success) {
          const jobId = `opencart_${brandId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
          await admin.firestore().collection('connector_sync_jobs').doc(jobId).set({
            brandId,
            provider: 'opencart',
            status: 'pending',
            requestedBy: decoded.uid,
            requestedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            mode: 'initial_backfill',
            batchesRun: 0,
            totalImported: 0,
          }, { merge: true });
        }
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
        const { apiKey: mvKey, megaventorySettingsOnly, customReportId, customReportEnabled, stockLocations, stockLocationLabels } = req.body as {
          apiKey?: string;
          megaventorySettingsOnly?: boolean;
          customReportId?: string;
          customReportEnabled?: boolean;
          stockLocations?: string[];
          stockLocationLabels?: string[];
        };
        if (megaventorySettingsOnly) {
          const updated = await updateMegaventoryConnectorSettings(brandId, {
            customReportId: customReportId !== undefined ? customReportId : undefined,
            customReportEnabled: customReportEnabled !== undefined ? customReportEnabled : undefined,
            stockLocations: stockLocations !== undefined ? stockLocations : undefined,
            stockLocationLabels: stockLocationLabels !== undefined ? stockLocationLabels : undefined,
          });
          if (!updated.ok) {
            res.status(400).json({ success: false, error: updated.error || 'Αποτυχία ενημέρωσης' });
            return;
          }
          let recomputeQueued = false;
          if (updated.stockLocationsChanged) {
            // The warehouse filter only changes the per-product roll-up — the per-location data is
            // already in megaventory_stock. Enqueue a LIGHT recompute (no ERP re-ingest): re-derive
            // totals from megaventory_stock → gap-fill → summary → PI. Minutes, not a full re-sync.
            const jobId = `megaventory_${brandId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
            await admin.firestore().collection('connector_sync_jobs').doc(jobId).set({
              brandId,
              provider,
              status: 'pending',
              requestedBy: decoded.uid,
              requestedAt: FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
              mode: 'stock_filter_recompute',
            }, { merge: true });
            recomputeQueued = true;
          }
          res.status(200).json({ success: true, recomputeQueued });
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
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Request failed:', { alertKey: ALERT.connectorSaveCredentialsFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ─── Magento: Import Admin Search Terms ─────────────────────────

/** POST /importMagentoSearchTerms — Body: { brandId, terms: [{ term, hits, results? }], uploadedFileName? }. */
export const importMagentoSearchTerms = onRequest(
  { region: 'europe-west1' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      const decoded = await admin.auth().verifyIdToken(idToken);
      await runWithLogContext({ uid: decoded.uid, requestId: getRequestId(req) }, async () => {
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
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[Magento] Admin search terms import failed:', { alertKey: ALERT.importMagentoSearchTermsFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
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

  // set(...,{merge}) stores dotted keys as LITERAL field names healthWatch's nested `jobs` map can't
  // see; only update() treats dots as field paths but can't create the doc → NOT_FOUND fallback.
  const ref = db.doc('system_health/nightly_jobs');
  try {
    await ref.update(patch);
  } catch (err) {
    const code = (err as { code?: number | string }).code;
    if (code !== 5 && code !== 'not-found') throw err;
    await ref.set(nestDottedKeys(patch), { merge: true });
  }
}

/** Health watchdog — reads `system_health/nightly_jobs` and alerts (Slack) any nightly job that's
 * `failed`, stuck `running`, or stale (no success in the window). Runs 08:30 Athens. */
const NIGHTLY_JOB_KEYS: NightlyJobKey[] = [
  'scheduledSyncMarketing',
  'scheduledSyncEcommerce',
  'scheduledSyncWebAnalytics',
  'scheduledSyncErp',
  'scheduledSyncFollowups',
  'scheduledAggregates',
  'scheduledAlerts',
  'scheduledDigest',
];

/** A job that hasn't succeeded in this long is considered stale (jobs run daily). */
const HEALTH_STALE_MS = 28 * 60 * 60 * 1000; // 28h — one missed daily run + slack

function tsToMillis(v: unknown): number | null {
  if (v == null) return null;
  // Firestore Timestamp (admin SDK) exposes toMillis(); guard for plain objects too.
  const anyV = v as { toMillis?: () => number; _seconds?: number; seconds?: number };
  if (typeof anyV.toMillis === 'function') return anyV.toMillis();
  const secs = anyV._seconds ?? anyV.seconds;
  if (typeof secs === 'number') return secs * 1000;
  return null;
}

export const healthWatch = onSchedule(
  { timeZone: 'Europe/Athens', region: 'europe-west1', schedule: 'every day 08:30' },
  async () =>
    runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
      const snap = await db.doc('system_health/nightly_jobs').get();
      const jobs = (snap.data()?.jobs ?? {}) as Record<
        string,
        { status?: string; lastSuccessAt?: unknown; lastFinishedAt?: unknown; lastStartedAt?: unknown; lastMessage?: string }
      >;
      const now = Date.now();
      let alerted = 0;

      for (const job of NIGHTLY_JOB_KEYS) {
        const j = jobs[job];
        if (!j) {
          // Never recorded a run — the scheduler may not have fired at all.
          logger.alert(`[HealthWatch] nightly job never ran`, {
            alertKey: ALERT.healthWatchStaleJob,
            job,
          });
          alerted++;
          continue;
        }
        const lastSuccess = tsToMillis(j.lastSuccessAt);
        const lastStarted = tsToMillis(j.lastStartedAt);
        const lastFinished = tsToMillis(j.lastFinishedAt);

        if (j.status === 'failed') {
          logger.alert(`[HealthWatch] nightly job failed`, {
            alertKey: ALERT.healthWatchStaleJob,
            job,
            lastMessage: j.lastMessage,
          });
          alerted++;
          continue;
        }
        // Stuck running: started but the finish is older than the start (or absent) — crashed/timed out.
        if (j.status === 'running' && (lastFinished == null || (lastStarted != null && lastStarted > lastFinished))) {
          logger.alert(`[HealthWatch] nightly job stuck running (no clean finish)`, {
            alertKey: ALERT.healthWatchStaleJob,
            job,
            lastMessage: j.lastMessage,
          });
          alerted++;
          continue;
        }
        // Stale: no successful run within the window.
        if (lastSuccess == null || now - lastSuccess > HEALTH_STALE_MS) {
          logger.alert(`[HealthWatch] nightly job stale (no recent success)`, {
            alertKey: ALERT.healthWatchStaleJob,
            job,
            hoursSinceSuccess: lastSuccess == null ? null : Math.round((now - lastSuccess) / 3.6e6),
          });
          alerted++;
        }
      }

      logger.info(`[HealthWatch] checked ${NIGHTLY_JOB_KEYS.length} jobs, ${alerted} alert(s)`);
    })
);

// A crashed/OOM'd rebuild leaves product_intelligence/{brandId} stranded in 'running' (table serves
// last-good but never refreshes) or 'failed' (table blanks). 35min > the rebuild functions' own
// timeout, so anything 'running' older than that is provably dead — no live writer to disturb.
const PI_STALE_RUNNING_MS = 35 * 60 * 1000;
const PI_SELF_HEAL_COOLDOWN_MS = 35 * 60 * 1000;
const PI_SELF_HEAL_MAX_ATTEMPTS = 3;

/** Enqueue a post_refresh_only PI rebuild for a brand, idempotently — skips if a job is already
 * queued/running. refreshVelocity asks the worker to refresh ERP velocity windows before the rebuild. */
async function enqueuePiRebuild(
  brandId: string,
  opts?: { refreshVelocity?: boolean; requestedBy?: string },
): Promise<boolean> {
  const jobId = `megaventory_${brandId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  const jobRef = admin.firestore().collection('connector_sync_jobs').doc(jobId);
  return admin.firestore().runTransaction(async (tx) => {
    const status = (await tx.get(jobRef)).data()?.status as string | undefined;
    if (status === 'pending' || status === 'running') return false;
    tx.set(jobRef, {
      brandId,
      provider: 'megaventory',
      status: 'pending',
      requestedBy: opts?.requestedBy ?? 'pi_watchdog',
      requestedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      mode: 'post_refresh_only',
      // Always set explicitly so a re-used job doc never inherits a stale flag from a prior enqueue.
      refreshVelocity: opts?.refreshVelocity ? true : FieldValue.delete(),
    }, { merge: true });
    return true;
  });
}

export const productIntelligenceWatchdog = onSchedule(
  { timeZone: 'Europe/Athens', region: 'europe-west1', schedule: 'every 15 minutes' },
  async () =>
    runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
      const now = Date.now();
      const snap = await db
        .collection('product_intelligence')
        .select('status', 'updatedAt', 'piSelfHealAttempts', 'piSelfHealAt')
        .get();
      let healed = 0;
      let gaveUp = 0;
      for (const doc of snap.docs) {
        const d = doc.data();
        const decision = classifyAggregateRecovery(
          {
            status: d.status as string | undefined,
            updatedAtMs: tsToMillis(d.updatedAt),
            selfHealAttempts: Number(d.piSelfHealAttempts ?? 0),
            selfHealAtMs: tsToMillis(d.piSelfHealAt),
            nowMs: now,
          },
          { staleMs: PI_STALE_RUNNING_MS, cooldownMs: PI_SELF_HEAL_COOLDOWN_MS, maxAttempts: PI_SELF_HEAL_MAX_ATTEMPTS },
        );
        if (decision === 'ok' || decision === 'cooldown') continue;
        const brandId = doc.id;
        if (decision === 'giveup') {
          logger.alert(`[PIWatchdog] ${brandId} stuck (${d.status}) — self-heal cap reached, manual intervention needed`, {
            alertKey: ALERT.productIntelligenceFailed,
            brandId,
          });
          gaveUp++;
          continue;
        }
        // decision === 'heal'
        try {
          const queued = await enqueuePiRebuild(brandId);
          await doc.ref.set(
            { piSelfHealAttempts: FieldValue.increment(1), piSelfHealAt: FieldValue.serverTimestamp() },
            { merge: true },
          );
          logger.warn(`[PIWatchdog] ${brandId} stuck (${d.status}) → ${queued ? 'enqueued PI rebuild' : 'rebuild already queued'} (attempt ${Number(d.piSelfHealAttempts ?? 0) + 1})`);
          healed++;
        } catch (err) {
          logger.warnAlert(`[PIWatchdog] failed to self-heal ${brandId}:`, { alertKey: ALERT.productIntelligenceFailed, err });
        }
      }
      logger.info(`[PIWatchdog] scanned ${snap.size} aggregates, healed=${healed}, gaveUp=${gaveUp}`);
    }),
);

/** Bounded concurrency (lighter Google API hammering during the nightly batch). */
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

/** onSchedule has a hard 1800s cap, so each connector wave gets its own invocation — Magento/ERP
 * don't cut off GA4/GSC within the same timeout as Ads. */
const SCHEDULED_SYNC_TIMEOUT_SECONDS = 1800;
/** Parallel processing of brands within a wave. */
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
              logger.warnAlert(
                `[ScheduledSync/${wave}] ${label} for ${brandId}: imported ${imported ?? 0}, error: ${result.error || 'unknown'}`,
                { alertKey: ALERT.nightlyWaveFailed }
              );
            } else {
              logger.info(`[ScheduledSync/${wave}] ${label} for ${brandId}: imported ${imported ?? '—'}`);
            }
          })
          .catch((err) => logger.error(`[ScheduledSync/${wave}] ${label} failed for ${brandId}:`, { alertKey: ALERT.nightlyWaveFailed, err }))
      );
    return { tasks, wrap };
  };

  const phase = buildTasks();
  // Set inside the erp case's then-handler (before Promise.all resolves), read after it —
  // when true, the worker owns the rest of the sync AND runs the PI refresh on completion.
  let megaventoryHandedOff = false;

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
      if (data.opencart?.connected) {
        const oc = data.opencart as Record<string, unknown>;
        if (isOpenCartInitialBackfillIncomplete(oc)) {
          ensureOpenCartBackfillJobQueued(brandId, { mode: 'nightly_backfill_resume' })
            .then((r) => {
              if (r.queued) {
                logger.info(`[ScheduledSync/ecommerce] OpenCart backfill queued for ${brandId}: ${r.reason}`);
              }
            })
            .catch((err) => logger.error(`[ScheduledSync/ecommerce] OpenCart queue failed for ${brandId}:`, { alertKey: ALERT.nightlyWaveFailed, err }));
        } else {
          phase.wrap('OpenCart', fetchOpenCartData(brandId));
        }
      }
      if (data.magento?.connected) phase.wrap('Magento', fetchMagentoData(brandId));
      break;
    case 'analytics':
      if (data.ga4?.connected && data.ga4?.propertyId) phase.wrap('GA4', fetchGA4Data(brandId));
      if (data.search_console?.connected && data.search_console?.siteUrl)
        phase.wrap('Search Console', fetchSearchConsoleData(brandId));
      break;
    case 'erp':
      if (data.megaventory?.connected)
        phase.wrap(
          'Megaventory',
          fetchMegaventoryData(brandId, { mode: 'scheduled' }).then(async (r) => {
            // Large brands return needsContinuation; the wave doesn't loop, so hand off to the
            // every-1-min processMegaventorySyncJobs worker to finish catalog + downstream same-day.
            if (r?.needsContinuation) {
              const jobId = `megaventory_${brandId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
              await admin.firestore().collection('connector_sync_jobs').doc(jobId).set({
                brandId,
                provider: 'megaventory',
                status: 'pending',
                requestedBy: 'scheduled_continuation',
                requestedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
                mode: 'scheduled_continuation',
              }, { merge: true });
              megaventoryHandedOff = true;
              logger.info(`[ScheduledSync/erp] Megaventory needs continuation for ${brandId} — handed to processMegaventorySyncJobs worker`);
            }
            return r;
          })
        );
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
      logger.error(`[ScheduledSync/erp] ecommerce_summary refresh failed for ${brandId}:`, { alertKey: ALERT.nightlyWaveFailed, err });
    }
    if (data.megaventory?.connected && !megaventoryHandedOff) {
      // Never refresh PI inline (~220k SKUs / 7–11 min overran the 1800s cap) — enqueue a
      // post_refresh_only job for the worker, unless the sync was handed off or a job is already active.
      try {
        const jobId = `megaventory_${brandId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
        const jobRef = admin.firestore().collection('connector_sync_jobs').doc(jobId);
        const queued = await admin.firestore().runTransaction(async (tx) => {
          const latest = await tx.get(jobRef);
          const status = latest.data()?.status as string | undefined;
          if (status === 'pending' || status === 'running') return false;
          tx.set(jobRef, {
            brandId,
            provider: 'megaventory',
            status: 'pending',
            requestedBy: 'scheduled_post_refresh',
            requestedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            mode: 'post_refresh_only',
          }, { merge: true });
          return true;
        });
        logger.info(
          queued
            ? `[ScheduledSync/erp] PI refresh for ${brandId} handed to processMegaventorySyncJobs worker (post_refresh_only)`
            : `[ScheduledSync/erp] PI refresh handoff for ${brandId} skipped — a megaventory job is already active`
        );
      } catch (err) {
        logger.warnAlert(`[ScheduledSync/erp] PI refresh handoff failed for ${brandId}:`, { alertKey: ALERT.nightlyWaveFailed, err });
      }
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
        logger.error(`[ScheduledSync/ecommerce] E-commerce summary failed for ${brandId}:`, { alertKey: ALERT.nightlyWaveFailed, err });
      }
    }
    const oc = data.opencart as Record<string, unknown> | undefined;
    if (data.opencart?.connected && oc && !isOpenCartInitialBackfillIncomplete(oc)) {
      try {
        await refreshStockMovement(brandId);
      } catch (err) {
        logger.warnAlert(`[ScheduledSync/ecommerce] stock movement refresh failed for ${brandId}:`, { alertKey: ALERT.nightlyWaveFailed, err });
      }
      try {
        await refreshProductIntelligenceAggregate(brandId);
      } catch (err) {
        logger.warnAlert(`[ScheduledSync/ecommerce] product intelligence refresh failed for ${brandId}:`, { alertKey: ALERT.nightlyWaveFailed, err });
      }
    }
  }
}

async function runNightlyConnectorWaveJob(wave: NightlyConnectorWave, jobKey: NightlyJobKey): Promise<void> {
  return runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
  const startedAt = Date.now();
  await markNightlyJob(jobKey, 'running', { message: `Nightly wave "${wave}" started` });
  logger.info(`[ScheduledSync] Starting "${wave}" wave`);

  try {
    const connectorsSnap = await db.collection('connectors').get();
    let failedConnectorBrands = 0;

    const concurrency = wave === 'ecommerce' ? 1 : NIGHTLY_CONNECTOR_SYNC_CONCURRENCY;
    await runPool(connectorsSnap.docs, concurrency, async (docSnap) => {
      const brandId = docSnap.id;
      const data = docSnap.data();
      try {
        await executeBrandNightlyWave(brandId, data, wave);
      } catch (err) {
        failedConnectorBrands += 1;
        logger.error(`[ScheduledSync/${wave}] Unexpected failure for ${brandId}:`, { alertKey: ALERT.nightlyWaveFailed, err });
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
    logger.error(`[ScheduledSync/${wave}] Fatal error:`, { alertKey: ALERT.nightlyWaveFailed, err: error });
    throw error;
  }
  });
}

async function runNightlyFollowupsJob(): Promise<void> {
  return runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
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
        logger.warnAlert(`[ScheduledSync/followups] Stock movement failed for ${brandId}:`, { alertKey: ALERT.nightlySyncFollowupsFailed, err });
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
          logger.error(`[ScheduledSync/followups] Competitors failed for ${brandId}:`, { alertKey: ALERT.nightlySyncFollowupsFailed, err });
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
    logger.error('[ScheduledSync/followups] Fatal error:', { alertKey: ALERT.nightlySyncFollowupsFailed, err: error });
    throw error;
  }
  });
}

const nightlyConnectorScheduleBase = {
  timeZone: 'Europe/Athens',
  region: 'europe-west1' as const,
  memory: '1GiB' as const,
  timeoutSeconds: SCHEDULED_SYNC_TIMEOUT_SECONDS,
  secrets: CONNECTOR_NIGHTLY_SECRETS,
};

// ─── Scheduled: Connector waves (morning window → "yesterday" has fully closed) ──

/** Advertising & Merchant — 05:00 */
export const scheduledSyncMarketing = onSchedule(
  { ...nightlyConnectorScheduleBase, schedule: 'every day 05:00' },
  async () => runNightlyConnectorWaveJob('marketing', 'scheduledSyncMarketing')
);

/** E-shop imports + ecommerce_summary — 05:20 */
export const scheduledSyncEcommerce = onSchedule(
  { ...nightlyConnectorScheduleBase, ...OPENCART_EGRESS_OPTIONS, schedule: 'every day 05:20', memory: '4GiB' as const, cpu: 2 },
  async () => runNightlyConnectorWaveJob('ecommerce', 'scheduledSyncEcommerce')
);

/** GA4 + Search Console — 05:40 */
export const scheduledSyncWebAnalytics = onSchedule(
  { ...nightlyConnectorScheduleBase, schedule: 'every day 05:40' },
  async () => runNightlyConnectorWaveJob('analytics', 'scheduledSyncWebAnalytics')
);

/** ERP connectors — 06:00. The 1800s cap can't be raised, so large e-shops get more RAM/CPU and
 * `megaventory.lastSyncAt` is written early (post-import) so the UI shows fresh even if post-steps lag. */
export const scheduledSyncErp = onSchedule(
  // 4GiB: the ERP wave's post-ingestion normalization/aggregation OOM'd at 2GiB (SIGABRT/signal 6),
  // mirroring the processMegaventorySyncJobs bump for the same heavy stages.
  { ...nightlyConnectorScheduleBase, schedule: 'every day 06:00', memory: '4GiB' as const, cpu: 2 },
  async () => runNightlyConnectorWaveJob('erp', 'scheduledSyncErp')
);

/** Stock / competition — 06:40 (after the 06:00 ERP wave + up to a 30min timeout) */
export const scheduledSyncFollowups = onSchedule(
  { ...nightlyConnectorScheduleBase, schedule: 'every day 06:40' },
  async () => runNightlyFollowupsJob()
);

/** Data Analysis RFM aggregate — monthly compact summary refresh; manual refresh remains available on demand. */
export const scheduledDataAnalysisRfm = onSchedule(
  { timeZone: 'Europe/Athens', region: 'europe-west1', memory: '2GiB', timeoutSeconds: 1200, schedule: '20 7 1 * *' },
  async () => runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
    const snap = await db.collection('connectors').get();
    for (const doc of snap.docs) {
      try {
        await refreshDataAnalysisRfmAggregate(doc.id);
      } catch (error) {
        logger.warnAlert(`[scheduledDataAnalysisRfm] failed for ${doc.id}:`, { alertKey: ALERT.scheduledDataAnalysisRfmFailed, err: error });
      }
    }
  })
);

/** Product Intelligence aggregate — connector-backed catalogs only; procurement/import brands keep the UI path. */
export const scheduledProductIntelligence = onSchedule(
  { timeZone: 'Europe/Athens', region: 'europe-west1', memory: '4GiB', timeoutSeconds: 1200, schedule: 'every day 07:40' },
  async () => runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
    // Hand each brand's heavy velocity + PI rebuild to the worker (its own 30-min budget, one brand
    // per claim) instead of running them inline. The old serial inline loop (~17min/brand for e-tennis)
    // overran this function's 20-min cap and stranded whichever brand was mid-rebuild, which the
    // watchdog then had to clean up every morning. Enqueuing is fast and can't time out.
    const snap = await db.collection('connectors').get();
    let enqueued = 0;
    for (const doc of snap.docs) {
      try {
        if (await enqueuePiRebuild(doc.id, { refreshVelocity: true, requestedBy: 'scheduled_pi' })) enqueued += 1;
      } catch (error) {
        logger.warnAlert(`[scheduledProductIntelligence] enqueue failed for ${doc.id}:`, { alertKey: ALERT.scheduledProductIntelligenceFailed, err: error });
      }
    }
    logger.info(`[scheduledProductIntelligence] handed ${enqueued}/${snap.docs.length} brand PI rebuilds to the worker`);
  })
);

/** POST /geminiProxy (Bearer FIREBASE_ID_TOKEN) — { systemPrompt, userPrompt, model?, temperature? }
 * → { text }. The API key stays server-side (Firebase Secret). */

/** Server-side brand-invite join (Bearer token, Body { token } → { ok, brandId, role }). Membership
 * is provisioned via Admin SDK; the invite's `role`/email are authoritative, consumed single-use. */
export const acceptInvite = onRequest(
  { region: 'europe-west1' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization header' });
      return;
    }
    let uid = '';
    let callerEmail = '';
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.slice(7));
      uid = decoded.uid;
      callerEmail = (decoded.email || '').trim().toLowerCase();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Per-user rate limit to blunt invite-token brute forcing.
    const rl = await enforceRateLimit({ key: `acceptInvite:${uid}`, limit: 20, windowSeconds: 300 });
    if (!rl.allowed) {
      sendRateLimitExceeded(res, rl.resetInSeconds, 'acceptInvite');
      return;
    }

    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      res.status(400).json({ error: 'Missing token' });
      return;
    }

    try {
      const snap = await db.collection('invites').where('token', '==', token).limit(1).get();
      if (snap.empty) {
        res.status(404).json({ error: 'Invite not found' });
        return;
      }
      const inviteRef = snap.docs[0].ref;
      const inviteData = snap.docs[0].data() as {
        brandId?: string; email?: string; role?: string; department?: string;
        usedAt?: string; expiresAt?: string;
      };
      const brandId = inviteData.brandId;
      if (!brandId) {
        res.status(400).json({ error: 'Invite missing brandId' });
        return;
      }
      if (inviteData.usedAt) {
        res.status(409).json({ error: 'Invite already used' });
        return;
      }
      if (inviteData.expiresAt && new Date(inviteData.expiresAt) < new Date()) {
        res.status(410).json({ error: 'Invite expired' });
        return;
      }
      // If the invite was addressed to a specific email, the accepting account
      // must match it — stops a leaked link being redeemed by a different user.
      const inviteEmail = (inviteData.email || '').trim().toLowerCase();
      if (inviteEmail && inviteEmail !== callerEmail) {
        logger.warn('[acceptInvite] email mismatch', { uid, brandId });
        res.status(403).json({ error: 'This invite was issued to a different email address' });
        return;
      }

      const role = inviteData.role === 'admin' ? 'admin' : 'member';
      const department = inviteData.department || 'other';
      const userRef = db.doc(`users/${uid}`);

      await db.runTransaction(async (tx) => {
        const freshInvite = await tx.get(inviteRef);
        if ((freshInvite.data() as { usedAt?: string } | undefined)?.usedAt) {
          throw new Error('ALREADY_USED');
        }
        const userSnap = await tx.get(userRef);
        const profile = (userSnap.data() as {
          brandIds?: string[]; defaultBrandId?: string; email?: string; displayName?: string;
        } | undefined) || {};
        const brandIds = Array.isArray(profile.brandIds) ? profile.brandIds : [];

        // 1. Member doc — role pinned to the invite, never caller-chosen.
        tx.set(db.doc(`brands/${brandId}/members/${uid}`), {
          userId: uid,
          email: profile.email || callerEmail || inviteEmail || '',
          displayName: profile.displayName || '',
          role,
          department,
          joinedAt: new Date().toISOString(),
        }, { merge: true });

        // 2. User profile brand membership.
        if (!brandIds.includes(brandId)) {
          tx.set(userRef, {
            id: uid,
            brandIds: [...brandIds, brandId],
            defaultBrandId: profile.defaultBrandId || brandId,
          }, { merge: true });
        }

        // 3. Consume the invite (single-use).
        tx.update(inviteRef, { usedAt: new Date().toISOString(), usedBy: uid });
      });

      res.status(200).json({ ok: true, brandId, role });
    } catch (err) {
      if (err instanceof Error && err.message === 'ALREADY_USED') {
        res.status(409).json({ error: 'Invite already used' });
        return;
      }
      logger.error('[acceptInvite] failed', { alertKey: ALERT.unkeyed, err });
      res.status(500).json({ error: 'Invite acceptance failed' });
    }
  }
);

export const geminiProxy = onRequest(
  /** 120s timeout: cold-start + slow Firestore init can eat the budget before the LLM call,
   * causing DEADLINE_EXCEEDED. */
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

    // Gate the paid Gemini key on brand membership: a pinned brandId verifies THAT brand,
    // else require any brand. Super admins always allowed. Server-only.
    try {
      const requestedBrandId =
        typeof (req.body as { brandId?: unknown })?.brandId === 'string'
          ? (req.body as { brandId: string }).brandId
          : '';
      // Profile `brandIds` is a lossy cache — trust the authoritative membership docs so a real
      // member with a stale/empty profile isn't rejected, while a brandless account stays blocked.
      let hasBrandAccess = await isUidSuperAdmin(decodedUid);
      if (!hasBrandAccess && requestedBrandId) {
        // Per-call scope: verify membership of THAT brand (real member doc / creator).
        hasBrandAccess = await verifyBrandMembership(decodedUid, requestedBrandId);
      } else if (!hasBrandAccess) {
        // Any-brand: cheap profile-cache check first, then authoritative membership docs.
        const cachedBrandIds = (await db.doc(`users/${decodedUid}`).get()).data()?.brandIds;
        hasBrandAccess =
          (Array.isArray(cachedBrandIds) && cachedBrandIds.length > 0) ||
          (await userHasAnyBrandMembership(decodedUid));
      }
      if (!hasBrandAccess) {
        res.status(403).json({
          error: requestedBrandId
            ? 'Forbidden: not a member of the requested brand'
            : 'Forbidden: account is not a member of any brand',
        });
        return;
      }
    } catch (err) {
      logger.error('[geminiProxy] brand-membership check failed', { alertKey: ALERT.unkeyed, err });
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    // Rate limit: 30 Gemini calls / 5 min per user. Fail CLOSED on this cost path — if the limiter
    // can't confirm, block rather than leave the paid key open (non-cost endpoints stay fail-open).
    const rl = await enforceRateLimit({
      key: `gemini:${decodedUid}`,
      limit: 30,
      windowSeconds: 300,
      failClosed: true,
    });
    if (!rl.allowed) {
      sendRateLimitExceeded(res, rl.resetInSeconds, 'gemini');
      return;
    }

    const ALLOWED_GEMINI_MODELS = new Set(['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']);
    const { systemPrompt: rawSystemPrompt, userPrompt: rawUserPrompt, model: rawModel = 'gemini-2.5-pro', temperature = 0, history, brandId } = req.body as {
      systemPrompt?: string;
      userPrompt?: string;
      model?: string;
      temperature?: number;
      /** Optional conversation history (multi-turn). The API requires the sequence to start with 'user'. */
      history?: Array<{ role?: string; text?: string }>;
      /** For per-brand cost accounting (ai_usage). */
      brandId?: string;
    };

    if (!rawUserPrompt) {
      res.status(400).json({ error: 'Missing userPrompt' });
      return;
    }

    const safeModel = ALLOWED_GEMINI_MODELS.has(rawModel) ? rawModel : 'gemini-2.5-pro';
    const userPrompt = String(rawUserPrompt).slice(0, 32000);
    const systemPrompt = rawSystemPrompt ? String(rawSystemPrompt).slice(0, 8000) : undefined;

    try {
      const apiKey = GEMINI_SECRET.value();
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({
        model: safeModel,
        ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
        generationConfig: { temperature },
      });

      // Multi-turn: build contents from the history + the current message.
      const cleanedHistory = Array.isArray(history)
        ? history
            .filter(
              (h): h is { role: 'user' | 'model'; text: string } =>
                !!h &&
                typeof h.text === 'string' &&
                h.text.trim().length > 0 &&
                (h.role === 'user' || h.role === 'model')
            )
            .map((h) => ({ role: h.role, parts: [{ text: h.text }] }))
        : [];
      // Gemini requires the first content to have role 'user' — strip leading 'model' turns
      // (e.g. Mark's proactive welcome).
      while (cleanedHistory.length > 0 && cleanedHistory[0].role === 'model') cleanedHistory.shift();

      const result =
        cleanedHistory.length > 0
          ? await geminiModel.generateContent({
              contents: [...cleanedHistory, { role: 'user', parts: [{ text: userPrompt }] }],
            })
          : await geminiModel.generateContent(userPrompt);
      const text = result.response.text();

      // Token/cost logging (per user + brand) — fills the AI_COST_MODEL gap.
      try {
        const usage = result.response.usageMetadata;
        if (usage) {
          await db.collection('ai_usage').add({
            uid: decodedUid,
            brandId: typeof brandId === 'string' && brandId ? brandId : null,
            model: safeModel,
            promptTokens: usage.promptTokenCount ?? null,
            candidatesTokens: usage.candidatesTokenCount ?? null,
            totalTokens: usage.totalTokenCount ?? null,
            multiTurn: cleanedHistory.length > 0,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
      } catch (logErr) {
        logger.warn('[geminiProxy] usage log failed:', { err: logErr });
      }

      res.status(200).json({ text });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('[geminiProxy] Gemini error:', { alertKey: ALERT.unkeyed, err: error });
      res.status(500).json({ error: 'AI request failed — please try again' });
    }
  }
);

// Web Search Proxy (AI Assistant): server-side DuckDuckGo Instant Answer lookup so the CSP isn't
// loosened. Upstream host fixed (no SSRF; only the query param is caller-controlled); auth-gated + rate-limited.
export const webSearch = onRequest(
  { region: 'europe-west1', timeoutSeconds: 30, memory: '256MiB' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }
    let uid = '';
    try {
      uid = (await admin.auth().verifyIdToken(authHeader.slice(7).trim())).uid;
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // 60 searches / 5 min per user — prevents abuse of the proxy egress.
    const rl = await enforceRateLimit({ key: `webSearch:${uid}`, limit: 60, windowSeconds: 300 });
    if (!rl.allowed) { sendRateLimitExceeded(res, rl.resetInSeconds, 'webSearch'); return; }

    const rawQuery = (req.body as { query?: unknown })?.query;
    const query = typeof rawQuery === 'string' ? rawQuery.trim().slice(0, 500) : '';
    if (!query) { res.status(400).json({ error: 'Missing query' }); return; }

    try {
      // Fixed upstream host — only the URL-encoded query varies, so no SSRF surface.
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const ddg = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!ddg.ok) { res.status(502).json({ error: 'Upstream search failed' }); return; }
      const data = await ddg.json();
      // Return the raw DuckDuckGo payload — the client parses it unchanged.
      res.status(200).json(data);
    } catch (err) {
      logger.error('[webSearch] upstream error:', { alertKey: ALERT.unkeyed, err });
      res.status(502).json({ error: 'Search unavailable' });
    }
  }
);

// ── Email Notification Endpoint ─────────────────────────────────────────────

export const sendEmailNotification = onRequest(
  { region: 'europe-west1', secrets: [SMTP_EMAIL_SECRET, SMTP_PASSWORD_SECRET] },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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
    if (userIds.length > 100) {
      res.status(400).json({ error: 'Max 100 recipients per request' });
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
  { region: 'europe-west1', secrets: [SMTP_EMAIL_SECRET, SMTP_PASSWORD_SECRET] },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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
      logger.warn('[sendInviteEmail] invite lookup failed', { err });
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
      logger.error('Failed to send invite email:', { alertKey: ALERT.emailSendFailed, err });
      res.status(500).json({ ok: false, error: 'Email send failed' });
    }
  }
);

// ── Aggregate Stats: On-Demand (callable) ───────────────────────────────────

export const refreshAggregates = onRequest(
  // 4GiB: the ~220k-SKU Product Intelligence aggregate OOM'd at 2GiB (SIGABRT/signal 6).
  { region: 'europe-west1', timeoutSeconds: 540, memory: '4GiB', secrets: ['CONNECTOR_TOKEN_KEY'] },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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
      // Refresh e-commerce summary (skuStats, revenueByDay, topProducts) — without re-syncing platforms.
      try {
        await computeEcommerceSummary(brandId);
      } catch (e) {
        logger.warn('[refreshAggregates] ecommerce summary refresh failed (non-fatal):', { err: e });
      }
      // Stock movement: capture today's snapshot + recompute deltas (universal)
      try {
        await refreshStockMovement(brandId);
      } catch (e) {
        logger.warn('[refreshAggregates] stock movement refresh failed (non-fatal):', { err: e });
      }
      // Procurement signals: re-aggregate (status, tied capital, margin, lifetime, etc.)
      try {
        await refreshProcurementSignals(brandId);
      } catch (e) {
        logger.warn('[refreshAggregates] procurement signals refresh failed (non-fatal):', { err: e });
      }
      res.status(200).json({ success: true, brandId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[refreshAggregates]', { alertKey: ALERT.aggregateStatsFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── Data Analysis RFM: Diagnostic + On-Demand Aggregate ─────────────────────

export const refreshDataAnalysisRfm = onRequest(
  { region: 'europe-west1', timeoutSeconds: 1200, memory: '2GiB' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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
      logger.error('[refreshDataAnalysisRfm]', { alertKey: ALERT.dataAnalysisRfmFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export const refreshProductIntelligence = onRequest(
  { region: 'europe-west1', timeoutSeconds: 1200, memory: '4GiB' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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

      logger.info(`[refreshProductIntelligence] brandId=${brandId} uid=${decoded.uid}`);
      const result = await refreshProductIntelligenceAggregate(brandId);
      res.status(200).json({ success: true, brandId, result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('[refreshProductIntelligence]', { alertKey: ALERT.productIntelligenceFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/** POST /refreshErpVelocity (Bearer FIREBASE_ID_TOKEN) — { brandId } → recompute all-channel ERP
 * per-SKU velocity (erp_sku_velocity). Standalone + heavy (streams full invoice history), kept off the
 * synchronous refreshAggregates path; run before refreshProductIntelligence to refresh the overlay. */
export const refreshErpVelocity = onRequest(
  { region: 'europe-west1', timeoutSeconds: 1200, memory: '2GiB' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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

      logger.info(`[refreshErpVelocity] brandId=${brandId} uid=${decoded.uid}`);
      await computeErpSkuVelocity(brandId);
      res.status(200).json({ success: true, brandId });
    } catch (error) {
      logger.error('[refreshErpVelocity]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export const queryProductIntelligence = onRequest(
  // 2GiB: at 1GiB the dashboard query GC-stalled on large brands (e-tennis), surfacing as Firestore
  // DEADLINE_EXCEEDED on the read; the heavy PI writers already run at 4GiB.
  { region: 'europe-west1', timeoutSeconds: 120, memory: '2GiB' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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
      logger.error('[queryProductIntelligence]', { alertKey: ALERT.productIntelligenceFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/** On-demand warehouse list for the Megaventory stock-filter settings UI (no prior sync required). */
export const megaventoryListLocations = onRequest(
  { region: 'europe-west1', timeoutSeconds: 60, memory: '256MiB', secrets: ['CONNECTOR_TOKEN_KEY'] },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    let uid: string;
    try {
      uid = (await admin.auth().verifyIdToken(authHeader.slice(7).trim())).uid;
    } catch {
      // Invalid/expired token is a normal client occurrence — 401, never an alertable error.
      res.status(401).json({ error: 'Invalid auth' });
      return;
    }
    try {
      const { brandId } = req.body as { brandId?: string };
      if (!brandId) { res.status(400).json({ error: 'Missing brandId' }); return; }

      if (!(await verifyBrandMembership(uid, brandId))) {
        res.status(403).json({ error: 'Δεν υπάρχει πρόσβαση στο brand' });
        return;
      }

      const result = await listMegaventoryLocations(brandId);
      if (!result.ok) { res.status(400).json({ error: result.error || 'Αποτυχία φόρτωσης αποθηκών' }); return; }
      res.status(200).json({ success: true, locations: result.locations });
    } catch (error) {
      // A warehouse-list fetch failing only degrades the settings panel — warn (non-alerting), not error.
      logger.warn('[megaventoryListLocations] failed', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

export const refreshCompetitiveInventory = onRequest(
  { region: 'europe-west1', timeoutSeconds: 1200, memory: '2GiB' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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
      logger.error('[refreshCompetitiveInventory]', { alertKey: ALERT.competitorMonitorFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── Stock Movement: Manual Capture (callable) ───────────────────────────────

/** POST /captureStock — Body: { brandId }. Captures today's stock snapshot and computes deltas
 * (7d/30d/90d); works for any brand (connector or import-only). */
export const captureStock = onRequest(
  { region: 'europe-west1', timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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
      logger.error('[captureStock]', { alertKey: ALERT.stockMovementTrackFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── Procurement Signals: Manual Refresh (after upload) ─────────────────────

/** POST /refreshSignals — Body: { brandId }. Re-aggregates procurement_inventory + pricing_policy +
 * fiscal_year + item_evaluation into procurement_signals/{brandId}.skuSignalsJson after upload. */
export const refreshSignals = onRequest(
  { region: 'europe-west1', timeoutSeconds: 120, memory: '512MiB' },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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
      logger.error('[refreshSignals]', { alertKey: ALERT.procurementSignalsFailed, err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/** POST /refreshMarketingPlanInsight — Body: { brandId }. Rebuilds marketing_plan_insight/{brandId}
 * (all presets) server-side so the Marketing Plan page reads a compact doc instead of loading the
 * ~222k-product catalog (PER-157). 4GiB: streams the projected catalog + runs the insight 6×. */
export const refreshMarketingPlanInsight = onRequest(
  // 4GiB to match the heavy aggregators: the build holds the ~222k-product array + a per-preset
  // name-bridge index, and the global NODE_OPTIONS=--max-old-space-size=3072 needs a >3GiB container
  // (1GiB OOM'd at 1078MiB on e-tennis). Same heap home as the nightly PI worker.
  { region: 'europe-west1', timeoutSeconds: 540, memory: '4GiB', cpu: 2 },
  async (req, res) => {
    if (applyStrictCors(req, res)) return;
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

      const result = await refreshMarketingPlanInsightAggregate(brandId);
      res.status(200).json({ success: true, ...result });
    } catch (error) {
      logger.error('[refreshMarketingPlanInsight]', { err: error });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// ── Aggregate Stats (after the morning connector waves and follow-ups ~06:40) ────────

export const scheduledAggregates = onSchedule(
  {
    schedule: 'every day 07:00',
    timeZone: 'Europe/Athens',
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async () => runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
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
      logger.error('[scheduledAggregates] Fatal error:', { alertKey: ALERT.nightlyAggregatesFailed, err: error });
      throw error;
    }
  })
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
  async () => runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
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
      logger.error('[scheduledAlerts] Fatal error:', { alertKey: ALERT.scheduledAlertsFailed, err: error });
      throw error;
    }
  })
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
  async () => runWithLogContext({ uid: null, requestId: getRequestId() }, async () => {
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
      logger.error('[scheduledDigest] Fatal error:', { alertKey: ALERT.scheduledDigestFailed, err: error });
      throw error;
    }
  })
);

// ── Public: interest lead submission (landing, no auth) ─────────────────────

export const submitInterestLead = onRequest(
  { region: 'europe-west1', secrets: [SMTP_EMAIL_SECRET, SMTP_PASSWORD_SECRET] },
  async (req, res) => {
    // Strict CORS (whitelisted origins only) — prevents scraping/abuse from arbitrary domains
    if (applyStrictCors(req, res)) return;
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'POST only' });
      return;
    }

    // Rate limit: 5 submissions / 15 min per IP — prevents spam submissions
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
      logger.error('[submitInterestLead]', { alertKey: ALERT.interestLeadFailed, err: e });
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
