import { Timestamp, writeBatch, doc, orderBy, limit } from 'firebase/firestore';
import { coerceToDate } from '../utils/coerceDate';
import * as XLSX from 'xlsx';
import { db } from '../config/firebase';
import { FirestoreService, CampaignsService, ProcurementService, PROCUREMENT_COLLECTIONS } from './firestore';
import { PROCUREMENT_SHEET_NAMES } from '../types/procurement';
import type { ProcurementSheetType } from '../types/procurement';
import { FEED_SOURCE_CONFIG, type FeedSourceType } from '../data/feedSourceConfig';
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

const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.xml'];

/** Column mapping: Excel/CSV column → App field (where it appears in UI) */
export const PRODUCT_COLUMN_MAPPING = [
  { 
    fileColumn: 'SKU_ID', 
    appField: 'SKU', 
    usedIn: 'Product Intelligence, Strategy, Dashboard count',
    alternatives: ['SKU_ID', 'SKU', 'sku_id', 'sku', 'ID', 'id', 'Product_ID', 'product_id', 'Item_ID', 'item_id', 'Item ID', 'item id', 'Code', 'code', 'Κωδικός', 'κωδικός', 'Barcode', 'barcode', 'EAN', 'ean']
  },
  { 
    fileColumn: 'Product_Name', 
    appField: 'Product', 
    usedIn: 'Product Intelligence, Strategy Preview',
    alternatives: ['Product_Name', 'Product Name', 'product_name', 'Name', 'name', 'Product', 'product', 'Title', 'title', 'Item', 'item', 'Item_Name', 'item_name', 'Description', 'description', 'Product_Title', 'product_title', 'Όνομα', 'όνομα', 'Προϊόν', 'προϊόν', 'Περιγραφή', 'περιγραφή']
  },
  { 
    fileColumn: 'Category', 
    appField: 'Category', 
    usedIn: 'Product Intelligence table',
    alternatives: ['Category', 'category', 'Product_Category', 'product_category', 'Group', 'group', 'Κατηγορία', 'κατηγορία', 'Type', 'type', 'Department', 'department']
  },
  {
    fileColumn: 'Subcategory',
    appField: 'Subcategory',
    usedIn: 'Optional, finer merchandising grouping',
    alternatives: ['Subcategory', 'sub_category', 'sub-category', 'subcategory', 'Sub_Category', 'Sub Category', 'Υποκατηγορία', 'υποκατηγορία']
  },
  {
    fileColumn: 'Brand',
    appField: 'Brand',
    usedIn: 'Competitive, search, merchandising',
    alternatives: ['Brand', 'brand', 'Manufacturer', 'manufacturer', 'Vendor_Brand', 'vendor_brand', 'Μάρκα', 'μάρκα']
  },
  {
    fileColumn: 'Barcode',
    appField: 'Barcode / GTIN',
    usedIn: 'Competitive matching, catalog identity',
    alternatives: ['Barcode', 'barcode', 'GTIN', 'gtin', 'EAN', 'ean', 'UPC', 'upc', 'Bar_Code', 'bar_code']
  },
  {
    fileColumn: 'Status',
    appField: 'Product status',
    usedIn: 'Lifecycle / filtering',
    alternatives: ['Status', 'status', 'Product_Status', 'product_status', 'Item_Status', 'item_status', 'Κατάσταση_Προϊόντος', 'κατάσταση_προϊόντος']
  },
  { 
    fileColumn: 'Sell_Price', 
    appField: 'Price', 
    usedIn: 'Product Intelligence, Strategy, Revenue calc',
    alternatives: ['Sell_Price', 'Sell Price', 'sell_price', 'Price', 'price', 'Unit_Price', 'unit_price', 'Retail_Price', 'retail_price', 'MSRP', 'msrp', 'Τιμή', 'τιμή']
  },
  { 
    fileColumn: 'Cost_Price', 
    appField: 'Cost price', 
    usedIn: 'Optional, margin derivation',
    alternatives: ['Cost_Price', 'Cost Price', 'cost_price', 'Cost', 'cost', 'Κόστος', 'κόστος']
  },
  {
    fileColumn: 'List_Price',
    appField: 'List / compare price',
    usedIn: 'Pricing comparisons, merchandising',
    alternatives: ['List_Price', 'List Price', 'list_price', 'Compare_At_Price', 'compare_at_price', 'Compare At Price', 'compare_at', 'MSRP', 'Catalog_Price', 'catalog_price', 'Τιμοκατάλογος', 'τιμοκατάλογος']
  },
  { 
    fileColumn: 'Stock_On_Hand', 
    appField: 'Stock Level', 
    usedIn: 'Product Intelligence, Total SKUs, Strategy',
    alternatives: ['Stock_On_Hand', 'Stock On Hand', 'stock_on_hand', 'Stock_Level', 'stock_level', 'Stock', 'stock', 'Quantity', 'quantity', 'Qty', 'qty', 'Inventory', 'inventory', 'On_Hand', 'on_hand', 'Units', 'units', 'Απόθεμα', 'απόθεμα', 'Ποσότητα', 'ποσότητα', 'Available_Stock', 'available_stock', 'Δυναμικό_Υπόλοιπο', 'δυναμικό_υπόλοιπο', 'Κίνηση', 'κίνηση']
  },
  {
    fileColumn: 'Available_Stock',
    appField: 'Available stock',
    usedIn: 'Stock availability, competitive overlays',
    alternatives: ['Available_Stock', 'Available Stock', 'available_stock', 'Sellable_Stock', 'sellable_stock', 'Free_Stock', 'free_stock', 'Διαθέσιμο_Απόθεμα', 'διαθέσιμο_απόθεμα']
  },
  { 
    fileColumn: 'Qty_Sold_Period', 
    appField: 'Qty sold', 
    usedIn: 'Optional, analytics',
    alternatives: ['Qty_Sold_Period', 'Qty Sold Period', 'qty_sold_period', 'Qty_Sold', 'qty_sold', 'Quantity_Sold', 'quantity_sold', 'Πωλήσεις', 'πωλήσεις', 'Sales', 'sales', 'Sold', 'sold', 'Units_Sold', 'units_sold']
  },
  { 
    fileColumn: 'Revenue_Period', 
    appField: 'Revenue', 
    usedIn: 'Strategy composite score, prioritization',
    alternatives: ['Revenue_Period', 'Revenue Period', 'revenue_period', 'Revenue', 'revenue']
  },
  { 
    fileColumn: 'Stock_Age_Days', 
    appField: 'Stock Age', 
    usedIn: 'Product Intelligence, Strategy (stock_clearance)',
    alternatives: ['Stock_Age_Days', 'Stock Age Days', 'stock_age_days', 'Age_Days', 'age_days', 'Days_In_Stock', 'days_in_stock', 'Stock_Age', 'stock_age', 'Age', 'age', 'MST_(ημέρες)', 'mst_(ημέρες)']
  },
  { 
    fileColumn: 'First_Available_Date', 
    appField: 'Stock Age (αν λείπει Stock_Age_Days)', 
    usedIn: 'Υπολογισμός: σήμερα − ημερομηνία',
    alternatives: ['First_Available_Date', 'First Available Date', 'first_available_date', 'First_Available', 'first_available', 'Available_Date', 'available_date', 'Date_Added', 'date_added', 'Created_Date', 'created_date', 'Creation_Date', 'creation_date', 'Inventory_Date', 'inventory_date', 'Data', 'data', 'Ημερομηνία', 'ημερομηνία', 'Ημ/νία', 'ημ/νία']
  },
  {
    fileColumn: 'Last_Sale_Date',
    appField: 'Last sale date',
    usedIn: 'Velocity and lifecycle reading',
    alternatives: ['Last_Sale_Date', 'Last Sale Date', 'last_sale_date', 'Last_Sale_At', 'last_sale_at', 'Last_Sold_Date', 'last_sold_date', 'Τελευταία_Πώληση', 'τελευταία_πώληση', 'Τελευταια_Πωληση', 'τελευταια_πωληση']
  },
  { 
    fileColumn: 'Gross_Margin_%', 
    appField: 'Gross Margin %', 
    usedIn: 'Product Intelligence, Strategy profit score',
    alternatives: ['Gross_Margin_%', 'Gross Margin %', 'gross_margin_%', 'Margin_Percentage', 'margin_percentage', 'Margin_Pct', 'margin_pct', 'Margin', 'margin', 'Margin_%', 'margin_%', 'Gross_Margin', 'gross_margin', 'Profit_Margin', 'profit_margin', 'Κέρδος', 'κέρδος', 'Περιθώριο', 'περιθώριο', 'Μικτό_Κέρδος', 'μικτό_κέρδος']
  },
  { 
    fileColumn: 'Sell_Price + Cost_Price', 
    appField: 'Gross Margin % (αν λείπει Gross_Margin_%)', 
    usedIn: 'Υπολογισμός: (Sell−Cost)/Sell × 100',
    alternatives: ['Υπολογίζεται αυτόματα αν υπάρχουν Sell_Price και Cost_Price']
  },
  { 
    fileColumn: 'Margin_Tier', 
    appField: 'Margin tier', 
    usedIn: 'Strategy, Badge (high/medium/low)',
    alternatives: ['Margin_Tier', 'Margin Tier', 'margin_tier', 'Margin_Category', 'margin_category', 'Tier', 'tier']
  },
  { 
    fileColumn: 'Priority_Flag', 
    appField: 'Priority Tag', 
    usedIn: 'Product Intelligence, Strategy strategic score',
    alternatives: ['Priority_Flag', 'Priority Flag', 'priority_flag', 'Priority_Tag', 'priority_tag', 'Priority', 'priority', 'Tag', 'tag', 'Label', 'label', 'Alerts', 'alerts', 'Κατάσταση', 'κατάσταση']
  },
  { 
    fileColumn: 'Supplier', 
    appField: 'Supplier', 
    usedIn: 'Product Intelligence, TOD per supplier',
    alternatives: ['Supplier', 'supplier', 'Vendor', 'vendor', 'Supplier_Name', 'supplier_name', 'Προμηθευτής', 'προμηθευτής', 'Vendor_Name', 'vendor_name']
  },
  {
    fileColumn: 'Reorder_Point',
    appField: 'Reorder point',
    usedIn: 'Replenishment planning',
    alternatives: ['Reorder_Point', 'Reorder Point', 'reorder_point', 'Min_Stock', 'min_stock', 'Safety_Stock', 'safety_stock', 'Σημείο_Αναπαραγγελίας', 'σημείο_αναπαραγγελίας']
  },
  {
    fileColumn: 'Reorder_Qty',
    appField: 'Reorder quantity',
    usedIn: 'Replenishment planning',
    alternatives: ['Reorder_Qty', 'Reorder Qty', 'reorder_qty', 'Reorder_Quantity', 'reorder_quantity', 'Order_Qty', 'order_qty', 'Ποσότητα_Αναπαραγγελίας', 'ποσότητα_αναπαραγγελίας']
  },
  {
    fileColumn: 'ABC_Class',
    appField: 'ABC class',
    usedIn: 'Commercial prioritization',
    alternatives: ['ABC_Class', 'ABC Class', 'abc_class', 'ABC', 'abc', 'Abc_Class']
  },
  {
    fileColumn: 'Flow_Group',
    appField: 'Flow group',
    usedIn: 'Commercial grouping',
    alternatives: ['Flow_Group', 'Flow Group', 'flow_group', 'Product_Segment', 'product_segment', 'Segment', 'segment', 'Ομάδα_Ροής', 'ομάδα_ροής']
  },
  {
    fileColumn: 'Seasonality_Tag',
    appField: 'Seasonality',
    usedIn: 'Seasonal strategy',
    alternatives: ['Seasonality_Tag', 'Seasonality Tag', 'seasonality_tag', 'Seasonality', 'seasonality', 'Season_Tag', 'season_tag', 'Εποχικότητα', 'εποχικότητα']
  },
] as const;

