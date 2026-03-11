import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import Busboy from 'busboy';
import { parseCSV, parseXLSXBuffer, csvToObjects } from './parseFile';
import { validateProduct, type ProductData } from './validateProduct';
import { validateCampaign, type CampaignData } from './validateCampaign';

admin.initializeApp();
const db = admin.firestore();

const BATCH_SIZE = 500;

type ImportType = 'products' | 'campaigns' | 'segments';

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
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    await batch.commit();
    logger.info(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: wrote ${chunk.length} docs to ${collectionName}`);
  }
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
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
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
