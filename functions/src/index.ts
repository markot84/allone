import * as admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Busboy from 'busboy';

const GEMINI_SECRET = defineSecret('GEMINI_API_KEY');
import { parseCSV, parseXLSXBuffer, parseXLSXAllSheets, csvToObjects } from './parseFile';
import { validateProduct, type ProductData } from './validateProduct';
import { validateCampaign, type CampaignData } from './validateCampaign';
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

admin.initializeApp();
const db = getFirestore();
setMetaDb(db);
setGoogleAdsDb(db);
setEmailDb(db);
setMerchantDb(db);
setCompetitorDb(db);

const BATCH_SIZE = 500;

type ImportType = 'products' | 'campaigns' | 'segments' | 'procurement';

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
 * Body: { brandId, provider: "google_ads" | "meta", redirectUri }
 * Returns: { authUrl }
 */
export const connectorAuth = onRequest(
  { region: 'europe-west1', cors: true, secrets: ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      await admin.auth().verifyIdToken(idToken);

      const { brandId, provider, redirectUri } = req.body as {
        brandId?: string; provider?: string; redirectUri?: string;
      };

      if (!brandId || !provider || !redirectUri) {
        res.status(400).json({ error: 'Missing brandId, provider, or redirectUri' });
        return;
      }

      let authUrl: string;
      if (provider === 'google_ads') {
        authUrl = getGoogleAdsAuthUrl(brandId, redirectUri);
      } else if (provider === 'meta') {
        authUrl = getMetaAuthUrl(brandId, redirectUri);
      } else if (provider === 'merchant') {
        authUrl = getMerchantAuthUrl(brandId, redirectUri);
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
  { region: 'europe-west1', cors: true, secrets: ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'] },
  async (req, res) => {
    const { code, state } = req.query as { code?: string; state?: string };

    if (!code || !state) {
      res.status(400).send('Missing code or state parameter');
      return;
    }

    try {
      const { brandId, provider, redirectUri } = JSON.parse(
        Buffer.from(state, 'base64url').toString()
      );

      if (!redirectUri) {
        res.status(400).send('Missing redirectUri in state');
        return;
      }

      let result: { success: boolean; error?: string };

      if (provider === 'google_ads') {
        result = await handleGoogleAdsCallback(code, brandId, redirectUri);
      } else if (provider === 'meta') {
        const metaResult = await handleMetaCallback(code, redirectUri);
        if (metaResult.success && metaResult.data) {
          const { accessToken, expiresIn, availableAccounts, needsSelection } = metaResult.data;
          await db.doc(`connectors/${brandId}`).set(
            {
              meta: {
                connected: !needsSelection,
                pendingAccountSelection: needsSelection,
                accessToken,
                expiresAt: Date.now() + expiresIn * 1000,
                availableAccounts,
                adAccountIds: needsSelection ? [] : availableAccounts.map((a) => a.id),
                adAccountNames: needsSelection ? [] : availableAccounts.map((a) => a.name),
                connectedAt: FieldValue.serverTimestamp(),
              },
            },
            { merge: true }
          );
          logger.info(`[Meta] Saved to Firestore for brand ${brandId}`);
          result = { success: true };
        } else {
          result = { success: false, error: metaResult.error };
        }
      } else if (provider === 'merchant') {
        result = await handleMerchantCallback(code, brandId, redirectUri);
      } else {
        res.status(400).send(`Unknown provider: ${provider}`);
        return;
      }

      if (result.success) {
        // Redirect back to the app with success
        res.redirect(`https://www.performanceplus.gr/#data?connector=${provider}&status=success`);
      } else {
        res.redirect(`https://www.performanceplus.gr/#data?connector=${provider}&status=error&message=${encodeURIComponent(result.error || 'Unknown error')}`);
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
      await admin.auth().verifyIdToken(idToken);

      const { brandId, provider } = req.body as { brandId?: string; provider?: string };
      if (!brandId || !provider) { res.status(400).json({ error: 'Missing params' }); return; }

      await db.doc(`connectors/${brandId}`).set(
        { [provider]: { connected: false, accessToken: '', refreshToken: '' } },
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
      await admin.auth().verifyIdToken(idToken);

      const { brandId, provider, accountId, accountName } = req.body as {
        brandId?: string; provider?: string; accountId?: string; accountName?: string;
      };

      if (!brandId || !provider || !accountId) {
        res.status(400).json({ error: 'Missing brandId, provider, or accountId' });
        return;
      }

      let result: { success: boolean; error?: string };
      if (provider === 'meta') {
        result = await selectMetaAccount(brandId, accountId, accountName || accountId);
      } else if (provider === 'google_ads') {
        await selectGoogleAdsAccount(brandId, accountId, accountName || accountId);
        result = { success: true };
      } else if (provider === 'merchant') {
        await selectMerchantAccount(brandId, accountId, accountName || accountId);
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
  { region: 'europe-west1', cors: true, timeoutSeconds: 300, memory: '512MiB', secrets: ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'] },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Use POST' }); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { res.status(401).json({ error: 'Missing auth' }); return; }

    try {
      const idToken = authHeader.slice(7).trim();
      await admin.auth().verifyIdToken(idToken);

      const { brandId, provider } = req.body as { brandId?: string; provider?: string };
      if (!brandId || !provider) { res.status(400).json({ error: 'Missing params' }); return; }

      let result;
      if (provider === 'google_ads') {
        result = await fetchGoogleAdsCampaigns(brandId);
      } else if (provider === 'meta') {
        result = await fetchMetaCampaigns(brandId);
      } else if (provider === 'merchant') {
        result = await fetchPriceBenchmarks(brandId);
      } else if (provider === 'competitor') {
        result = await fetchCompetitorAds(brandId);
      } else {
        res.status(400).json({ error: `Unknown provider: ${provider}` });
        return;
      }

      res.status(200).json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: msg });
    }
  }
);

// ─── Scheduled: Daily Sync (06:00 Europe/Athens) ───────────────

export const scheduledSync = onSchedule(
  {
    schedule: 'every day 06:00',
    timeZone: 'Europe/Athens',
    region: 'europe-west1',
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: ['META_APP_ID', 'META_APP_SECRET', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID'],
  },
  async () => {
    logger.info('[ScheduledSync] Starting daily connector sync');

    const connectorsSnap = await db.collection('connectors').get();

    for (const doc of connectorsSnap.docs) {
      const brandId = doc.id;
      const data = doc.data();

      if (data.google_ads?.connected) {
        try {
          const result = await fetchGoogleAdsCampaigns(brandId);
          logger.info(`[ScheduledSync] Google Ads for ${brandId}: imported ${result.imported}`);
        } catch (err) {
          logger.error(`[ScheduledSync] Google Ads failed for ${brandId}:`, err);
        }
      }

      if (data.meta?.connected) {
        try {
          const result = await fetchMetaCampaigns(brandId);
          logger.info(`[ScheduledSync] Meta for ${brandId}: imported ${result.imported}`);
        } catch (err) {
          logger.error(`[ScheduledSync] Meta failed for ${brandId}:`, err);
        }
      }

      if (data.merchant?.connected) {
        try {
          const result = await fetchPriceBenchmarks(brandId);
          logger.info(`[ScheduledSync] Merchant for ${brandId}: imported ${result.imported}`);
        } catch (err) {
          logger.error(`[ScheduledSync] Merchant failed for ${brandId}:`, err);
        }
      }
    }

    // Competitor monitoring — runs for all brands with competitor settings
    const competitorSnap = await db.collection('competitor_settings').get();
    for (const doc of competitorSnap.docs) {
      const brandId = doc.id;
      const data = doc.data();
      if (data.competitors?.length > 0) {
        try {
          const result = await fetchCompetitorAds(brandId);
          logger.info(`[ScheduledSync] Competitors for ${brandId}: ${result.totalAds} ads (${result.newAds} new)`);
        } catch (err) {
          logger.error(`[ScheduledSync] Competitors failed for ${brandId}:`, err);
        }
      }
    }

    logger.info('[ScheduledSync] Daily sync completed');
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
  { region: 'europe-west1', secrets: [GEMINI_SECRET], cors: true },
  async (req, res) => {
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
    try {
      await admin.auth().verifyIdToken(idToken);
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    const { systemPrompt, userPrompt, model = 'gemini-2.5-flash', temperature = 0 } = req.body as {
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
  { region: 'europe-west1', cors: true },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).send('POST only'); return; }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      await admin.auth().verifyIdToken(authHeader.split('Bearer ')[1]);
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    const { userIds, title, body, type, brandId, entityType, entityId } = req.body;
    if (!userIds || !Array.isArray(userIds) || !title) {
      res.status(400).json({ error: 'Missing userIds or title' });
      return;
    }

    const results: string[] = [];
    for (const uid of userIds) {
      try {
        await sendNotificationEmail(uid, { title, body: body || '', type: type || '', brandId: brandId || '', entityType, entityId });
        results.push(`${uid}: sent`);
      } catch (err) {
        results.push(`${uid}: failed`);
      }
    }

    res.status(200).json({ ok: true, results });
  }
);
