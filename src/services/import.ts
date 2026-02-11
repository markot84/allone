import { Timestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { FirestoreService } from './firestore';
import type { Product, RFMSegment } from '../types';

const BATCH_SIZE = 500; // Firestore limit per writeBatch
const BATCH_CONCURRENCY = 3;
const MAX_ERRORS_DISPLAY = 50;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx'];
export function isSupportedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export type ImportType = 'products' | 'segments' | 'campaigns' | 'analytics' | 'custom';

export interface ImportResult {
  success: boolean;
  imported: number;
  failed: number;
  errors: string[];
  warnings: string[];
}

export interface ImportJob {
  id: string;
  type: ImportType;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: ImportResult;
  createdAt: Date;
  completedAt?: Date;
}

export interface ImportProgress {
  rowsProcessed: number;
  totalRows: number;
  batchIndex: number;
  totalBatches: number;
  fileName: string;
}

// CSV Parser (simple implementation, can be replaced with papaparse later)
export function parseCSV(csvText: string): string[][] {
  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];
    const nextChar = csvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentLine.push(currentField.trim());
      currentField = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (currentField || currentLine.length > 0) {
        currentLine.push(currentField.trim());
        lines.push(currentLine);
        currentLine = [];
        currentField = '';
      }
      if (char === '\r' && nextChar === '\n') {
        i++; // Skip \n after \r
      }
    } else {
      currentField += char;
    }
  }

  // Add last line
  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField.trim());
    lines.push(currentLine);
  }

  return lines;
}

// Parse XLSX to array of rows (first row = headers)
function parseXLSXToRows(buffer: ArrayBuffer): string[][] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) return [];
  const sheet = wb.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
  return rows.map(row => (Array.isArray(row) ? row : [row]).map(cell => String(cell ?? '').trim()));
}

// Get rows (header + data) from file - CSV or XLSX
async function getRowsFromFile(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const buffer = await file.arrayBuffer();
    return parseXLSXToRows(buffer);
  }
  const text = await file.text();
  return parseCSV(text);
}

// Convert CSV rows to objects
function csvToObjects(csvRows: string[][]): Record<string, string>[] {
  if (csvRows.length === 0) return [];
  
  const headers = csvRows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const objects: Record<string, string>[] = [];

  for (let i = 1; i < csvRows.length; i++) {
    const row = csvRows[i];
    if (row.length === 0) continue;
    
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      obj[header] = row[index]?.trim() || '';
    });
    objects.push(obj);
  }

  return objects;
}

// Firestore document IDs cannot contain / or \ — sanitize for safe write
function sanitizeDocId(value: string): string {
  return value.replace(/[/\\]/g, '_').trim() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Helper: find first matching value from a list of possible column aliases
function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const val = row[k];
    if (val !== undefined && val !== '') return val;
  }
  return '';
}

// Validate and transform Products
function validateProduct(row: Record<string, string>, index: number): { valid: boolean; data?: Product; error?: string } {
  // Flexible column aliases to support different export formats (Monday.com, DSS, etc.)
  // DSS export: SKU, Περιγραφή, Προμηθευτής, Κατάσταση, Κίνηση, Δυναμικό_Υπόλοιπο, Επιθυμητό_Απόθεμα, MST_TOD, MST_(ημέρες), Ανάγκη, Τελική_Παραγγελία, MOQ, Packing, Κόστος, Alerts
  const name = pick(row, 'name', 'product_name', 'product', 'title', 'item', 'item_name', 'description', 'product_title', 'όνομα', 'προϊόν', 'περιγραφή');
  const sku = pick(row, 'sku', 'id', 'product_id', 'item_id', 'code', 'κωδικός', 'barcode', 'ean');
  const category = pick(row, 'category', 'product_category', 'group', 'κατηγορία', 'type', 'department', 'προμηθευτής');
  const marginTier = pick(row, 'margin_tier', 'margin_category', 'tier');
  const marginPct = pick(row, 'margin_percentage', 'margin_pct', 'margin', 'margin_%', 'gross_margin', 'profit_margin');
  const stockLevel = pick(row, 'stock_level', 'stock', 'quantity', 'qty', 'inventory', 'on_hand', 'units', 'απόθεμα', 'ποσότητα', 'available_stock', 'δυναμικό_υπόλοιπο', 'κίνηση');
  const stockCapacity = pick(row, 'stock_capacity', 'capacity', 'max_stock', 'max_quantity', 'χωρητικότητα', 'επιθυμητό_απόθεμα');
  const stockAge = pick(row, 'stock_age_days', 'age_days', 'days_in_stock', 'stock_age', 'age', 'mst_(ημέρες)');
  const price = pick(row, 'price', 'unit_price', 'retail_price', 'sell_price', 'τιμή', 'cost', 'msrp', 'κόστος');
  const priority = pick(row, 'priority_tag', 'priority', 'tag', 'label', 'alerts', 'κατάσταση');

  const errors: string[] = [];

  if (!sku && !name) {
    errors.push('Missing SKU/ID and Name');
  }

  if (errors.length > 0) {
    return { valid: false, error: `Row ${index + 1}: ${errors.join(', ')}` };
  }

  const rawId = sku || name.slice(0, 60) || `product-${Date.now()}-${index}`;
  const product: Product = {
    id: sanitizeDocId(String(rawId)),
    name: name || sku,
    sku: sku || rawId,
    category: category || 'Uncategorized',
    margin_tier: (['high', 'medium', 'low'].includes(marginTier) ? marginTier : 'medium') as 'high' | 'medium' | 'low',
    margin_percentage: parseFloat(marginPct || '0') || 0,
    stock_level: parseInt(stockLevel || '0', 10) || 0,
    stock_capacity: parseInt(stockCapacity || '0', 10) || 0,
    stock_age_days: parseInt(stockAge || '0', 10) || 0,
    price: parseFloat(price || '0') || 0,
    ...(priority ? { priority_tag: priority } : {}),
  };

  return { valid: true, data: product };
}

