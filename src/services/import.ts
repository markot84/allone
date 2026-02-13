import { Timestamp } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { FirestoreService } from './firestore';
import type { Product, RFMSegment, Campaign } from '../types';

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

/** Column mapping: Excel/CSV column → App field (where it appears in UI) */
export const PRODUCT_COLUMN_MAPPING = [
  { fileColumn: 'SKU_ID', appField: 'SKU', usedIn: 'Product Intelligence, Strategy, Dashboard count' },
  { fileColumn: 'Product_Name', appField: 'Product', usedIn: 'Product Intelligence, Strategy Preview' },
  { fileColumn: 'Category', appField: 'Category', usedIn: 'Product Intelligence table' },
  { fileColumn: 'Sell_Price', appField: 'Price', usedIn: 'Product Intelligence, Strategy, Revenue calc' },
  { fileColumn: 'Cost_Price', appField: 'Cost price', usedIn: 'Optional, margin derivation' },
  { fileColumn: 'Stock_On_Hand', appField: 'Stock Level', usedIn: 'Product Intelligence, Total SKUs, Strategy' },
  { fileColumn: 'Qty_Sold_Period', appField: 'Qty sold', usedIn: 'Optional, analytics' },
  { fileColumn: 'Revenue_Period', appField: 'Revenue', usedIn: 'Strategy composite score, prioritization' },
  { fileColumn: 'Stock_Age_Days', appField: 'Stock Age', usedIn: 'Product Intelligence, Strategy (stock_clearance)' },
  { fileColumn: 'First_Available_Date', appField: 'Stock Age (αν λείπει Stock_Age_Days)', usedIn: 'Υπολογισμός: σήμερα − ημερομηνία' },
  { fileColumn: 'Gross_Margin_%', appField: 'Gross Margin %', usedIn: 'Product Intelligence, Strategy profit score' },
  { fileColumn: 'Sell_Price + Cost_Price', appField: 'Gross Margin % (αν λείπει Gross_Margin_%)', usedIn: 'Υπολογισμός: (Sell−Cost)/Sell × 100' },
  { fileColumn: 'Margin_Tier', appField: 'Margin tier', usedIn: 'Strategy, Badge (high/medium/low)' },
  { fileColumn: 'Priority_Flag', appField: 'Priority Tag', usedIn: 'Product Intelligence, Strategy strategic score' },
] as const;

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

// Parse XLSX to array of rows (auto-detect header row for campaigns)
function parseXLSXToRows(buffer: ArrayBuffer, type?: ImportType): string[][] {
  const wb = XLSX.read(buffer, { type: 'array' });
  
  // Try to find the right sheet (prefer "Raw Data Report" for Meta, or first sheet)
  let sheetName = wb.SheetNames[0];
  if (type === 'campaigns') {
    const rawDataSheet = wb.SheetNames.find(name => 
      name.toLowerCase().includes('raw') || name.toLowerCase().includes('data')
    );
    if (rawDataSheet) sheetName = rawDataSheet;
  }
  
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' });
  const cleanedRows = rows.map(row => (Array.isArray(row) ? row : [row]).map(cell => String(cell ?? '').trim()));
  
  // For campaigns, try to find header row (Google Ads & Meta have headers in row 2-3)
  if (type === 'campaigns' && cleanedRows.length > 2) {
    // Look for common campaign header keywords
    const headerKeywords = ['campaign', 'month', 'impressions', 'clicks', 'cost', 'conversions', 'roas', 'purchases', 'spent'];
    let bestMatch = 0;
    let bestScore = 0;
    
    for (let i = 0; i < Math.min(10, cleanedRows.length); i++) {
      const row = cleanedRows[i];
      if (!row || row.length === 0) continue;
      
      const rowText = row.join(' ').toLowerCase();
      const score = headerKeywords.filter(keyword => rowText.includes(keyword)).length;
      
      // Check if row looks like data (has large numbers) - headers shouldn't
      const hasLargeNumbers = row.some(cell => {
        const str = String(cell).trim();
        const num = parseFloat(str);
        return !isNaN(num) && num > 1000;
      });
      
      // Prefer rows with high keyword match and no large numbers
      if (score > bestScore && !hasLargeNumbers) {
        bestScore = score;
        bestMatch = i;
      }
    }
    
    if (bestScore >= 3) { // At least 3 header keywords found
      return cleanedRows.slice(bestMatch);
    }
  }
  
  return cleanedRows;
}