export function isSupportedFile(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

export type ImportType = 'products' | 'segments' | 'campaigns' | 'analytics' | 'organic' | 'custom' | 'procurement';

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
  /** Optional phase label for multi-stage imports (e.g. procurement). */
  phase?: string;
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
  
  // Try to find header row (for campaigns and products)
  if (cleanedRows.length > 2) {
    const headerKeywords = type === 'campaigns'
      ? ['campaign', 'month', 'impressions', 'clicks', 'cost', 'conversions', 'roas', 'purchases', 'spent', 'amount spent', 'purchase roas', 'reporting starts', 'result type']
      : ['sku_id', 'sku', 'product_name', 'product', 'name', 'category', 'sell_price', 'price', 'stock_on_hand', 'stock', 'cost_price', 'cost', 'revenue', 'margin', 'quantity', 'item', 'id', 'title', 'item_id'];
    
    let bestMatch = 0;
    let bestScore = 0;
    
    for (let i = 0; i < Math.min(10, cleanedRows.length); i++) {
      const row = cleanedRows[i];
      if (!row || row.length === 0) continue;
      
      const rowText = row.join(' ').toLowerCase().replace(/[_\s]/g, ' ');
      const score = headerKeywords.filter(keyword => {
        const normalizedKeyword = keyword.toLowerCase().replace(/[_\s]/g, ' ');
        return rowText.includes(normalizedKeyword);
      }).length;
      
      // Check if row looks like data (has large numbers) - headers shouldn't
      const hasLargeNumbers = row.some(cell => {
        const str = String(cell).trim();
        const num = parseFloat(str);
        return !isNaN(num) && num > 1000;
      });
      
      // Check if row looks like a date range or title (e.g., "january_1,_2025_-_january_31,_2026" or "Product report")
      const looksLikeTitleOrDateRange = row.some(cell => {
        const str = String(cell).toLowerCase();
        return str.includes('january') || str.includes('february') || str.includes('march') || 
               str.includes('report') || str.includes('product report') ||
               (str.includes('2025') && str.includes('2026')) || 
               str.match(/\d{4}[_-]\d{1,2}[_-]\d{1,2}/);
      });
      
      // Prefer rows with high keyword match, no large numbers, and no title/date ranges
      if (score > bestScore && !hasLargeNumbers && !looksLikeTitleOrDateRange) {
        bestScore = score;
        bestMatch = i;
      }
    }
    
    const minScore = type === 'campaigns' ? 3 : 2; // Products need at least 2 header keywords
    if (bestScore >= minScore) {
      return cleanedRows.slice(bestMatch);
    }
  }
  
  return cleanedRows;
}

const GOOGLE_NS = 'http://base.google.com/ns/1.0';

/** Parse Google Merchant/Ads XML feed to Record<string, string>[] */
function parseGoogleFeedXml(xmlText: string): Record<string, string>[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error(`XML parse error: ${parseErr.textContent}`);

  const entries = doc.getElementsByTagName('entry');
  const rows: Record<string, string>[] = [];
  const text = (el: Element | null) => (el?.textContent ?? '').trim();

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const byLocal = (local: string, ns = GOOGLE_NS) =>
      entry.getElementsByTagNameNS(ns, local)[0];
    const row: Record<string, string> = {
      id: text(byLocal('id')),
      item_group_id: text(byLocal('item_group_id')),
      title: text(entry.getElementsByTagName('title')[0]),
      price: text(byLocal('price')),
      sale_price: text(byLocal('sale_price')),
      description: text(entry.getElementsByTagName('description')[0]),
      product_type: text(byLocal('product_type')),
      google_product_category: text(byLocal('google_product_category')),
      availability: text(byLocal('availability')),
      brand: text(byLocal('brand')),
      image_link: text(byLocal('image_link')),
      link: text(entry.getElementsByTagName('link')[0]),
      size: text(byLocal('size')),
      size_type: text(byLocal('size_type')),
      size_system: text(byLocal('size_system')),
      material: text(byLocal('material')),
      custom_label_0: text(byLocal('custom_label_0')),
      condition: text(byLocal('condition')),
      gender: text(byLocal('gender')),
    };
    rows.push(row);
  }
  return rows;
}

/** Skroutz merchant XML: repeated <product> nodes (see developer.skroutz.gr XML feed). */
function parseSkroutzFeedXml(xmlText: string): Record<string, string>[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'text/xml');
  const parseErr = doc.querySelector('parsererror');
  if (parseErr) throw new Error(`XML parse error: ${parseErr.textContent}`);

  let products = doc.getElementsByTagName('product');
  if (products.length === 0) {
    products = doc.getElementsByTagName('skroutz_product');
  }

  const rows: Record<string, string>[] = [];

  const childText = (parent: Element, ...names: string[]): string => {
    const want = new Set(names.map((n) => n.toLowerCase()));
    for (let i = 0; i < parent.children.length; i++) {
      const c = parent.children[i];
      const tag = c.tagName.replace(/^.*:/, '').toLowerCase();
      if (want.has(tag)) {
        const v = (c.textContent ?? '').trim();
        if (v) return v;
      }
    }
    for (const n of names) {
      const els = parent.getElementsByTagName(n);
      if (els.length > 0) {
        const v = (els[0].textContent ?? '').trim();
        if (v) return v;
      }
    }
    return '';
  };

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const row: Record<string, string> = {
      unique_id: childText(p, 'unique_id', 'UniqueID', 'id', 'sku', 'mpn'),
      name: childText(p, 'name', 'title'),
      price: childText(p, 'price', 'Price'),
      link: childText(p, 'link', 'url', 'permalink'),
      image: childText(p, 'image', 'imageurl', 'image_url', 'thumbnail', 'picture'),
      category: childText(p, 'category', 'category_name', 'product_type'),
      manufacturer: childText(p, 'manufacturer', 'brand'),
      brand: childText(p, 'brand', 'manufacturer'),
      availability: childText(p, 'availability', 'stock', 'instock', 'quantity'),
      description: childText(p, 'description', 'short_description'),
      ean: childText(p, 'ean', 'barcode', 'gtin'),
    };
    rows.push(row);
  }
  return rows;
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

/** Get objects from XML (Google Merchant/Ads or Skroutz). Returns null for non-XML. */
async function getObjectsFromXmlFile(
  file: File,
  feedSourceType?: FeedSourceType
): Promise<Record<string, string>[] | null> {
  if (!file.name.toLowerCase().endsWith('.xml')) return null;
  const text = await file.text();
  if (feedSourceType === 'skroutz') return parseSkroutzFeedXml(text);
  return parseGoogleFeedXml(text);
}

// Convert CSV rows to objects (supports finding header row for campaigns and products)
function csvToObjects(csvRows: string[][], type?: ImportType): Record<string, string>[] {
  if (csvRows.length === 0) return [];
  
  // Try to find header row if first row doesn't look like headers
  let headerRowIndex = 0;
  if (csvRows.length > 1) {
    const headerKeywords = type === 'campaigns' 
      ? ['campaign', 'month', 'impressions', 'clicks', 'cost', 'conversions', 'roas', 'purchases', 'spent', 'amount spent', 'purchase roas', 'reporting starts', 'result type']
      : ['sku', 'product', 'name', 'category', 'price', 'stock', 'cost', 'revenue', 'margin', 'quantity', 'item', 'id', 'title', 'item_id', 'κωδικός', 'περιγραφή', 'ομάδα', 'τιμή', 'διαθεσιμότητα', 'απόθεμα'];
    
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
    
    const minScore = type === 'campaigns' ? 3 : 2; // Products need at least 2 header keywords
    if (bestScore >= minScore) {
      headerRowIndex = bestMatch;
    }
  }
  
  const headers = csvRows[headerRowIndex].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  
  // Debug: Log detected headers for products
  if (type === 'products' && import.meta.env.MODE === 'development') {
    console.debug('[csvToObjects] Detected headers for products:', headers);
    console.debug('[csvToObjects] Looking for:', ['stock_on_hand', 'stock_level', 'stock', 'quantity', 'sell_price', 'price', 'cost_price', 'cost', 'gross_margin_%', 'margin_percentage', 'stock_age_days', 'age_days']);
  }
  
  const objects: Record<string, string>[] = [];

  for (let i = headerRowIndex + 1; i < csvRows.length; i++) {
    const row = csvRows[i];
    if (row.length === 0 || !row.some(cell => cell !== '')) continue;
    
    // Skip rows that look like headers or date ranges (all text, no numbers)
    // But be more lenient for campaigns - Meta files have date ranges in data rows
    const rowText = row.join(' ').toLowerCase();
    const headerKeywords = type === 'campaigns' 
      ? ['campaign', 'month', 'impressions', 'clicks']
      : ['sku', 'product', 'name', 'category', 'price', 'stock'];
    const hasHeaderKeywords = headerKeywords.some(k => rowText.includes(k));
    
    // For campaigns, only skip if it's clearly a duplicate header row (has header keywords but no data AND is right after header row)
    if (type === 'campaigns') {
      const hasData = row.some(cell => {
        const str = String(cell).trim();
        // Check for numbers (purchases, conversions, amounts, etc.)
        const num = parseFloat(str);
        return str && (!isNaN(num) && num > 0);
      });
      // Only skip if it's a duplicate header row (has header keywords but no data AND is right after header row)
      // Don't skip rows with date ranges for campaigns - they're part of the data (e.g., "2025-01-01 - 2025-01-31")
      if (hasHeaderKeywords && !hasData && i === headerRowIndex + 1) {
        continue;
      }
      // For campaigns, always include rows that have data (numbers), even if they contain date ranges
      if (!hasData) {
        // Skip empty rows or rows with only text (no numbers)
        continue;
      }
    } else {
      // For products, skip date ranges
      const looksLikeDateRange = row.some(cell => {
        const str = String(cell).toLowerCase();
        return str.includes('january') || str.includes('february') || str.includes('march') || 
               str.includes('2025') || str.includes('2026') || str.match(/\d{4}[_-]\d{1,2}[_-]\d{1,2}/);
      });
      const hasData = row.some(cell => {
        const str = String(cell).trim();
        return str && (!isNaN(parseFloat(str)) || str.match(/^\d{4}-\d{2}-\d{2}/));
      });
      if ((hasHeaderKeywords && !hasData && i === headerRowIndex + 1) || looksLikeDateRange) {
        continue;
      }
    }
    
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      const cell = row[index];
      obj[header] = (cell != null ? String(cell).trim() : '') || '';
    });
    
    // Debug: Log first few rows for products
    if (type === 'products' && objects.length < 3 && import.meta.env.MODE === 'development') {
      const relevantKeys = ['item_id', 'title', 'stock_on_hand', 'stock_level', 'stock', 'quantity', 'sell_price', 'price', 'cost_price', 'cost', 'gross_margin_%', 'margin_percentage', 'stock_age_days', 'age_days'];
      const relevantObj = Object.fromEntries(Object.entries(obj).filter(([k]) => relevantKeys.some(rk => k.includes(rk) || rk.includes(k))));
      console.debug(`[csvToObjects] Row ${objects.length + 1} relevant fields:`, relevantObj);
    }
    
    objects.push(obj);
  }

  return objects;
}