// Check if this is customer-level data (SignalLab: each row = customer) vs segment-level (each row = aggregated segment)
function isCustomerLevelData(objects: Record<string, string>[]): boolean {
  if (objects.length === 0) return false;
  const first = objects[0];
  const hasRfmSegment = !!pick(first, 'rfm_segment');
  const hasCustomerId = !!pick(first, 'customerid', 'customer_id');
  // SignalLab format: RFM_Segment + CustomerID per row
  return hasRfmSegment && hasCustomerId;
}

// Validate single segment row (for segment-level imports)
function validateSegmentRow(row: Record<string, string>, index: number): { valid: boolean; data?: RFMSegment; error?: string } {
  const name = pick(row, 'name', 'segment', 'segment_name', 'label', 'group', 'customer_segment', 'τμήμα', 'rfm_segment');
  const rfmScore = pick(row, 'rfm_score', 'rfmscore', 'score', 'rfm', 'rfm_value', 'r_score');
  const fScore = pick(row, 'f_score');
  const mScore = pick(row, 'm_score');
  const count = pick(row, 'count', 'customers', 'customer_count', 'total', 'size', 'αριθμός', 'frequency');
  const pct = pick(row, 'percentage', 'pct', 'percent', '%', 'share');
  const revShare = pick(row, 'revenue_share', 'revenue', 'revenue_pct', 'revenue_%', 'rev_share', 'monetary');
  const color = pick(row, 'color', 'colour', 'hex');
  const description = pick(row, 'description', 'desc', 'note', 'notes', 'περιγραφή', 'behavioral_persona', 'tier');
  const icon = pick(row, 'icon', 'emoji');

  if (!name) {
    return { valid: false, error: `Row ${index + 1}: Missing segment name` };
  }

  const composedRfm = rfmScore || (fScore && mScore ? `${pick(row, 'r_score')}${fScore}${mScore}` : '');
  const rawSegmentId = pick(row, 'id', 'segment_id') || `segment-${Date.now()}-${index}`;
  const segment: RFMSegment = {
    id: sanitizeDocId(String(rawSegmentId)),
    name,
    rfm_score: composedRfm,
    count: parseInt(count || '0', 10) || 0,
    percentage: parseFloat(pct || '0') || 0,
    revenue_share: parseFloat(revShare || '0') || 0,
    color: color || '#6B7280',
    description: description || '',
    icon: icon || '',
  };

  return { valid: true, data: segment };
}