// Get rows (header + data) from file - CSV or XLSX
async function getRowsFromFile(file: File, type?: ImportType): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const buffer = await file.arrayBuffer();
    return parseXLSXToRows(buffer, type);
  }
  const text = await file.text();
  return parseCSV(text);
}

// Convert CSV rows to objects (supports finding header row for campaigns)
function csvToObjects(csvRows: string[][], type?: ImportType): Record<string, string>[] {
  if (csvRows.length === 0) return [];
  
  // For campaigns, try to find header row if first row doesn't look like headers
  let headerRowIndex = 0;
  if (type === 'campaigns' && csvRows.length > 1) {
    const headerKeywords = ['campaign', 'month', 'impressions', 'clicks', 'cost', 'conversions', 'roas', 'purchases', 'spent'];
    let bestMatch = 0;
    let bestScore = 0;
    
    for (let i = 0; i < Math.min(10, csvRows.length); i++) {
      const row = csvRows[i];
      if (!row || row.length === 0) continue;
      
      const rowText = row.join(' ').toLowerCase();
      const score = headerKeywords.filter(keyword => rowText.includes(keyword)).length;
      
      // Also check if row looks like data (has numbers) - headers shouldn't have many numbers
      const hasNumbers = row.some(cell => {
        const str = String(cell).trim();
        return str && !isNaN(parseFloat(str)) && parseFloat(str) > 100;
      });
      
      // Prefer rows with high keyword match and no large numbers
      if (score > bestScore && !hasNumbers) {
        bestScore = score;
        bestMatch = i;
      }
    }
    
    if (bestScore >= 3) { // At least 3 header keywords found
      headerRowIndex = bestMatch;
    }
  }
  
  const headers = csvRows[headerRowIndex].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const objects: Record<string, string>[] = [];

  for (let i = headerRowIndex + 1; i < csvRows.length; i++) {
    const row = csvRows[i];
    if (row.length === 0 || !row.some(cell => cell !== '')) continue;
    
    // Skip rows that look like headers (all text, no numbers)
    const rowText = row.join(' ').toLowerCase();
    const hasHeaderKeywords = ['campaign', 'month', 'impressions', 'clicks'].some(k => rowText.includes(k));
    const hasData = row.some(cell => {
      const str = String(cell).trim();
      return str && (!isNaN(parseFloat(str)) || str.match(/^\d{4}-\d{2}-\d{2}/));
    });
    if (hasHeaderKeywords && !hasData && i === headerRowIndex + 1) {
      // This might be a duplicate header row, skip it
      continue;
    }
    
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      const cell = row[index];
      obj[header] = (cell != null ? String(cell).trim() : '') || '';
    });
    objects.push(obj);
  }

  return objects;
}

// Firestore document IDs cannot contain / or \ — sanitize for safe write
function sanitizeDocId(value: string): string {
  return value.replace(/[/\\]/g, '_').trim() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// Helper: find first matching value from a list of possible column aliases (case-insensitive, handles normalized keys)
function pick(row: Record<string, string>, ...keys: string[]): string {
  // First try exact match (case-sensitive)
  for (const k of keys) {
    const val = row[k];
    if (val !== undefined && val !== '') return val;
  }
  
  // Then try case-insensitive match
  const rowKeys = Object.keys(row);
  for (const k of keys) {
    const lowerKey = k.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '');
    const matchingKey = rowKeys.find(rk => {
      const normalizedRk = rk.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '');
      return normalizedRk === lowerKey || normalizedRk.includes(lowerKey) || lowerKey.includes(normalizedRk);
    });
    if (matchingKey) {
      const val = row[matchingKey];
      if (val !== undefined && val !== '') return val;
    }
  }
  
  // Also try partial matching (e.g., "amount spent" matches "amount_spent_eur")
  for (const k of keys) {
    const keyWords = k.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (keyWords.length > 0) {
      const matchingKey = rowKeys.find(rk => {
        const normalizedRk = rk.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '');
        return keyWords.every(word => normalizedRk.includes(word));
      });
      if (matchingKey) {
        const val = row[matchingKey];
        if (val !== undefined && val !== '') return val;
      }
    }
  }
  
  return '';
}