/** Map feed row to app schema using feed source config. Handles availability→stock_level, price stripping. */
function mapFeedRowToAppRow(row: Record<string, string>, feedSourceType: FeedSourceType): Record<string, string> {
  const config = FEED_SOURCE_CONFIG[feedSourceType];
  const appRow: Record<string, string> = {};
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '_');
  const rowByNorm = Object.fromEntries(Object.entries(row).map(([k, v]) => [norm(k), v]));

  for (const { feedColumn, appField } of config.columnAliases) {
    const feedKey = norm(feedColumn);
    const val = row[feedColumn] ?? rowByNorm[feedKey] ?? '';
    if (val === undefined || val === '') continue;

    const strVal = String(val).trim();
    if (appField === 'stock_level' && feedColumn.toLowerCase() === 'availability') {
      const v = strVal.toLowerCase();
      appRow[appField] = v.includes('in stock') || v === 'in_stock' ? '1' : '0';
    } else if (appField === 'price') {
      appRow[appField] = strVal.replace(/[^\d.,-]/g, '').replace(',', '.') || strVal;
    } else {
      appRow[appField] = strVal;
    }
  }
  return appRow;
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
  const date = coerceToDate(val.trim());
  if (!date) return null;
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / 86400000);
}

// Gross margin % from Sell_Price and Cost_Price when Gross_Margin_% empty
function calcGrossMarginPct(sellPrice: number, costPrice: number): number | null {
  if (sellPrice <= 0) return null;
  return ((sellPrice - costPrice) / sellPrice) * 100;
}

function parseLooseNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  let normalized = raw
    .replace(/[€$£%\s]/g, '')
    .replace(/\u00a0/g, '')
    .replace(/[−–—]/g, '-');

  if (!normalized) return 0;

  const hasComma = normalized.includes(',');
  const hasDot = normalized.includes('.');
  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = /^-?\d{1,3}(,\d{3})+$/.test(normalized)
      ? normalized.replace(/,/g, '')
      : normalized.replace(',', '.');
  } else if (hasDot && /^-?\d{1,3}(\.\d{3})+$/.test(normalized)) {
    normalized = normalized.replace(/\./g, '');
  }

  return parseFloat(normalized) || 0;
}