// Aggregate customer-level rows into segments (SignalLab format: each row = customer)
function aggregateCustomersToSegments(objects: Record<string, string>[]): RFMSegment[] {
  const segmentMap = new Map<string, { count: number; monetary: number; displayName: string }>();

  for (const row of objects) {
    const name = pick(row, 'rfm_segment', 'segment', 'segment_name', 'name');
    if (!name) continue;

    // Normalize: "At Risk 2" → "At Risk", "Champions 5" → "Champions" for max ~9 segments
    const baseName = name.trim().replace(/\s+\d+$/, '').trim() || name.trim();
    const key = baseName.toLowerCase().replace(/\s+/g, '_');
    const displayName = baseName;
    const monetary = parseFloat(pick(row, 'monetary', 'revenue', 'revenue_share') || '0') || 0;
    const existing = segmentMap.get(key) || { count: 0, monetary: 0, displayName };
    existing.count += 1;
    existing.monetary += monetary;
    segmentMap.set(key, existing);
  }

  const totalCount = objects.length;
  const totalMonetary = [...segmentMap.values()].reduce((s, v) => s + v.monetary, 0);

  const SEGMENT_COLORS: Record<string, string> = {
    champions: '#16A34A',
    loyal_customers: '#2563EB',
    promising: '#7C3AED',
    at_risk: '#EA580C',
    hibernating: '#14B8A6',
    lost: '#DC2626',
    new_customers: '#0891B2',
    recent_customers: '#10B981',
    potential: '#9333EA',
    potential_loyalists: '#A855F7',
    cant_lose_them: '#F59E0B',
    "can't_lose_them": '#F59E0B',
    customers_needing_attention: '#EC4899',
  };

  return [...segmentMap.entries()].map(([key, { count, monetary, displayName }]) => {
    const percentage = totalCount > 0 ? Math.round((count / totalCount) * 10000) / 100 : 0;
    const revenue_share = totalMonetary > 0 ? Math.round((monetary / totalMonetary) * 10000) / 100 : 0;
    const id = sanitizeDocId(key);

    return {
      id,
      name: displayName,
      rfm_score: '',
      count,
      percentage,
      revenue_share,
      color: SEGMENT_COLORS[key] || '#6B7280',
      description: '',
      icon: '',
    } as RFMSegment;
  });
}