// Parse date from Excel serial (number) or ISO string → days ago from today
function daysFromFirstAvailable(val: string): number | null {
  if (!val || !val.trim()) return null;
  const n = parseFloat(val);
  let date: Date;
  if (!isNaN(n) && n > 0) {
    date = new Date((n - 25569) * 86400 * 1000); // Excel serial → JS Date
  } else {
    date = new Date(val.trim());
  }
  if (isNaN(date.getTime())) return null;
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

// Gross margin % from Sell_Price and Cost_Price when Gross_Margin_% empty
function calcGrossMarginPct(sellPrice: number, costPrice: number): number | null {
  if (sellPrice <= 0) return null;
  return ((sellPrice - costPrice) / sellPrice) * 100;
}

// Validate and transform Products
// Primary schema: FINAL_Unified_Production_Schema (SKU_ID, Product_Name, Category, Sell_Price, Cost_Price, Stock_On_Hand, Qty_Sold_Period, Revenue_Period, Supplier, Brand, First_Available_Date, Last_Sale_Date, Priority_Flag, Stock_Age_Days, Gross_Profit, Gross_Margin_%, Margin_Tier)
function validateProduct(row: Record<string, string>, index: number): { valid: boolean; data?: Product; error?: string } {
  const name = pick(row, 'name', 'product_name', 'product', 'title', 'item', 'item_name', 'description', 'product_title', 'όνομα', 'προϊόν', 'περιγραφή');
  const sku = pick(row, 'sku', 'sku_id', 'id', 'product_id', 'item_id', 'code', 'κωδικός', 'barcode', 'ean');
  const category = pick(row, 'category', 'product_category', 'group', 'κατηγορία', 'type', 'department', 'προμηθευτής');
  const marginTier = pick(row, 'margin_tier', 'margin_category', 'tier');
  const marginPct = pick(row, 'margin_percentage', 'margin_pct', 'margin', 'margin_%', 'gross_margin_%', 'gross_margin', 'profit_margin');
  const stockLevel = pick(row, 'stock_level', 'stock', 'stock_on_hand', 'quantity', 'qty', 'inventory', 'on_hand', 'units', 'απόθεμα', 'ποσότητα', 'available_stock', 'δυναμικό_υπόλοιπο', 'κίνηση');
  const stockCapacity = pick(row, 'stock_capacity', 'capacity', 'max_stock', 'max_quantity', 'χωρητικότητα', 'επιθυμητό_απόθεμα');
  const stockAge = pick(row, 'stock_age_days', 'age_days', 'days_in_stock', 'stock_age', 'age', 'mst_(ημέρες)');
  const firstAvailableDate = pick(row, 'first_available_date', 'first_available', 'available_date', 'date_added', 'created_date', 'creation_date', 'inventory_date');
  const price = pick(row, 'price', 'unit_price', 'retail_price', 'sell_price', 'τιμή', 'msrp', 'κόστος');
  const costPrice = pick(row, 'cost_price', 'cost', 'κόστος');
  const revenuePeriod = pick(row, 'revenue_period', 'revenue', 'revenue_period');
  const qtySoldPeriod = pick(row, 'qty_sold_period', 'qty_sold', 'quantity_sold');
  const priority = pick(row, 'priority_tag', 'priority_flag', 'priority', 'tag', 'label', 'alerts', 'κατάσταση');

  const errors: string[] = [];

  if (!sku && !name) {
    errors.push('Missing SKU/ID and Name');
  }

  if (errors.length > 0) {
    return { valid: false, error: `Row ${index + 1}: ${errors.join(', ')}` };
  }

  const rawId = sku || name.slice(0, 60) || `product-${Date.now()}-${index}`;
  const stockLevelNum = parseInt(stockLevel || '0', 10) || 0;
  const stockCapacityNum = parseInt(stockCapacity || '0', 10) || 0;
  const sellPriceNum = parseFloat(price || '0') || 0;
  const costPriceNum = parseFloat(costPrice || '0') || 0;

  // Stock Age: prefer Stock_Age_Days from file, else compute from First_Available_Date
  let stockAgeDays = parseInt(stockAge || '0', 10) || 0;
  if (stockAgeDays === 0 && firstAvailableDate) {
    const computed = daysFromFirstAvailable(firstAvailableDate);
    if (computed !== null && computed >= 0) stockAgeDays = computed;
  }

  // Gross Margin %: prefer Gross_Margin_% from file, else compute from (Sell_Price - Cost_Price) / Sell_Price
  let marginPctNum = parseFloat(marginPct || '0') || 0;
  if (marginPctNum === 0 && sellPriceNum > 0) {
    const computed = calcGrossMarginPct(sellPriceNum, costPriceNum);
    if (computed !== null) marginPctNum = Math.round(computed * 10) / 10;
  }

  const product: Product = {
    id: sanitizeDocId(String(rawId)),
    name: name || sku,
    sku: sku || rawId,
    category: category || 'Uncategorized',
    margin_tier: (['high', 'medium', 'low'].includes((marginTier || '').toLowerCase()) ? (marginTier || 'medium').toLowerCase() : 'medium') as 'high' | 'medium' | 'low',
    margin_percentage: marginPctNum,
    stock_level: stockLevelNum,
    stock_capacity: stockCapacityNum || stockLevelNum || 1,
    stock_age_days: stockAgeDays,
    price: sellPriceNum,
    ...(priority ? { priority_tag: priority } : {}),
    ...(costPrice ? { cost_price: costPriceNum } : {}),
    ...(revenuePeriod ? { revenue_period: parseFloat(revenuePeriod || '0') || 0 } : {}),
    ...(qtySoldPeriod ? { qty_sold_period: parseInt(qtySoldPeriod || '0', 10) || 0 } : {}),
    ...(firstAvailableDate ? { first_available_date: firstAvailableDate } : {}),
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

// Validate analytics row
function validateAnalyticsRow(row: Record<string, string>, index: number): { valid: boolean; data?: { id: string; date: Timestamp; total_revenue?: number; attributed_revenue?: number; attribution_rate?: number }; error?: string } {
  const date = pick(row, 'date', 'date_time', 'timestamp', 'period', 'month', 'year_month');
  const totalRevenue = pick(row, 'total_revenue', 'total revenue', 'revenue', 'total', 'total_rev', 'revenue_total');
  const attributedRevenue = pick(row, 'attributed_revenue', 'attributed revenue', 'attributed', 'attributed_rev', 'performance_plus_revenue', 'pp_revenue');
  const attributionRate = pick(row, 'attribution_rate', 'attribution rate', 'attribution_%', 'attribution_percentage', 'rate');

  if (!date) {
    return { valid: false, error: `Row ${index + 1}: Missing date` };
  }

  // Parse date - support various formats
  let parsedDate: Date | null = null;
  try {
    parsedDate = new Date(date);
    if (isNaN(parsedDate.getTime())) {
      return { valid: false, error: `Row ${index + 1}: Invalid date format: ${date}` };
    }
  } catch {
    return { valid: false, error: `Row ${index + 1}: Invalid date format: ${date}` };
  }

  const totalRevNum = totalRevenue ? parseFloat(totalRevenue.replace(/[^0-9.-]/g, '')) : undefined;
  const attributedRevNum = attributedRevenue ? parseFloat(attributedRevenue.replace(/[^0-9.-]/g, '')) : undefined;
  const attributionRateNum = attributionRate ? parseFloat(attributionRate.replace(/[^0-9.-]/g, '')) : undefined;

  // Calculate attribution rate if not provided but both revenues exist
  let finalAttributionRate = attributionRateNum;
  if (finalAttributionRate === undefined && totalRevNum !== undefined && attributedRevNum !== undefined && totalRevNum > 0) {
    finalAttributionRate = Math.round((attributedRevNum / totalRevNum) * 1000) / 10;
  }

  const analyticsId = `analytics-${parsedDate.toISOString().split('T')[0]}-${index}`;

  return {
    valid: true,
    data: {
      id: sanitizeDocId(analyticsId),
      date: Timestamp.fromDate(parsedDate), // Store as Firestore Timestamp for proper querying
      ...(totalRevNum !== undefined ? { total_revenue: totalRevNum } : {}),
      ...(attributedRevNum !== undefined ? { attributed_revenue: attributedRevNum } : {}),
      ...(finalAttributionRate !== undefined ? { attribution_rate: finalAttributionRate } : {}),
    },
  };
}

// Validate campaign row (supports Google Ads & Meta formats)
function validateCampaignRow(row: Record<string, string>, index: number): { valid: boolean; data?: Campaign; error?: string } {
  // First, check if there's an explicit "Channel" column (highest priority)
  const explicitChannel = pick(row, 'channel', 'channel_name', 'source', 'platform');
  
  // Detect channel from column names (case-insensitive)
  const rowKeysLower = Object.keys(row).map(k => k.toLowerCase());
  const hasGoogleAdsColumns = rowKeysLower.some(k => 
    k.includes('campaign') && (k.includes('status') || k.includes('budget') || k.includes('bid strategy'))
  ) || rowKeysLower.includes('conv. value / cost') || rowKeysLower.includes('conv value / cost');
  
  const hasMetaColumns = rowKeysLower.some(k => 
    k.includes('campaign name') || 
    k.includes('purchase roas') || 
    k.includes('amount spent') || 
    k.includes('reporting starts') ||
    k.includes('reporting ends') ||
    k.includes('result type') ||
    k.includes('cost per result') ||
    (k.includes('purchases') && k.includes('conversion value')) ||
    (k.includes('ctr') && k.includes('all')) ||
    (k.includes('cpc') && k.includes('all'))
  );
  
  let channel: 'Google Ads' | 'Meta' | 'Other' = 'Other';
  
  // Use explicit channel if available (highest priority)
  if (explicitChannel) {
    const channelLower = explicitChannel.toLowerCase().trim();
    if (channelLower.includes('meta') || channelLower.includes('facebook') || channelLower.includes('instagram')) {
      channel = 'Meta';
    } else if (channelLower.includes('google') || channelLower.includes('ads')) {
      channel = 'Google Ads';
    }
  }
  
  // If no explicit channel, detect from columns
  if (channel === 'Other') {
    // Prioritize Meta detection if Meta columns are found
    if (hasMetaColumns) {
      channel = 'Meta';
    } else if (hasGoogleAdsColumns) {
      channel = 'Google Ads';
    }
  }
  
  // Debug logging in development
  if (import.meta.env.MODE === 'development' && index < 3) {
    console.debug(`[Campaign Row ${index}] Channel detection:`, {
      explicitChannel,
      hasGoogleAdsColumns,
      hasMetaColumns,
      detectedChannel: channel,
      sampleKeys: Object.keys(row).slice(0, 5)
    });
  }

  // Common fields - try various formats (original, normalized, with/without spaces/underscores)
  let name = pick(row, 
    'campaign_name', 'campaign name', 'campaign', 'name', 'campaign_name_',
    'campaignname', 'campaign-name'
  );
  const period = pick(row, 'month', 'period', 'date range', 'date_range');
  const status = pick(row, 'status', 'campaign status', 'campaign_status', 'state');
  
  // If no campaign name, create one from period/month + campaign (if available)
  if (!name || name.trim() === '') {
    const campaignField = pick(row, 'campaign', 'campaign_name', 'campaign name');
    if (period && period.trim() !== '') {
      name = period.trim();
      if (campaignField && campaignField.trim() !== '') {
        name = `${campaignField.trim()} - ${period.trim()}`;
      }
    } else if (campaignField && campaignField.trim() !== '') {
      name = campaignField.trim();
    } else {
      // Last resort: use reporting dates or row index
      const reportingStarts = pick(row, 'reporting starts', 'reporting_starts', 'start_date', 'start date');
      if (reportingStarts && reportingStarts.trim() !== '') {
        name = `Campaign ${reportingStarts.trim()}`;
      } else {
        name = `Campaign Row ${index + 1}`;
      }
    }
  }
  const budget = pick(row, 'budget', 'budget_amount', 'daily_budget');
  // Meta uses "Amount spent (EUR)" - try various formats
  const amountSpent = pick(row, 
    'amount spent (eur)', 'amount spent (eur)', 'amount_spent_eur', 'amount_spent',
    'cost', 'spend', 'total_cost', 'spent'
  );
  const impressions = pick(row, 'impressions', 'impr.', 'impr', 'imp');
  // Meta uses "Clicks (all)" - prioritize this
  const clicks = pick(row, 'clicks (all)', 'clicks', 'click', 'clicks_all');
  // Meta uses "CTR (all)" - prioritize this
  const ctr = pick(row, 'ctr (all)', 'ctr', 'click_through_rate', 'ctr_all');
  // Meta uses "CPC (all)" - prioritize this
  const cpc = pick(row, 'cpc (all)', 'avg. cpc', 'cpc', 'cost_per_click', 'avg cpc', 'cpc_all');
  const cpm = pick(row, 'cpm (cost per 1,000 impressions)', 'cpm', 'cost_per_mille', 'cpm (cost per 1,000 impressions)');
  // Meta uses "Purchases" instead of "Conversions"
  const conversions = pick(row, 'purchases', 'conversions', 'purchase', 'conversion');
  // Meta uses "Purchases conversion value"
  const conversionValue = pick(row, 
    'purchases conversion value', 'purchases_conversion_value',
    'conv. value', 'conversion_value', 'purchase_value', 'purchase conversion value'
  );
  // Meta uses "Purchase ROAS (return on ad spend)" - prioritize this
  const roas = pick(row, 
    'purchase roas (return on ad spend)', 'purchase_roas_return_on_ad_spend',
    'conv. value / cost', 'roas', 'return_on_ad_spend', 'purchase roas'
  );
  // Meta uses "Cost per result"
  const costPerConversion = pick(row, 
    'cost per result', 'cost_per_result',
    'cost / conv.', 'cost_per_conversion', 'cost per conversion'
  );
  const conversionRate = pick(row, 'conv. rate', 'conversion_rate', 'conversion rate');
  const currencyCode = pick(row, 'currency code', 'currency', 'currency_code');
  
  // Google Ads specific
  const bidStrategyType = pick(row, 'bid strategy type', 'bid_strategy_type', 'bidding_strategy');
  
  // Meta specific
  const resultType = pick(row, 'result type', 'result_type');
  const reportingStarts = pick(row, 'reporting starts', 'reporting_starts', 'start_date', 'start date');
  const reportingEnds = pick(row, 'reporting ends', 'reporting_ends', 'end_date', 'end date');
  
  // Use reporting dates if available, otherwise try to parse period
  let startDate: string | undefined = reportingStarts;
  let endDate: string | undefined = reportingEnds;
  
  if (!startDate && period) {
    // Try to parse period like "2025-01-01 - 2025-01-31" or "January 2025"
    const dateRangeMatch = period.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
    if (dateRangeMatch) {
      startDate = dateRangeMatch[1];
      endDate = dateRangeMatch[2];
    } else {
      // Try "January 2025" format
      const monthMatch = period.match(/(\w+)\s+(\d{4})/);
      if (monthMatch) {
        const monthNames: Record<string, string> = {
          january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
          july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
        };
        const month = monthNames[monthMatch[1].toLowerCase()];
        if (month) {
          startDate = `${monthMatch[2]}-${month}-01`;
          // End date is last day of month
          const lastDay = new Date(parseInt(monthMatch[2]), parseInt(month), 0).getDate();
          endDate = `${monthMatch[2]}-${month}-${lastDay}`;
        }
      }
    }
  }

  // Name should always be set now (we create it from period/campaign if missing)
  if (!name || name.trim() === '') {
    return { valid: false, error: `Row ${index + 1}: Cannot determine campaign identifier` };
  }

  // Final channel validation: if channel is still 'Other' but we have Meta-specific data, force Meta
  // This happens after we've picked all the fields
  const roasValue = pick(row, 
    'purchase roas (return on ad spend)', 'purchase_roas_return_on_ad_spend',
    'conv. value / cost', 'roas', 'return_on_ad_spend', 'purchase roas'
  );
  const resultTypeValue = pick(row, 'result type', 'result_type');
  const purchasesValue = pick(row, 'purchases', 'conversions', 'purchase', 'conversion');
  
  let finalChannel = channel;
  if (channel === 'Other') {
    // Check if we have Meta-specific fields with actual data
    const hasMetaData = (amountSpent && parseFloat(amountSpent) > 0) || 
                        (roasValue && parseFloat(roasValue) > 0) ||
                        (resultTypeValue && resultTypeValue.trim() !== '') ||
                        (purchasesValue && purchasesValue.trim() !== '');
    
    // Check if we have Google Ads-specific fields
    const bidStrategyValue = pick(row, 'bid strategy type', 'bid_strategy_type', 'bidding_strategy');
    const convValueCost = pick(row, 'conv. value / cost', 'conv value / cost');
    const hasGoogleAdsData = (bidStrategyValue && bidStrategyValue.trim() !== '') ||
                             (convValueCost && convValueCost.trim() !== '');
    
    if (hasMetaData && !hasGoogleAdsData) {
      finalChannel = 'Meta';
    } else if (hasGoogleAdsData && !hasMetaData) {
      finalChannel = 'Google Ads';
    }
  }

  const campaign: Campaign = {
    id: sanitizeDocId(`campaign-${Date.now()}-${index}`),
    name: name.trim(),
    channel: finalChannel,
    ...(period ? { period: period.trim() } : {}),
    ...(startDate ? { start_date: startDate } : {}),
    ...(endDate ? { end_date: endDate } : {}),
    ...(status ? { status: status.trim().toLowerCase() } : {}),
    ...(budget ? { budget: parseFloat(budget) || 0 } : {}),
    ...(amountSpent ? { amount_spent: parseFloat(amountSpent) || 0 } : {}),
    ...(impressions ? { impressions: parseInt(impressions, 10) || 0 } : {}),
    ...(clicks ? { clicks: parseInt(clicks, 10) || 0 } : {}),
    ...(ctr ? { ctr: parseFloat(ctr) || 0 } : {}),
    ...(cpc ? { cpc: parseFloat(cpc) || 0 } : {}),
    ...(cpm ? { cpm: parseFloat(cpm) || 0 } : {}),
    ...(conversions ? { conversions: parseInt(conversions, 10) || 0 } : {}),
    ...(conversionValue ? { conversion_value: parseFloat(conversionValue) || 0 } : {}),
    ...(roas ? { roas: parseFloat(roas) || 0 } : {}),
    ...(costPerConversion ? { cost_per_conversion: parseFloat(costPerConversion) || 0 } : {}),
    ...(conversionRate ? { conversion_rate: parseFloat(conversionRate) || 0 } : {}),
    ...(currencyCode ? { currency_code: currencyCode.trim().toUpperCase() } : {}),
    ...(bidStrategyType ? { bid_strategy_type: bidStrategyType.trim() } : {}),
    ...(resultType ? { result_type: resultType.trim() } : {}),
  };

  return { valid: true, data: campaign };
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

    const rows = await getRowsFromFile(file, type);
    if (rows.length < 2) {
      result.success = false;
      result.errors.push('File must contain at least a header row and one data row');
      return result;
    }

    const objects = csvToObjects(rows, type);
    
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

      case 'analytics': {
        // Validate and transform analytics records
        const validAnalytics: Array<{ id: string; data: Record<string, unknown> }> = [];
        for (let i = 0; i < objects.length; i++) {
          const validation = validateAnalyticsRow(objects[i], i);
          if (validation.valid && validation.data) {
            validAnalytics.push({
              id: validation.data.id,
              data: { ...validation.data, createdAt: Timestamp.now() } as Record<string, unknown>,
            });
          } else {
            result.failed++;
            if (validation.error && result.errors.length < MAX_ERRORS_DISPLAY) {
              result.errors.push(validation.error);
            }
          }
        }

        if (import.meta.env.MODE === 'development') {
          console.debug('[Import] Analytics: Valid records:', validAnalytics.length, 'BrandId:', brandId);
          if (validAnalytics.length > 0) {
            console.debug('[Import] First analytics record:', validAnalytics[0]);
          }
        }

        // Batch import to Firestore
        const analyticsChunks = chunk(validAnalytics, BATCH_SIZE);
        let analyticsProcessed = 0;
        await runWithConcurrency(analyticsChunks, BATCH_CONCURRENCY, async (chunkItems, batchIndex) => {
          await FirestoreService.batchSet('analytics', chunkItems, brandId);
          analyticsProcessed += chunkItems.length;
          onProgress?.({
            rowsProcessed: analyticsProcessed,
            totalRows: validAnalytics.length,
            batchIndex: batchIndex + 1,
            totalBatches: analyticsChunks.length,
            fileName: file.name,
          });
        });
        result.imported = validAnalytics.length;
        if (result.failed > MAX_ERRORS_DISPLAY) {
          result.errors.push(`...and ${result.failed - MAX_ERRORS_DISPLAY} more validation errors`);
        }
        break;
      }

      case 'campaigns': {
        // Validate and transform campaigns
        const validCampaigns: Campaign[] = [];
        objects.forEach((row, i) => {
          const validation = validateCampaignRow(row, i);
          if (validation.valid && validation.data) {
            validCampaigns.push({
              ...validation.data,
              brandId: brandId || undefined,
              importedAt: new Date(),
              source: file.name,
            });
          } else {
            result.failed++;
            if (result.errors.length < MAX_ERRORS_DISPLAY) {
              result.errors.push(validation.error || `Row ${i + 1}: Invalid campaign data`);
            }
          }
        });
        
        // Batch store campaigns
        const campaignChunks = chunk(validCampaigns, BATCH_SIZE);
        let campaignProcessed = 0;
        await runWithConcurrency(campaignChunks, BATCH_CONCURRENCY, async (chunkItems, batchIndex) => {
          const items = chunkItems.map(c => ({ 
            id: c.id, 
            data: { 
              ...c, 
              createdAt: Timestamp.now() 
            } as unknown as Record<string, unknown> 
          }));
          await FirestoreService.batchSet('campaigns', items, brandId);
          campaignProcessed += chunkItems.length;
          onProgress?.({
            rowsProcessed: campaignProcessed,
            totalRows: validCampaigns.length,
            batchIndex: batchIndex + 1,
            totalBatches: campaignChunks.length,
            fileName: file.name,
          });
        });
        result.imported = validCampaigns.length;
        if (result.failed > MAX_ERRORS_DISPLAY) {
          result.errors.push(`...and ${result.failed - MAX_ERRORS_DISPLAY} more validation errors`);
        }
        break;
      }
      
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
          await FirestoreService.batchSet(type, chunkItems, brandId);
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