// Validate and transform Products
// Primary schema: FINAL_Unified_Production_Schema (SKU_ID, Product_Name, Category, Sell_Price, Cost_Price, Stock_On_Hand, Qty_Sold_Period, Revenue_Period, Supplier, Brand, First_Available_Date, Last_Sale_Date, Priority_Flag, Stock_Age_Days, Gross_Profit, Gross_Margin_%, Margin_Tier)
function validateProduct(row: Record<string, string>, index: number): { valid: boolean; data?: Product; error?: string } {
  // Debug: Log available keys for first few rows
  if (index < 3) {
    console.log(`[Product Row ${index}] Available keys (${Object.keys(row).length}):`, Object.keys(row));
    const relevantKeys = Object.keys(row).filter(k => 
      k.includes('stock') || k.includes('price') || k.includes('cost') || 
      k.includes('margin') || k.includes('age') || k.includes('quantity') ||
      k.includes('item') || k.includes('title') || k.includes('sku')
    );
    console.log(`[Product Row ${index}] Relevant keys:`, relevantKeys);
    console.log(`[Product Row ${index}] Relevant values:`, Object.fromEntries(relevantKeys.map(k => [k, row[k]])));
  }
  
  // Headers are normalized: "Title" -> "title", "Item ID" -> "item_id"
  // Greek headers: "Κωδικός" -> "κωδικός", "Περιγραφή" -> "περιγραφή"
  // Note: Normalize converts spaces to underscores and lowercases, so "Τιμή αγοράς" -> "τιμή_αγοράς"
  // Greek headers FIRST for priority (normalized: "Κωδικός" -> "κωδικός", "Περιγραφή" -> "περιγραφή")
  const name = pick(row, 'περιγραφή', 'title', 'name', 'product_name', 'product', 'Title', 'item', 'item_name', 'description', 'product_title', 'όνομα', 'προϊόν');
  const sku = pick(row, 'κωδικός', 'item_id', 'sku', 'sku_id', 'id', 'product_id', 'Item ID', 'item id', 'Item_ID', 'code', 'barcode', 'ean');
  const category = pick(row, 'ομάδα', 'category', 'product_category', 'product_type', 'group', 'κατηγορία', 'type', 'department');
  const subcategory = pick(row, 'subcategory', 'sub_category', 'sub-category', 'υποκατηγορία');
  const brand = pick(row, 'brand', 'manufacturer', 'vendor_brand', 'μάρκα');
  const barcode = pick(row, 'barcode', 'gtin', 'ean', 'upc');
  const status = pick(row, 'status', 'product_status', 'item_status', 'κατάσταση_προϊόντος');
  const marginTier = pick(row, 'margin_tier', 'margin_category', 'tier');
  const marginPct = pick(row, 'margin_percentage', 'margin_pct', 'margin', 'margin_%', 'gross_margin_%', 'gross_margin', 'gross_margin_pct', 'profit_margin', 'profit', 'κέρδος', 'περιθώριο', 'μικτό_κέρδος');
  // Stock level - Greek: "Διαθεσιμότητα" = Availability/Stock Level (normalized: "διαθεσιμότητα")
  const stockLevel = pick(row, 'διαθεσιμότητα', 'stock_on_hand', 'Stock_On_Hand', 'stock_level', 'Stock_Level', 'stock', 'Stock', 'quantity', 'Quantity', 'qty', 'Qty', 'inventory', 'Inventory', 'on_hand', 'On_Hand', 'units', 'Units', 'απόθεμα', 'ποσότητα', 'available_stock', 'Available_Stock', 'δυναμικό_υπόλοιπο', 'κίνηση', 'availability');
  const stockOnHand = pick(row, 'stock_on_hand', 'on_hand', 'stock', 'quantity', 'qty', 'inventory', 'units', 'απόθεμα', 'ποσότητα');
  const availableStock = pick(row, 'available_stock', 'sellable_stock', 'free_stock', 'διαθέσιμο_απόθεμα', 'δυναμικό_υπόλοιπο');
  const stockCapacity = pick(row, 'stock_capacity', 'capacity', 'max_stock', 'max_quantity', 'χωρητικότητα', 'επιθυμητό_απόθεμα', 'αναμενόμενα', 'Αναμενόμενα');
  const stockAge = pick(row, 'stock_age_days', 'Stock_Age_Days', 'age_days', 'Age_Days', 'days_in_stock', 'Days_In_Stock', 'stock_age', 'Stock_Age', 'age', 'Age', 'mst_(ημέρες)', 'MST_(ημέρες)');
  // Greek: "Ημ.πρώτης παραλ." = First Available Date (normalized: "ημ.πρώτης_παραλ.")
  const firstAvailableDate = pick(row, 'ημ.πρώτης_παραλ.', 'first_available_date', 'first_available', 'available_date', 'date_added', 'created_date', 'creation_date', 'inventory_date', 'ημερομηνία_πρώτης_παραλαβής');
  // Headers are normalized: "Sell Price" -> "sell_price", "Price" -> "price"
  // Greek: "Λιανικής" = Retail Price (normalized: "λιανικής"), "Χονδρικής" = Wholesale Price (normalized: "χονδρικής")
  const price = pick(row, 'λιανικής', 'χονδρικής', 'sell_price', 'Sell_Price', 'price', 'Price', 'unit_price', 'Unit_Price', 'retail_price', 'Retail_Price', 'conv._value', 'conv_value', 'conversion_value', 'τιμή', 'msrp', 'MSRP');
  const listPrice = pick(row, 'list_price', 'compare_at_price', 'compare_at', 'catalog_price', 'τιμοκατάλογος', 'msrp');
  // "cost" from campaigns could be cost_price
  // Greek: "Τιμή αγοράς" = Cost Price (normalized: "τιμή_αγοράς")
  const costPrice = pick(row, 'τιμή_αγοράς', 'cost_price', 'Cost_Price', 'cost', 'Cost', 'κόστος');
  const revenuePeriod = pick(row, 'revenue_period', 'revenue', 'revenue_period');
  const qtySoldPeriod = pick(row, 'πωλήσεις', 'qty_sold_period', 'qty_sold', 'quantity_sold', 'sales', 'sold', 'units_sold');
  const qtySoldLast7 = pick(row, 'qty_sold_last_7d', 'qty_sold_7d', 'sales_7d', 'πωλήσεις_7d', 'πωλήσεις_7ημερο');
  const qtySoldLast30 = pick(row, 'qty_sold_last_30d', 'qty_sold_30d', 'sales_30d', 'πωλήσεις_30d', 'πωλήσεις_30ημερο');
  const qtySoldLast90 = pick(row, 'qty_sold_last_90d', 'qty_sold_90d', 'sales_90d', 'πωλήσεις_90d', 'πωλήσεις_3μηνο');
  const qtySoldLifetime = pick(row, 'qty_sold_lifetime', 'lifetime_qty_sold', 'total_qty_sold', 'συνολικές_πωλήσεις');
  const lastSaleAt = pick(row, 'last_sale_at', 'last_sale_date', 'τελευταία_πώληση', 'τελευταια_πωληση');
  const priority = pick(row, 'priority_tag', 'priority_flag', 'priority', 'tag', 'label', 'alerts', 'κατάσταση');
  const supplier = pick(row, 'supplier', 'vendor', 'supplier_name', 'vendor_name', 'προμηθευτής');
  const reorderPoint = pick(row, 'reorder_point', 'min_stock', 'safety_stock', 'σημείο_αναπαραγγελίας');
  const reorderQty = pick(row, 'reorder_qty', 'reorder_quantity', 'order_qty', 'ποσότητα_αναπαραγγελίας');
  const abcClass = pick(row, 'abc_class', 'abc');
  const flowGroup = pick(row, 'flow_group', 'ομάδα_ροής');
  const productSegment = pick(row, 'product_segment', 'segment');
  const seasonalityTag = pick(row, 'seasonality_tag', 'seasonality', 'season_tag', 'εποχικότητα');

  // Debug: Log what was found
  if (index < 3) {
    console.log(`[Product Row ${index}] Found values:`, {
      name: name || '(empty)',
      sku: sku || '(empty)',
      category: category || '(empty)',
      subcategory: subcategory || '(empty)',
      brand: brand || '(empty)',
      barcode: barcode || '(empty)',
      price: price || '(empty)',
      listPrice: listPrice || '(empty)',
      costPrice: costPrice || '(empty)',
      stockLevel: stockLevel || '(empty)',
      stockOnHand: stockOnHand || '(empty)',
      availableStock: availableStock || '(empty)',
      marginPct: marginPct || '(empty)',
      stockAge: stockAge || '(empty)',
      firstAvailableDate: firstAvailableDate || '(empty)'
    });
    // Also show what pick function tried to find
    const priceKeys = ['sell_price', 'price', 'unit_price', 'retail_price', 'conv._value', 'conv_value', 'conversion_value', 'τιμή', 'msrp', 'MSRP'];
    const costKeys = ['cost_price', 'Cost_Price', 'cost', 'Cost', 'κόστος', 'Κόστος'];
    const stockKeys = ['stock_on_hand', 'Stock_On_Hand', 'stock_level', 'Stock_Level', 'stock', 'Stock', 'quantity', 'Quantity'];
    console.log(`[Product Row ${index}] Price keys found:`, priceKeys.filter(k => row[k] !== undefined && row[k] !== '').map(k => `${k}: ${row[k]}`));
    console.log(`[Product Row ${index}] Cost keys found:`, costKeys.filter(k => row[k] !== undefined && row[k] !== '').map(k => `${k}: ${row[k]}`));
    console.log(`[Product Row ${index}] Stock keys found:`, stockKeys.filter(k => row[k] !== undefined && row[k] !== '').map(k => `${k}: ${row[k]}`));
  }

  const errors: string[] = [];

  if (!sku && !name) {
    errors.push('Missing SKU/ID and Name');
  }

  if (errors.length > 0) {
    return { valid: false, error: `Row ${index + 1}: ${errors.join(', ')}` };
  }

  const rawId = sku || name.slice(0, 60) || `product-${Date.now()}-${index}`;
  const sl = (stockLevel || '').toLowerCase();
  const stockLevelNumRaw =
    sl.includes('in stock') || sl === 'in_stock' ? 1
    : sl.includes('out of stock') || sl === 'out_of_stock' ? 0
    : Math.round(parseLooseNumber(stockLevel));
  const hasStockOnHand = stockOnHand.trim() !== '';
  const hasAvailableStock = availableStock.trim() !== '';
  const stockOnHandNum = Math.round(parseLooseNumber(stockOnHand));
  const availableStockNum = Math.round(parseLooseNumber(availableStock));
  const stockLevelNum = hasAvailableStock
    ? availableStockNum
    : hasStockOnHand
      ? stockOnHandNum
      : stockLevelNumRaw;
  const stockCapacityNum = Math.round(parseLooseNumber(stockCapacity)) || 0;
  const sellPriceNum = parseLooseNumber(price);
  const listPriceNum = parseLooseNumber(listPrice);
  const costPriceNum = parseLooseNumber(costPrice);

  // Stock Age: prefer Stock_Age_Days from file, else compute from First_Available_Date
  // If neither exists, it will be calculated from createdAt (import date) when reading from Firestore
  let stockAgeDays = Math.round(parseLooseNumber(stockAge)) || 0;
  if (stockAgeDays === 0 && firstAvailableDate && firstAvailableDate.trim() !== '') {
    const computed = daysFromFirstAvailable(firstAvailableDate);
    if (computed !== null && computed >= 0) {
      stockAgeDays = computed;
    }
  }
  // If still 0, it will be calculated from createdAt when reading products from Firestore

  // Gross Margin %: use file value when present, otherwise compute from (Sell_Price - Cost_Price) / Sell_Price
  let marginPctNum = parseLooseNumber(marginPct);
  const hasFileMargin = !!(marginPct && marginPct.trim() !== '' && marginPctNum !== 0);

  // Detect decimal-form margins (e.g. 0.25 meaning 25%) and convert to percentage
  if (hasFileMargin && marginPctNum > 0 && marginPctNum < 1) {
    marginPctNum = Math.round(marginPctNum * 1000) / 10;
  }

  // Only compute margin from price/cost when the file doesn't already provide one
  if (!hasFileMargin && sellPriceNum > 0 && costPriceNum > 0) {
    const computed = calcGrossMarginPct(sellPriceNum, costPriceNum);
    if (computed !== null && computed > 0) {
      marginPctNum = Math.round(computed * 10) / 10;
    }
  }
  
  // Debug: Log calculations for first few rows
  if (index < 3) {
    console.log(`[Product Row ${index}] Calculations:`, {
      sellPriceNum,
      listPriceNum,
      costPriceNum,
      marginPctFromFile: marginPct,
      marginPctCalculated: marginPctNum,
      stockLevelFromFile: stockLevel,
      stockLevelNum,
      stockOnHandNum,
      availableStockNum,
      stockAgeFromFile: stockAge,
      stockAgeDays,
      firstAvailableDate,
      computedStockAge: stockAgeDays === 0 && firstAvailableDate ? daysFromFirstAvailable(firstAvailableDate) : null
    });
  }

  const reorderPointNum = Math.round(parseLooseNumber(reorderPoint));
  const reorderQtyNum = Math.round(parseLooseNumber(reorderQty));

  const product: Product = {
    id: sanitizeDocId(String(rawId)),
    name: name || sku,
    sku: sku || rawId,
    category: category || 'Uncategorized',
    ...(subcategory ? { subcategory } : {}),
    margin_tier: (['high', 'medium', 'low'].includes((marginTier || '').toLowerCase())
      ? (marginTier!).toLowerCase()
      : marginPctNum > 25 ? 'high' : marginPctNum > 10 ? 'medium' : 'low') as 'high' | 'medium' | 'low',
    margin_percentage: marginPctNum,
    stock_level: stockLevelNum,
    stock_capacity: stockCapacityNum || stockLevelNum || 1,
    ...(hasStockOnHand ? { stock_on_hand: stockOnHandNum } : {}),
    ...(hasAvailableStock ? { available_stock: availableStockNum } : {}),
    stock_age_days: stockAgeDays,
    price: sellPriceNum,
    ...(priority ? { priority_tag: priority } : {}),
    ...(costPrice ? { cost_price: costPriceNum } : {}),
    ...(listPrice ? { list_price: listPriceNum, compare_at_price: listPriceNum } : {}),
    ...(revenuePeriod ? { revenue_period: parseLooseNumber(revenuePeriod) } : {}),
    ...(qtySoldPeriod ? { qty_sold_period: Math.round(parseLooseNumber(qtySoldPeriod)) } : {}),
    ...(qtySoldLast7?.trim()
      ? { qty_sold_last_7d: Math.round(parseLooseNumber(qtySoldLast7)) }
      : {}),
    ...(qtySoldLast30?.trim()
      ? { qty_sold_last_30d: Math.round(parseLooseNumber(qtySoldLast30)) }
      : {}),
    ...(qtySoldLast90?.trim()
      ? { qty_sold_last_90d: Math.round(parseLooseNumber(qtySoldLast90)) }
      : {}),
    ...(qtySoldLifetime?.trim()
      ? { qty_sold_lifetime: Math.round(parseLooseNumber(qtySoldLifetime)) }
      : {}),
    ...(lastSaleAt?.trim()
      ? {
          last_sale_at:
            coerceToDate(lastSaleAt.trim())?.toISOString() ?? lastSaleAt.trim(),
        }
      : {}),
    ...(firstAvailableDate ? { first_available_date: firstAvailableDate } : {}),
    ...(supplier ? { supplier } : {}),
    ...(brand ? { brand } : {}),
    ...(barcode ? { barcode, gtin: barcode } : {}),
    ...(status ? { status } : {}),
    ...(abcClass ? { abc_class: abcClass } : {}),
    ...(flowGroup ? { flow_group: flowGroup } : {}),
    ...(productSegment ? { product_segment: productSegment } : flowGroup ? { product_segment: flowGroup } : {}),
    ...(seasonalityTag ? { seasonality_tag: seasonalityTag } : {}),
    ...(reorderPoint.trim() !== '' ? { reorder_point: reorderPointNum } : {}),
    ...(reorderQty.trim() !== '' ? { reorder_qty: reorderQtyNum } : {}),
  };

  // Debug: Log final product for first few rows
  if (index < 3) {
    console.log(`[Product Row ${index}] Final product:`, {
      id: product.id,
      name: product.name,
      margin_percentage: product.margin_percentage,
      stock_level: product.stock_level,
      stock_age_days: product.stock_age_days,
      price: product.price,
      cost_price: product.cost_price
    });
  }

  return { valid: true, data: product };
}