// Main import function (CSV or XLSX). Pass brandId for multi-tenant scoping.
export async function importFile(
  file: File,
  type: ImportType,
  onProgress?: (p: ImportProgress) => void,
  brandId?: string | null
): Promise<ImportResult> {
  const result: ImportResult = {
    success: true,
    imported: 0,
    failed: 0,
    errors: [],
    warnings: [],
  };

  try {
    if (!isSupportedFile(file.name)) {
      result.success = false;
      result.errors.push(`Unsupported file type. Use .csv or .xlsx`);
      return result;
    }

    const rows = await getRowsFromFile(file);
    if (rows.length < 2) {
      result.success = false;
      result.errors.push('File must contain at least a header row and one data row');
      return result;
    }

    const objects = csvToObjects(rows);
    
    if (objects.length === 0) {
      result.success = false;
      result.errors.push('No data rows found in CSV');
      return result;
    }

    // Log detected headers as a warning for debugging
    const detectedHeaders = rows[0].map(h => h.trim()).filter(Boolean);
    result.warnings.push(`Detected columns: ${detectedHeaders.join(', ')}`);

    // Process based on type
    switch (type) {
      case 'products': {
        const validProducts: Product[] = [];
        
        for (let i = 0; i < objects.length; i++) {
          const validation = validateProduct(objects[i], i);
          if (validation.valid && validation.data) {
            validProducts.push(validation.data);
          } else {
            result.failed++;
            if (validation.error && result.errors.length < MAX_ERRORS_DISPLAY) {
              result.errors.push(validation.error);
            }
          }
        }

        // Replace existing products for this brand, then import
        await FirestoreService.deleteCollection('products', brandId);
        const productChunks = chunk(validProducts, BATCH_SIZE);
        const coll = 'products';
        let rowsProcessed = 0;
        await runWithConcurrency(productChunks, BATCH_CONCURRENCY, async (chunkItems, batchIndex) => {
          const batchItems = chunkItems.map((p) => ({
            id: p.id,
            data: { ...p, createdAt: Timestamp.now() } as Record<string, unknown>,
          }));
          await FirestoreService.batchSet(coll, batchItems, brandId);
          rowsProcessed += chunkItems.length;
          onProgress?.({
            rowsProcessed,
            totalRows: validProducts.length,
            batchIndex: batchIndex + 1,
            totalBatches: productChunks.length,
            fileName: file.name,
          });
        });
        result.imported = validProducts.length;
        if (result.failed > MAX_ERRORS_DISPLAY) {
          result.errors.push(`...and ${result.failed - MAX_ERRORS_DISPLAY} more validation errors`);
        }
        break;
      }

      case 'segments': {
        let validSegments: RFMSegment[];

        if (isCustomerLevelData(objects)) {
          // SignalLab: aggregate customers by RFM_Segment → max ~9 segments
          await FirestoreService.deleteCollection('segments', brandId);
          validSegments = aggregateCustomersToSegments(objects);
          result.warnings.push(`Aggregated ${objects.length} customers into ${validSegments.length} segments`);
        } else {
          // Segment-level: each row = one segment — replace existing first
          await FirestoreService.deleteCollection('segments', brandId);
          validSegments = [];
          for (let i = 0; i < objects.length; i++) {
            const validation = validateSegmentRow(objects[i], i);
            if (validation.valid && validation.data) {
              validSegments.push(validation.data);
            } else {
              result.failed++;
              if (validation.error && result.errors.length < MAX_ERRORS_DISPLAY) {
                result.errors.push(validation.error);
              }
            }
          }
        }

        // Batch import to Firestore (500/batch, 3 concurrent)
        const segmentChunks = chunk(validSegments, BATCH_SIZE);
        const segColl = 'segments';
        let segRowsProcessed = 0;
        await runWithConcurrency(segmentChunks, BATCH_CONCURRENCY, async (chunkItems, batchIndex) => {
          const batchItems = chunkItems.map((s) => ({
            id: s.id,
            data: { ...s, createdAt: Timestamp.now() } as Record<string, unknown>,
          }));
          await FirestoreService.batchSet(segColl, batchItems, brandId);
          segRowsProcessed += chunkItems.length;
          onProgress?.({
            rowsProcessed: segRowsProcessed,
            totalRows: validSegments.length,
            batchIndex: batchIndex + 1,
            totalBatches: segmentChunks.length,
            fileName: file.name,
          });
        });
        result.imported = validSegments.length;
        if (result.failed > MAX_ERRORS_DISPLAY) {
          result.errors.push(`...and ${result.failed - MAX_ERRORS_DISPLAY} more validation errors`);
        }
        break;
      }

      case 'campaigns':
      case 'analytics':
      case 'custom':
        result.warnings.push(`${type} import is not yet fully implemented`);
        // Batch store as raw data
        const rawItems = objects.map((obj, i) => ({
          id: `import-${Date.now()}-${i}`,
          data: { ...obj, importedAt: Timestamp.now(), source: file.name } as Record<string, unknown>,
        }));
        const rawChunks = chunk(rawItems, BATCH_SIZE);
        let rawProcessed = 0;
        await runWithConcurrency(rawChunks, BATCH_CONCURRENCY, async (chunkItems, batchIndex) => {
          await FirestoreService.batchSet(type, chunkItems);
          rawProcessed += chunkItems.length;
          onProgress?.({
            rowsProcessed: rawProcessed,
            totalRows: objects.length,
            batchIndex: batchIndex + 1,
            totalBatches: rawChunks.length,
            fileName: file.name,
          });
        });
        result.imported = objects.length;
        break;
    }

    result.success = result.failed === 0;
  } catch (error) {
    result.success = false;
    result.errors.push(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  return result;
}

/** @deprecated Use importFile for CSV and XLSX */
export const importCSV = importFile;

// Save import job history (truncate errors/warnings to avoid Firestore 1MB doc limit)
const MAX_STORED_ERRORS = 20;
export async function saveImportJob(job: Omit<ImportJob, 'id'>): Promise<string> {
  const id = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const trimmedResult = job.result
    ? {
        ...job.result,
        errors: job.result.errors.length > MAX_STORED_ERRORS
          ? [...job.result.errors.slice(0, MAX_STORED_ERRORS), `...and ${job.result.errors.length - MAX_STORED_ERRORS} more`]
          : job.result.errors,
        warnings: job.result.warnings.slice(0, MAX_STORED_ERRORS),
      }
    : undefined;
  const payload: Record<string, unknown> = {
    ...job,
    createdAt: Timestamp.fromDate(job.createdAt),
    completedAt: job.completedAt ? Timestamp.fromDate(job.completedAt) : null,
  };
  if (trimmedResult) {
    payload.result = trimmedResult;
  } else {
    delete payload.result;
  }
  await FirestoreService.setDocument('import_jobs', id, payload);
  return id;
}

// Get import job history
export async function getImportJobs(): Promise<ImportJob[]> {
  const jobs = await FirestoreService.getDocuments<ImportJob>('import_jobs', []);
  return jobs.map(job => ({
    ...job,
    createdAt: (job.createdAt as any)?.toDate?.() || new Date(job.createdAt as any),
    completedAt: (job.completedAt as any)?.toDate?.() || (job.completedAt ? new Date(job.completedAt as any) : undefined),
  }));
}