// Check if this is customer-level data (each row = customer) vs segment-level (each row = aggregated segment)
function isCustomerLevelData(objects: Record<string, string>[]): boolean {
  if (objects.length === 0) return false;
  const first = objects[0];
  const segmentCol = (r: Record<string, string>) =>
    pick(r, 'rfm_segment', 'segment', 'segment_name', 'name');
  const hasSegmentCol = !!segmentCol(first);
  const hasCustomerCol = !!pick(first, 'customerid', 'customer_id', 'user_id', 'client_id', 'email');
  if (!hasSegmentCol || !hasCustomerCol) return false;

  // Σύνοψη segments (π.χ. 9 γραμμές, μία ανά segment, διαφορετικά ονόματα): όχι customer-level
  if (objects.length <= 64 && objects.length > 1) {
    const names = objects.map((r) => segmentCol(r).toLowerCase().trim()).filter(Boolean);
    const unique = new Set(names);
    if (unique.size === objects.length) {
      const looksLikeCustomerMetrics = !!pick(first, 'recency', 'frequency', 'monetary', 'r_score', 'f_score', 'rfm_score');
      if (!looksLikeCustomerMetrics) return false;
    }
  }
  return true;
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

  // Behavioral fields (optional — from external analysis tool)
  const persona = pick(row, 'persona', 'behavioral_persona', 'customer_type');
  const lifecycle = pick(row, 'lifecycle_stage', 'lifecycle', 'stage');
  const purchaseFreq = pick(row, 'purchase_frequency', 'frequency_label', 'freq');
  const avgBasket = pick(row, 'avg_basket_size', 'avg_basket', 'avg_order_value', 'aov');
  const upsellScore = pick(row, 'upsell_score', 'upsell');
  const crossSellScore = pick(row, 'cross_sell_score', 'cross_sell', 'crosssell');
  const engagementScore = pick(row, 'engagement_score', 'engagement');
  const priceSens = pick(row, 'price_sensitivity', 'price_sens');
  const devicePref = pick(row, 'device_preference', 'device', 'device_pref');
  const preferredChannels = pick(row, 'preferred_channels', 'channels', 'pref_channels');
  const peakHours = pick(row, 'peak_hours', 'best_hours');
  const peakDays = pick(row, 'peak_days', 'best_days');
  const paymentMethod = pick(row, 'payment_method', 'payment');

  const hasBehavioral = persona || lifecycle || purchaseFreq || avgBasket || upsellScore || engagementScore;
  if (hasBehavioral) {
    segment.behavioral = {
      persona: persona || 'General',
      lifecycle_stage: (['new', 'active', 'loyal', 'declining', 'dormant'].includes(lifecycle?.toLowerCase() || '') ? lifecycle!.toLowerCase() : 'active') as 'new' | 'active' | 'loyal' | 'declining' | 'dormant',
      purchase_frequency: (['daily', 'weekly', 'monthly', 'quarterly', 'rare'].includes(purchaseFreq?.toLowerCase() || '') ? purchaseFreq!.toLowerCase() : 'monthly') as 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'rare',
      avg_basket_size: parseFloat(avgBasket || '0') || 60,
      upsell_score: parseFloat(upsellScore || '0') || 30,
      cross_sell_score: parseFloat(crossSellScore || '0') || 30,
      engagement_score: parseFloat(engagementScore || '0') || 40,
      price_sensitivity: (['low', 'medium', 'high'].includes(priceSens?.toLowerCase() || '') ? priceSens!.toLowerCase() : 'medium') as 'low' | 'medium' | 'high',
      device_preference: (['mobile', 'desktop', 'mixed'].includes(devicePref?.toLowerCase() || '') ? devicePref!.toLowerCase() : 'mobile') as 'mobile' | 'desktop' | 'mixed',
      preferred_channels: preferredChannels ? preferredChannels.split(/[,;|]/).map(c => c.trim()).filter(Boolean) : ['Email'],
      peak_hours: peakHours ? peakHours.split(/[,;|]/).map(h => h.trim()).filter(Boolean) : [],
      peak_days: peakDays ? peakDays.split(/[,;|]/).map(d => d.trim()).filter(Boolean) : [],
      payment_method: paymentMethod || 'Κάρτα',
      category_affinity: [],
      communication_preferences: [],
    };
  }

  // Predictive fields (optional — from external analysis tool)
  const ltv = pick(row, 'estimated_ltv', 'ltv', 'lifetime_value', 'clv');
  const churnRisk = pick(row, 'churn_risk', 'churn', 'churn_probability');
  const churnLabel = pick(row, 'churn_risk_label', 'churn_label');
  const nextPurchaseProb = pick(row, 'next_purchase_probability', 'next_purchase_prob', 'purchase_prob');
  const daysToNext = pick(row, 'days_to_next_purchase', 'days_to_next', 'next_purchase_days');
  const nextOrderValue = pick(row, 'predicted_next_order_value', 'next_order_value');
  const forecast30 = pick(row, 'revenue_forecast_30d', 'forecast_30d', 'revenue_30d');
  const forecast90 = pick(row, 'revenue_forecast_90d', 'forecast_90d', 'revenue_90d');
  const demandTrend = pick(row, 'demand_trend', 'trend');
  const retentionScore = pick(row, 'retention_score', 'retention');
  const ltvConfidence = pick(row, 'ltv_confidence', 'confidence');

  const hasPredictive = ltv || churnRisk || nextPurchaseProb || forecast30 || demandTrend;
  if (hasPredictive) {
    const churnVal = parseFloat(churnRisk || '0') || 0;
    segment.predictive = {
      estimated_ltv: parseFloat(ltv || '0') || 0,
      ltv_confidence: parseFloat(ltvConfidence || '70') || 70,
      churn_risk: churnVal,
      churn_risk_label: (['low', 'medium', 'high', 'critical'].includes(churnLabel?.toLowerCase() || '')
        ? churnLabel!.toLowerCase()
        : churnVal < 20 ? 'low' : churnVal < 50 ? 'medium' : churnVal < 75 ? 'high' : 'critical') as 'low' | 'medium' | 'high' | 'critical',
      next_purchase_probability: parseFloat(nextPurchaseProb || '50') || 50,
      days_to_next_purchase: parseInt(daysToNext || '30', 10) || 30,
      predicted_next_order_value: parseFloat(nextOrderValue || '0') || 0,
      revenue_forecast_30d: parseFloat(forecast30 || '0') || 0,
      revenue_forecast_90d: parseFloat(forecast90 || '0') || 0,
      demand_trend: (['growing', 'stable', 'declining'].includes(demandTrend?.toLowerCase() || '') ? demandTrend!.toLowerCase() : 'stable') as 'growing' | 'stable' | 'declining',
      retention_score: parseFloat(retentionScore || '50') || 50,
    };
  }

  return { valid: true, data: segment };
}

// Validate analytics row
function validateAnalyticsRow(row: Record<string, string>, index: number): { valid: boolean; data?: { id: string; date: Timestamp; total_revenue?: number; attributed_revenue?: number; attribution_rate?: number }; error?: string } {
  const date = pick(row, 'date', 'date_time', 'timestamp', 'period', 'month', 'year_month');
  const totalRevenue = pick(row, 'total_revenue', 'total revenue', 'revenue', 'total', 'total_rev', 'revenue_total');
  const attributedRevenue = pick(
    row,
    'campaigns_revenue',
    'campaigns revenue',
    'campaigns_rev',
    'attributed_revenue',
    'attributed revenue',
    'attributed',
    'attributed_rev',
    'performance_plus_revenue',
    'pp_revenue',
  );
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

// Validate organic revenue row (οργανικά έσοδα - τζίρος χωρίς campaigns)
function validateOrganicRow(row: Record<string, string>, index: number): { valid: boolean; data?: { id: string; period: string; organic_revenue: number }; error?: string } {
  const period = pick(row, 'period', 'periodo', 'month', 'μήνας', 'date', 'ημερομηνία', 'year_month');
  const revenue = pick(row, 'organic_revenue', 'organic revenue', 'revenue', 'έσοδα', 'total_revenue', 'total revenue', 'τζίρος', 'organic');

  if (!period || !period.trim()) {
    return { valid: false, error: `Row ${index + 1}: Missing period` };
  }

  const revenueNum = revenue ? parseFloat(revenue.replace(/[^0-9.-]/g, '')) : 0;
  if (isNaN(revenueNum) || revenueNum < 0) {
    return { valid: false, error: `Row ${index + 1}: Invalid organic revenue` };
  }

  const organicId = `organic-${period.trim().replace(/\s+/g, '-')}-${index}`;
  return {
    valid: true,
    data: {
      id: sanitizeDocId(organicId),
      period: period.trim(),
      organic_revenue: revenueNum,
    },
  };
}

export type CampaignChannelOverride = 'Google Ads' | 'Meta' | null;

// Validate campaign row (supports Google Ads & Meta formats)
function validateCampaignRow(
  row: Record<string, string>,
  index: number,
  fileName?: string,
  channelOverride?: CampaignChannelOverride
): { valid: boolean; data?: Campaign; error?: string } {
  // First, check if there's an explicit "Channel" column (highest priority)
  const explicitChannel = pick(row, 'channel', 'channel_name', 'source', 'platform', 'account', 'account_name', 'ad_account', 'ad_account_name', 'network', 'campaign_type');
  
  // Detect channel from column names (case-insensitive)
  // Note: Headers are normalized: "Campaign name" -> "campaign_name", "Amount spent (EUR)" -> "amount_spent_(eur)"
  const rowKeysLower = Object.keys(row).map(k => k.toLowerCase());
  const hasGoogleAdsColumns = rowKeysLower.some(k => 
    (k.includes('campaign') && (k.includes('status') || k.includes('budget') || k.includes('bid_strategy') || k.includes('bid strategy'))) ||
    k.includes('conv._value_/_cost') || k.includes('conv value / cost') || k.includes('conv_value_/_cost') ||
    k.includes('avg_cpc') || k.includes('avg. cpc') ||
    (k.includes('campaign') && k.includes('type')) ||
    k.includes('search_impression_share') || k.includes('quality_score')
  );
  
  // Meta columns: normalized headers have underscores, e.g., "campaign_name", "amount_spent", "purchase_roas"
  const hasMetaColumns = rowKeysLower.some(k => 
    (k.includes('campaign') && k.includes('name')) || 
    (k.includes('purchase') && k.includes('roas')) || 
    (k.includes('amount') && k.includes('spent')) || 
    k.includes('reporting_starts') || k.includes('reporting starts') ||
    k.includes('reporting_ends') || k.includes('reporting ends') ||
    k.includes('result_type') || k.includes('result type') ||
    k.includes('cost_per_result') || k.includes('cost per result') ||
    (k.includes('purchases') && (k.includes('conversion_value') || k.includes('conversion value'))) ||
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

  // If no explicit channel, try file name (before column detection - file name is reliable)
  const fileNameLower = (fileName || '').toLowerCase();
  const fileSuggestsGoogle = fileNameLower.includes('google') || fileNameLower.includes('google ads');
  const fileSuggestsMeta = fileNameLower.includes('meta') || fileNameLower.includes('facebook') || fileNameLower.includes('instagram');
  if (channel === 'Other') {
    if (fileSuggestsGoogle && !fileSuggestsMeta) channel = 'Google Ads';
    else if (fileSuggestsMeta && !fileSuggestsGoogle) channel = 'Meta';
  }
  
  // If still Other, detect from columns
  if (channel === 'Other') {
    if (hasGoogleAdsColumns && !hasMetaColumns) {
      channel = 'Google Ads';
    } else if (hasMetaColumns) {
      channel = 'Meta';
    } else if (hasGoogleAdsColumns) {
      channel = 'Google Ads';
    }
  }

  // Fallback: infer from campaign name or account (before we have 'name' - use pick)
  const campaignNameForChannel = pick(row, 'campaign_name', 'campaign name', 'campaign', 'name');
  const accountForChannel = pick(row, 'account', 'account_name', 'ad_account');
  const combinedForChannel = `${campaignNameForChannel || ''} ${accountForChannel || ''}`.toLowerCase();
  if (channel === 'Other' && combinedForChannel) {
    if (combinedForChannel.includes('meta') || combinedForChannel.includes('facebook') || combinedForChannel.includes('instagram') || combinedForChannel.includes('fb ') || combinedForChannel.includes('ig ')) {
      channel = 'Meta';
    } else if (combinedForChannel.includes('google') || combinedForChannel.includes('gads') || combinedForChannel.includes('search') || combinedForChannel.includes('display') || combinedForChannel.includes('shopping')) {
      channel = 'Google Ads';
    }
  }
  
  // Debug logging in development
  if (import.meta.env.MODE === 'development' && index < 3) {
    console.debug(`[Campaign Row ${index}] Channel Detection:`, {
      explicitChannel,
      hasGoogleAdsColumns,
      hasMetaColumns,
      detectedChannel: channel,
      rowKeys: Object.keys(row).slice(0, 15),
    });
  }
  
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
  // Meta uses "Amount spent (EUR)" - normalized: "amount_spent_(eur)" -> "amount_spent_eur" (parentheses removed)
  // Try normalized versions first, then fallback to other formats
  const amountSpent = pick(row, 
    'amount_spent_(eur)', 'amount_spent_eur', 'amount_spent', 'amount spent (eur)', 'amount spent (eur)',
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
  
  // Check if we have Google Ads-specific fields
  const bidStrategyValue = pick(row, 'bid strategy type', 'bid_strategy_type', 'bidding_strategy');
  const convValueCost = pick(row, 'conv. value / cost', 'conv value / cost');
  
  let finalChannel = channel;
  if (channel === 'Other') {
    // Check if we have Meta-specific fields with actual data
    const hasMetaData = (amountSpent && parseFloat(amountSpent) > 0) || 
                        (roasValue && parseFloat(roasValue) > 0) ||
                        (resultTypeValue && resultTypeValue.trim() !== '') ||
                        (purchasesValue && purchasesValue.trim() !== '');
    
    const hasGoogleAdsData = (bidStrategyValue && bidStrategyValue.trim() !== '') ||
                             (convValueCost && convValueCost.trim() !== '');
    
    if (hasMetaData && !hasGoogleAdsData) {
      finalChannel = 'Meta';
    } else if (hasGoogleAdsData && !hasMetaData) {
      finalChannel = 'Google Ads';
    } else if (fileSuggestsGoogle && !fileSuggestsMeta) {
      finalChannel = 'Google Ads';
    } else if (fileSuggestsMeta && !fileSuggestsGoogle) {
      finalChannel = 'Meta';
    }
  }

  // User override: force channel for entire file (when auto-detect fails)
  if (channelOverride) {
    finalChannel = channelOverride;
  }

  // Debug logging for final channel assignment
  if (import.meta.env.MODE === 'development' && index < 3) {
    const amountSpentNum = amountSpent ? parseFloat(amountSpent) : 0;
    const conversionValueNum = conversionValue ? parseFloat(conversionValue) : 0;
    const roasNum = roasValue ? parseFloat(roasValue) : 0;
    console.debug(`[Campaign Row ${index}] Final Channel & Values:`, {
      initialChannel: channel,
      finalChannel,
      hasMetaData: (amountSpent && parseFloat(amountSpent) > 0) || (roasValue && parseFloat(roasValue) > 0) || (resultTypeValue && resultTypeValue.trim() !== ''),
      hasGoogleAdsData: (bidStrategyValue && bidStrategyValue.trim() !== '') || (convValueCost && convValueCost.trim() !== ''),
      amountSpent_raw: amountSpent,
      amountSpent_parsed: amountSpentNum,
      conversionValue_raw: conversionValue,
      conversionValue_parsed: conversionValueNum,
      roas_raw: roasValue,
      roas_parsed: roasNum,
      calculated_roas: amountSpentNum > 0 ? conversionValueNum / amountSpentNum : 0,
      resultTypeValue,
      bidStrategyValue,
      convValueCost,
      name,
      period,
    });
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

export interface SegmentCustomerRecord {
  customerId: string;
  email?: string;
  segmentId: string;
  segmentName: string;
  recency?: number;
  frequency?: number;
  monetary?: number;
  rfmScore?: string;
}

// Aggregate customer-level rows into segments AND extract per-customer records
function aggregateCustomersToSegments(objects: Record<string, string>[]): { segments: RFMSegment[]; customersBySegment: Map<string, SegmentCustomerRecord[]> } {
  const segmentMap = new Map<string, { count: number; monetary: number; displayName: string }>();
  const customersBySegment = new Map<string, SegmentCustomerRecord[]>();

  for (const row of objects) {
    const name = pick(row, 'rfm_segment', 'segment', 'segment_name', 'name');
    if (!name) continue;

    const baseName = name.trim().replace(/\s+\d+$/, '').trim() || name.trim();
    const key = baseName.toLowerCase().replace(/\s+/g, '_');
    const displayName = baseName;
    const monetary = parseFloat(pick(row, 'monetary', 'revenue', 'revenue_share') || '0') || 0;
    const existing = segmentMap.get(key) || { count: 0, monetary: 0, displayName };
    existing.count += 1;
    existing.monetary += monetary;
    segmentMap.set(key, existing);

    // Store customer record
    const customerId = pick(row, 'customerid', 'customer_id', 'id', 'user_id', 'client_id');
    if (customerId) {
      const record: SegmentCustomerRecord = {
        customerId,
        email: pick(row, 'email', 'e-mail', 'mail') || undefined,
        segmentId: sanitizeDocId(key),
        segmentName: displayName,
        recency: parseFloat(pick(row, 'recency_days', 'recency', 'r', 'r_score') || '') || undefined,
        frequency: parseFloat(pick(row, 'frequency', 'f', 'f_score') || '') || undefined,
        monetary: monetary || undefined,
        rfmScore: pick(row, 'rfm_score', 'rfmscore', 'score') || undefined,
      };
      const list = customersBySegment.get(key) || [];
      list.push(record);
      customersBySegment.set(key, list);
    }
  }

  const totalCount = [...segmentMap.values()].reduce((s, v) => s + v.count, 0);
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

  const segments = [...segmentMap.entries()].map(([key, { count, monetary, displayName }]) => {
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

  return { segments, customersBySegment };
}

/** Preview file for products: parse, validate, return summary. For Feed mode pass feedSourceType. */
export async function previewFileForProducts(
  file: File,
  feedSourceType?: FeedSourceType
): Promise<{
  headers: string[];
  sampleRows: Record<string, string>[];
  mappedSample: Record<string, string>[];
  validCount: number;
  errorCount: number;
  totalRows: number;
  errors: string[];
  warnings: string[];
}> {
  let objects: Record<string, string>[];
  const xmlObjects = await getObjectsFromXmlFile(file, feedSourceType);
  if (xmlObjects !== null) {
    objects = xmlObjects;
    if (!feedSourceType) feedSourceType = 'google_ads';
  } else {
    const rows = await getRowsFromFile(file, 'products');
    if (rows.length < 2) {
      return {
        headers: [],
        sampleRows: [],
        mappedSample: [],
        validCount: 0,
        errorCount: 0,
        totalRows: 0,
        errors: ['File must contain header + at least one data row'],
        warnings: [],
      };
    }
    objects = csvToObjects(rows, 'products');
  }
  if (objects.length === 0) {
    return {
      headers: Object.keys(objects[0] || {}),
      sampleRows: [],
      mappedSample: [],
      validCount: 0,
      errorCount: 0,
      totalRows: 0,
      errors: ['No data rows found'],
      warnings: [],
    };
  }
  const headers = Object.keys(objects[0]).filter(Boolean);
  const PREVIEW_ROWS = 10;
  const sampleRows = objects.slice(0, PREVIEW_ROWS);
  const mappedSample = feedSourceType
    ? sampleRows.map((r) => mapFeedRowToAppRow(r, feedSourceType))
    : sampleRows;

  let validCount = 0;
  const errors: string[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < objects.length; i++) {
    const row = feedSourceType ? mapFeedRowToAppRow(objects[i], feedSourceType) : objects[i];
    const v = validateProduct(row, i);
    if (v.valid) validCount++;
    else if (v.error && errors.length < MAX_ERRORS_DISPLAY) errors.push(v.error);
  }

  if (objects.length > 0 && headers.length > 0) {
    warnings.push(`Detected ${headers.length} columns: ${headers.slice(0, 15).join(', ')}${headers.length > 15 ? '…' : ''}`);
  }

  return {
    headers,
    sampleRows,
    mappedSample,
    validCount,
    errorCount: objects.length - validCount,
    totalRows: objects.length,
    errors,
    warnings,
  };
}

const PROCUREMENT_SHEET_ORDER: ProcurementSheetType[] = [
  'inventory', 'costing', 'item_evaluation', 'customer_evaluation', 'pricing_policy', 'fiscal_year', 'statistics'
];

/** Known Greek column headers used in procurement sheets (for header row detection). */
const KNOWN_PROCUREMENT_HEADERS = new Set([
  'ΚΩΔΙΚΟΣ', 'ΠΕΡΙΓΡΑΦΗ', 'ΚΑΤΗΓΟΡΙΑ', 'ΠΡΟΜΗΘΕΥΤΗΣ',
  'ΟΜΑΔΑ ΡΟΗΣ', 'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ', 'STATUS ΚΩΔΙΚΟΥ',
  'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ', 'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ Μ.Μ.',
  'ΔΕΥΤΕΡΟΓΕΝΕΣ ΚΟΣΤΟΣ', 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ', 'ΔΥΝΑΜΙΚΟ ΥΠΟΛΟΙΠΟ',
  'ΣΥΝΟΛΙΚΕΣ ΠΩΛΗΣΕΙΣ', 'ΚΙΒΩΤΟΛΟΓΙΟ', 'ΑΞΙΟΛΟΓΗΣΗ', 'ΒΑΘΜΟΛΟΓΙΑ',
  'ΑΞΙΟΛΟΓΗΣΗ ΑΝΑ ΔΕΙΚΤΗ', 'ΕΠΩΝΥΜΙΑ', 'ΚΟΣΤΟΣ ΑΓΟΡΑΣ',
  'ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ', 'ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ', 'ΤΙΜΟΚΑΤΑΛΟΓΟΣ ΒΑΣΗΣ',
  'ΕΤΑΙΡΙΚΟΣ ΚΑΤΑΛΟΓΟΣ', 'ΕΚΠΤΩΤΙΚΟΣ Α', 'ΕΚΠΤΩΤΙΚΟΣ Β', 'ΕΚΠΤΩΤΙΚΟΣ C',
  'MARKETING BASED COSTING', 'ACTIVITY BASED COSTING',
  'ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ', 'ΑΠΟΛΟΓΙΣΤΙΚΟ ΚΕΡΔΟΣ',
  'ΠΡΟΤΑΣΗ ΤΙΜΟΛΟΓΙΑΚΗΣ ΠΟΛΙΤΙΚΗΣ', 'ΜΕΣΟ ΚΟΣΤΟΣ ΚΑΤΗΓΟΡΙΑΣ',
  'ΠΟΣΟΤΗΤΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ', 'ΑΞΙΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ',
  'ΠΟΣΟΤΗΤΑ ΑΜΕΣΗΣ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ', 'ΠΟΣΟΤΗΤΑ ΠΡΟΣ ΠΡΟΩΘΗΣΗ',
  'ΗΜΕΡΕΣ ΕΠΑΡΚΕΙΑΣ ΔΙΑΘΕΣΙΜΟΥ ΑΠΟΘΕΜΑΤΟΣ',
  'ΑΝΑΛΥΣΗ ΚΟΣΤΟΥΣ ΑΝΑ ΔΡΑΣΤΗΡΙΟΤΗΤΑ',
  'ΣΤΑΤΙΣΤΙΚΑ ΑΝΑ ΠΕΡΙΟΔΟ', 'ΣΤΑΤΙΣΤΙΚΑ ΑΝΑ ΠΕΡΙΟΔΟ (ΜΗΝΑΣ)',
]);

/**
 * Detects which row in the cleaned array contains the actual column headers.
 * Handles common XLSX variations:
 *  - Row 0 = headers (standard)
 *  - Row 0 = numeric column IDs → Row 1 = headers
 *  - Row 0 = title/blank → Row 1 = headers
 *  - Scans up to the first 5 rows to find the best header candidate
 */
function detectHeaderRow(cleaned: string[][]): number {
  const MAX_SCAN = Math.min(5, cleaned.length - 1);

  // Score each candidate row: how many cells match known header names
  let bestIdx = 0;
  let bestScore = -1;

  for (let r = 0; r < MAX_SCAN; r++) {
    const cells = cleaned[r].filter(c => c !== '');
    if (cells.length === 0) continue;

    // Count known header matches
    const knownHits = cells.filter(c => KNOWN_PROCUREMENT_HEADERS.has(c.toUpperCase())).length;

    // Count how many cells are purely text (not numbers)
    const textCells = cells.filter(c => isNaN(Number(c)));

    // Heuristic score: known header matches are worth 10 points each,
    // text cells (non-numeric) are worth 1 point each.
    // A row with many known headers wins. A text-heavy row beats a numeric row.
    const score = knownHits * 10 + textCells.length;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = r;
    }
  }

  // Fallback checks if bestIdx is still 0
  if (bestIdx === 0) {
    const cells = cleaned[0].filter(c => c !== '');
    const allNumeric = cells.length > 0 && cells.every(c => !isNaN(Number(c)));
    const singleCell = cells.length <= 1 && cleaned.length >= 3;
    if ((allNumeric || singleCell) && cleaned.length >= 3) {
      bestIdx = 1;
    }
  }

  return bestIdx;
}

/** Import procurement Excel (7 sheets). Replaces all data; saves snapshot before replace (max 5 per brand). */
async function importProcurementFile(
  file: File,
  brandId: string | null | undefined,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportResult> {
  const result: ImportResult = { success: true, imported: 0, failed: 0, errors: [], warnings: [] };
  if (!brandId) {
    result.success = false;
    result.errors.push('Απαιτείται brand');
    return result;
  }

  const emitPhase = (phase: string, rowsProcessed = 0, totalRows = 1) => {
    onProgress?.({ rowsProcessed, totalRows, batchIndex: 0, totalBatches: 1, fileName: file.name, phase });
  };

  try {
    // ── Phase 1: Parse XLSX (client-side, fast) ──────────────────────────
    emitPhase('Ανάγνωση αρχείου…');
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });

    // Pre-parse all sheets
    const parsedSheets: { sheetType: ProcurementSheetType; coll: string; headers: string[]; objects: Record<string, string>[] }[] = [];
    let grandTotalRows = 0;

    for (let i = 0; i < PROCUREMENT_SHEET_ORDER.length; i++) {
      const sheetType = PROCUREMENT_SHEET_ORDER[i];
      const sheetName = PROCUREMENT_SHEET_NAMES[sheetType];
      const coll = PROCUREMENT_COLLECTIONS[i];
      const sheet = wb.Sheets[sheetName];

      if (!sheet) {
        result.warnings.push(`Φύλλο "${sheetName}" δεν βρέθηκε· παράλειψη.`);
        continue;
      }

      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: '' }) as string[][];
      const cleaned = rows.map(r => (Array.isArray(r) ? r : [r]).map(c => String(c ?? '').trim()));

      if (cleaned.length < 2) {
        result.warnings.push(`Φύλλο "${sheetName}": χρειάζεται header + τουλάχιστον 1 γραμμή.`);
        continue;
      }

      const headerRowIdx = detectHeaderRow(cleaned);
      const headers = cleaned[headerRowIdx].map(h => String(h || '').trim());
      const dataRows = cleaned.slice(headerRowIdx + 1).filter(r => r.some(c => c !== ''));

      const objects: Record<string, string>[] = dataRows.map(row => {
        const obj: Record<string, string> = {};
        headers.forEach((h, idx) => {
          if (!h) return;
          obj[h] = row[idx] != null ? String(row[idx]).trim() : '';
        });
        return obj;
      });

      grandTotalRows += objects.length;
      parsedSheets.push({ sheetType, coll, headers, objects });
    }

    // ── Phase 2: Delete old + Insert new (per sheet) ─────────────────────
    let totalImported = 0;

    for (const { sheetType, coll, objects } of parsedSheets) {
      const collKey = coll as (typeof PROCUREMENT_COLLECTIONS)[number];

      if (objects.length === 0) {
        await ProcurementService.deleteAll(collKey, brandId);
        continue;
      }

      emitPhase(`Διαγραφή παλιών: ${sheetType}…`, totalImported, grandTotalRows);
      await ProcurementService.deleteAll(collKey, brandId);

      const ts = Date.now();
      const items = objects.map((row, idx) => ({
        id: `${sheetType}_${idx}_${ts}`,
        data: { ...row, rowIndex: idx, sheetType } as Record<string, unknown>
      }));

      const batches = chunk(items, BATCH_SIZE);

      // Write batches with concurrency for speed
      await runWithConcurrency(batches, BATCH_CONCURRENCY, async (batch, b) => {
        await ProcurementService.batchSet(collKey, batch, brandId);
        totalImported += batch.length;
        onProgress?.({
          rowsProcessed: totalImported, totalRows: grandTotalRows,
          batchIndex: b, totalBatches: batches.length,
          fileName: file.name, phase: `Εγγραφή: ${sheetType}`,
        });
      });
    }

    result.imported = totalImported;
  } catch (err) {
    result.success = false;
    result.errors.push(err instanceof Error ? err.message : String(err));
  }
  return result;
}

// Main import function (CSV or XLSX). Pass brandId for multi-tenant scoping.
export async function importFile(
  file: File,
  type: ImportType,
  onProgress?: (p: ImportProgress) => void,
  brandId?: string | null,
  feedSourceType?: FeedSourceType,
  campaignChannelOverride?: CampaignChannelOverride,
  appendCampaigns?: boolean
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
      result.errors.push(`Unsupported file type. Use .csv, .xlsx ή .xml (Google Ads ή Skroutz feed)`);
      return result;
    }

    if (type === 'procurement') {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        result.success = false;
        result.errors.push('Procurement απαιτεί αρχείο .xlsx με 7 καρτέλες (PROCUREMENT_TEMPLATE)');
        return result;
      }
      return importProcurementFile(file, brandId, onProgress);
    }

    let objects: Record<string, string>[];
    const xmlObjects = await getObjectsFromXmlFile(file, feedSourceType);
    if (xmlObjects !== null) {
      objects = xmlObjects;
      if (type === 'products' && !feedSourceType) feedSourceType = 'google_ads';
    } else {
      const rows = await getRowsFromFile(file, type);
      if (rows.length < 2) {
        result.success = false;
        result.errors.push('File must contain at least a header row and one data row');
        return result;
      }
      objects = csvToObjects(rows, type);
    }
    
    if (objects.length === 0) {
      result.success = false;
      result.errors.push('No data rows found in CSV');
      return result;
    }

    // Log detected headers as a warning for debugging (use actual headers from objects, not raw rows)
    if (objects.length > 0) {
      const detectedHeaders = Object.keys(objects[0]).filter(Boolean);
      if (detectedHeaders.length > 0) {
        result.warnings.push(`Detected columns: ${detectedHeaders.slice(0, 20).join(', ')}${detectedHeaders.length > 20 ? ` ... (+${detectedHeaders.length - 20} more)` : ''}`);
      }
      
      // Debug: Log first row for products to help diagnose matching issues
      if (type === 'products' && objects.length > 0) {
        const firstRowKeys = Object.keys(objects[0]);
        const firstRowSample = Object.fromEntries(Object.entries(objects[0]).slice(0, 10));
        console.log('[Product Import] Detected headers:', firstRowKeys);
        console.log('[Product Import] First row sample:', firstRowSample);
        result.warnings.push(`Debug: Detected ${firstRowKeys.length} columns. Sample keys: ${firstRowKeys.slice(0, 10).join(', ')}`);
      }
    }

    // Process based on type
    switch (type) {
      case 'products': {
        const validProducts: Product[] = [];
        
        for (let i = 0; i < objects.length; i++) {
          const row = feedSourceType
            ? mapFeedRowToAppRow(objects[i], feedSourceType)
            : objects[i];
          const validation = validateProduct(row, i);
          if (validation.valid && validation.data) {
            validProducts.push(validation.data);
          } else {
            result.failed++;
            if (validation.error && result.errors.length < MAX_ERRORS_DISPLAY) {
              result.errors.push(validation.error);
            }
          }
        }

        // Delete all existing products for this brand before importing new ones
        if (import.meta.env.MODE === 'development') {
          console.debug(`[Import] Deleting existing products for brandId: ${brandId}`);
        }
        await FirestoreService.deleteCollection('products', brandId);
        const productChunks = chunk(validProducts, BATCH_SIZE);
        const coll = 'products';
        let rowsProcessed = 0;
        const importTimestamp = Timestamp.now();
        
        await runWithConcurrency(productChunks, BATCH_CONCURRENCY, async (chunkItems, batchIndex) => {
          const batchItems = chunkItems.map((p) => {
            // Calculate stock age from createdAt if stock_age_days is 0 or missing
            let finalStockAgeDays = p.stock_age_days ?? 0;
            if (finalStockAgeDays === 0) {
              // Stock age = days from import date (createdAt) to today
              // Since we're importing now, stock age starts at 0 (today - today = 0)
              // But if we want to track from import date, we set it to 0 and let getStockAgeDays calculate it
              finalStockAgeDays = 0; // Will be calculated by getStockAgeDays from createdAt
            }
            
            // Use file margin when available; compute from price/cost only as fallback
            let finalMarginPct = p.margin_percentage ?? 0;
            if (finalMarginPct === 0 && p.price && p.price > 0 && p.cost_price && p.cost_price > 0) {
              const computed = calcGrossMarginPct(p.price, p.cost_price);
              if (computed !== null && computed > 0) {
                finalMarginPct = Math.round(computed * 10) / 10;
              }
            }
            
            // Debug: Log batch processing for first product in first batch
            if (batchIndex === 0 && chunkItems.indexOf(p) === 0) {
              console.log(`[Import Batch] Processing product:`, {
                id: p.id,
                name: p.name,
                price: p.price,
                cost_price: p.cost_price,
                margin_percentage_before: p.margin_percentage,
                margin_percentage_after: finalMarginPct,
                stock_level: p.stock_level,
                stock_capacity: p.stock_capacity,
                stock_age_days_before: p.stock_age_days,
                stock_age_days_after: finalStockAgeDays,
                first_available_date: p.first_available_date,
                createdAt: importTimestamp.toString()
              });
              console.log(`[Import Batch] Full product object:`, JSON.stringify(p, null, 2));
            }
            
            return {
              id: p.id,
              data: { 
                ...p, 
                stock_age_days: finalStockAgeDays,
                margin_percentage: finalMarginPct,
                createdAt: importTimestamp 
              } as Record<string, unknown>,
            };
          });
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

        // Auto-extract suppliers with TOD from imported products
        try {
          const supplierMap = new Map<string, number>();
          const rawRows = objects;
          const pickCol = (r: Record<string, string>, ...alts: string[]) => {
            for (const a of alts) {
              const k = Object.keys(r).find(rk => rk.toLowerCase().trim() === a.toLowerCase());
              if (k && r[k] != null && String(r[k]).trim()) return String(r[k]).trim();
            }
            return '';
          };
          for (const r of rawRows) {
            const sName = pickCol(r, 'supplier', 'vendor', 'supplier_name', 'προμηθευτής');
            if (!sName) continue;
            const todVal = parseInt(pickCol(r, 'tod', 'target_days', 'target_days_of_stock') || '0', 10);
            if (!supplierMap.has(sName) || (todVal > 0 && !supplierMap.get(sName))) {
              supplierMap.set(sName, todVal > 0 ? todVal : 60);
            }
          }
          if (supplierMap.size > 0) {
            const supItems = Array.from(supplierMap.entries()).map(([name, tod]) => ({
              id: name.replace(/[/\\#$.[\]]/g, '_').replace(/\s+/g, '_').slice(0, 120),
              data: { name, tod, lead_time: 0, contact: '' } as Record<string, unknown>,
            }));
            await FirestoreService.batchSet('suppliers', supItems, brandId);
            result.warnings.push(`Αυτόματη εισαγωγή ${supItems.length} προμηθευτών με TOD`);
          }
        } catch (supErr) {
          console.error('[Import] Auto-supplier extraction error:', supErr);
        }

        break;
      }

      case 'segments': {
        let validSegments: RFMSegment[];

        if (isCustomerLevelData(objects)) {
          await FirestoreService.deleteCollection('segments', brandId);
          const { segments: aggregated, customersBySegment } = aggregateCustomersToSegments(objects);
          validSegments = aggregated;
          result.warnings.push(`Aggregated ${objects.length} customers into ${validSegments.length} segments`);

          // Store customer-level data per segment for Action Pack exports
          await FirestoreService.deleteCollection('segment_customers', brandId);
          for (const [segKey, customers] of customersBySegment.entries()) {
            const segId = sanitizeDocId(segKey);
            // Chunk into docs of max 500 customers (Firestore doc size limit ~1MB)
            const CHUNK = 500;
            for (let i = 0; i < customers.length; i += CHUNK) {
              const slice = customers.slice(i, i + CHUNK);
              const chunkIndex = Math.floor(i / CHUNK);
              const docId = sanitizeDocId(`${brandId}_${segId}_${chunkIndex}`);
              await FirestoreService.setDocument('segment_customers', docId, {
                segmentId: segId,
                segmentName: slice[0]?.segmentName || segKey,
                customers: slice,
                totalInSegment: customers.length,
                chunkIndex,
                brandId,
              } as Record<string, unknown>);
            }
          }
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
            id: sanitizeDocId(`${brandId}_${s.id}`),
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

        // Delete existing analytics for this brand before importing new ones
        await FirestoreService.deleteCollection('analytics', brandId);

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

      case 'organic': {
        const validOrganic: Array<{ id: string; data: Record<string, unknown> }> = [];
        for (let i = 0; i < objects.length; i++) {
          const validation = validateOrganicRow(objects[i], i);
          if (validation.valid && validation.data) {
            validOrganic.push({
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

        await FirestoreService.deleteCollection('organic', brandId);

        const organicChunks = chunk(validOrganic, BATCH_SIZE);
        let organicProcessed = 0;
        await runWithConcurrency(organicChunks, BATCH_CONCURRENCY, async (chunkItems, batchIndex) => {
          await FirestoreService.batchSet('organic', chunkItems, brandId);
          organicProcessed += chunkItems.length;
          onProgress?.({
            rowsProcessed: organicProcessed,
            totalRows: validOrganic.length,
            batchIndex: batchIndex + 1,
            totalBatches: organicChunks.length,
            fileName: file.name,
          });
        });
        result.imported = validOrganic.length;
        if (result.failed > MAX_ERRORS_DISPLAY) {
          result.errors.push(`...and ${result.failed - MAX_ERRORS_DISPLAY} more validation errors`);
        }
        break;
      }

      case 'campaigns': {
        // Validate and transform campaigns
        const validCampaigns: Campaign[] = [];
        objects.forEach((row, i) => {
          const validation = validateCampaignRow(row, i, file.name, campaignChannelOverride ?? undefined);
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

        // Delete existing campaigns only when NOT appending (first file of multi-file import).
        // When appendCampaigns=true, we keep existing campaigns and add new ones.
        if (!appendCampaigns) {
          if (brandId) {
            try {
              const existing = await CampaignsService.getAll(brandId);
              if (existing.length > 0) {
                for (let i = 0; i < existing.length; i += BATCH_SIZE) {
                  const batch = writeBatch(db);
                  (existing as { id: string }[]).slice(i, i + BATCH_SIZE).forEach((c) => {
                    batch.delete(doc(db, 'campaigns', c.id));
                  });
                  await batch.commit();
                }
              }
            } catch (e) {
              await FirestoreService.deleteCollection('campaigns', brandId);
            }
          } else {
            await FirestoreService.deleteCollection('campaigns', brandId);
          }
        }

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
export async function getImportJobs(brandId?: string | null): Promise<ImportJob[]> {
  const jobs = await FirestoreService.getDocuments<ImportJob>('import_jobs', [], brandId);
  return jobs.map(job => ({
    ...job,
    createdAt: coerceToDate(job.createdAt as unknown) ?? new Date(0),
    completedAt: job.completedAt
      ? coerceToDate(job.completedAt as unknown) ?? undefined
      : undefined,
  }));
}

/** Πρόσφατα jobs για υπολογισμό «τελευταίας εισαγωγής» — όχι πλήρες ιστορικό (αποφυγή αργής φόρτωσης). */
const IMPORT_JOBS_LOOKBACK_FOR_LAST_DATES = 3000;

// Get last successful import date per type (for UI display)
export async function getLastImportDates(brandId: string | null | undefined): Promise<Record<string, Date>> {
  if (!brandId) return {};
  const jobs = await FirestoreService.getDocuments<ImportJob>(
    'import_jobs',
    [orderBy('createdAt', 'desc'), limit(IMPORT_JOBS_LOOKBACK_FOR_LAST_DATES)],
    brandId
  );
  const normalized = jobs.map((job) => ({
    ...job,
    createdAt:
      coerceToDate(job.createdAt as unknown) ??
      new Date(0),
  }));
  const result: Record<string, Date> = {};
  for (const job of normalized) {
    if (job.status !== 'completed' && job.status !== undefined) continue;
    const key = (job as { source?: string }).source || job.type;
    const existing = result[key];
    if (!existing || job.createdAt > existing) result[key] = job.createdAt;
    const existing2 = result[job.type];
    if (!existing2 || job.createdAt > existing2) result[job.type] = job.createdAt;
  }
  return result;
}
