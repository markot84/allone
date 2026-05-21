import * as XLSX from 'xlsx';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, writeBatch, doc, Timestamp } from 'firebase/firestore';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Firebase config — loaded from .env.local (project root) or process.env.
// Every value is required; no hardcoded project fallbacks.
const envVars = {};
const envLocalPath = join(__dirname, '../.env.local');
if (existsSync(envLocalPath)) {
  const envContent = readFileSync(envLocalPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^VITE_FIREBASE_(\w+)=(.*)$/);
    if (match) {
      envVars[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  });
}

function reqEnv(key) {
  const v = envVars[key] || process.env[`VITE_FIREBASE_${key}`];
  if (!v) {
    throw new Error(`[import-safeblock] Missing VITE_FIREBASE_${key} (set in .env.local or env)`);
  }
  return v;
}

const firebaseConfig = {
  apiKey: reqEnv('API_KEY'),
  authDomain: reqEnv('AUTH_DOMAIN'),
  projectId: reqEnv('PROJECT_ID'),
  storageBucket: reqEnv('STORAGE_BUCKET'),
  messagingSenderId: reqEnv('MESSAGING_SENDER_ID'),
  appId: reqEnv('APP_ID'),
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Helper: Pick value from row by multiple possible column names
function pick(row, ...keys) {
  for (const key of keys) {
    const lowerKey = key.toLowerCase().replace(/\s+/g, '_');
    for (const [k, v] of Object.entries(row)) {
      const normalizedK = k.toLowerCase().replace(/\s+/g, '_').replace(/[()%]/g, '');
      if (normalizedK === lowerKey || normalizedK.includes(lowerKey) || lowerKey.includes(normalizedK)) {
        if (v !== undefined && v !== null && String(v).trim() !== '') {
          return String(v).trim();
        }
      }
    }
  }
  return null;
}

// Validate and transform product row
function validateProduct(row, index) {
  const name = pick(row, 'name', 'product_name', 'product', 'title', 'item', 'item_name', 'description', 'product_title');
  const sku = pick(row, 'sku', 'sku_id', 'id', 'product_id', 'item_id', 'code', 'barcode', 'ean');
  
  if (!name && !sku) {
    return { valid: false, error: `Row ${index + 1}: Missing SKU/ID and Name` };
  }
  
  const category = pick(row, 'category', 'product_category', 'group', 'type', 'department');
  const marginTier = pick(row, 'margin_tier', 'margin_category', 'tier');
  const marginPct = pick(row, 'margin_percentage', 'margin_pct', 'margin', 'margin_%', 'gross_margin_%', 'gross_margin', 'profit_margin');
  const stockLevel = pick(row, 'stock_level', 'stock', 'stock_on_hand', 'quantity', 'qty', 'inventory', 'on_hand', 'units');
  const stockCapacity = pick(row, 'stock_capacity', 'capacity', 'max_stock', 'max_quantity');
  const stockAge = pick(row, 'stock_age_days', 'age_days', 'days_in_stock', 'stock_age', 'age');
  const firstAvailableDate = pick(row, 'first_available_date', 'first_available', 'available_date', 'date_added', 'created_date');
  const price = pick(row, 'price', 'unit_price', 'retail_price', 'sell_price', 'msrp');
  const costPrice = pick(row, 'cost_price', 'cost');
  const revenuePeriod = pick(row, 'revenue_period', 'revenue');
  const qtySoldPeriod = pick(row, 'qty_sold_period', 'qty_sold', 'quantity_sold');
  const priorityTag = pick(row, 'priority_flag', 'priority_tag', 'priority', 'tag');
  
  // Calculate margin if not provided
  let finalMarginPct = marginPct ? parseFloat(marginPct) : null;
  if (!finalMarginPct && price && costPrice) {
    const sell = parseFloat(price);
    const cost = parseFloat(costPrice);
    if (!isNaN(sell) && !isNaN(cost) && sell > 0) {
      finalMarginPct = ((sell - cost) / sell) * 100;
    }
  }
  
  // Determine margin tier
  let finalMarginTier = marginTier?.toLowerCase();
  if (!finalMarginTier && finalMarginPct !== null) {
    if (finalMarginPct >= 25) finalMarginTier = 'high';
    else if (finalMarginPct >= 15) finalMarginTier = 'medium';
    else finalMarginTier = 'low';
  }
  
  const product = {
    name: name || sku || `Product ${index + 1}`,
    sku: sku || name || `SKU-${index + 1}`,
    category: category || 'Uncategorized',
    margin_tier: finalMarginTier || 'low',
    margin_percentage: finalMarginPct || 0,
    stock_level: stockLevel ? parseInt(stockLevel) || 0 : 0,
    stock_capacity: stockCapacity ? parseInt(stockCapacity) || 0 : 0,
    stock_age_days: stockAge ? parseInt(stockAge) || 0 : 0,
    price: price ? parseFloat(price) || 0 : 0,
    cost_price: costPrice ? parseFloat(costPrice) : undefined,
    revenue_period: revenuePeriod ? parseFloat(revenuePeriod) : undefined,
    qty_sold_period: qtySoldPeriod ? parseInt(qtySoldPeriod) : undefined,
    priority_tag: priorityTag || undefined,
    first_available_date: firstAvailableDate || undefined,
  };
  
  // Generate stable ID from SKU or name
  const idBase = (sku || name || `product-${index}`).toLowerCase().replace(/[^a-z0-9]/g, '-');
  product.id = `product-${idBase}-${index}`;
  
  return { valid: true, data: product };
}

async function findBrandId(brandName) {
  const brandsRef = collection(db, 'brands');
  const q = query(brandsRef, where('name', '==', brandName));
  const snapshot = await getDocs(q);
  
  if (snapshot.empty) {
    console.error(`Brand "${brandName}" not found. Available brands:`);
    const allBrands = await getDocs(collection(db, 'brands'));
    allBrands.forEach(doc => {
      console.log(`  - ${doc.data().name} (${doc.id})`);
    });
    return null;
  }
  
  return snapshot.docs[0].id;
}

async function deleteExistingProducts(brandId) {
  const productsRef = collection(db, 'products');
  const q = query(productsRef, where('brandId', '==', brandId));
  const snapshot = await getDocs(q);
  
  if (snapshot.empty) {
    console.log('No existing products to delete.');
    return;
  }
  
  console.log(`Deleting ${snapshot.docs.length} existing products...`);
  const batch = writeBatch(db);
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  console.log('Deleted existing products.');
}

async function importProducts(filePath, brandId) {
  console.log(`Reading Excel file: ${filePath}`);
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  
  if (rows.length < 2) {
    console.error('File must contain at least a header row and one data row');
    return;
  }
  
  // Find header row (first row with column names)
  let headerRowIndex = 0;
  for (let i = 0; i < Math.min(5, rows.length); i++) {
    const row = rows[i];
    if (Array.isArray(row) && row.some(cell => {
      const str = String(cell || '').toLowerCase();
      return str.includes('sku') || str.includes('product') || str.includes('name');
    })) {
      headerRowIndex = i;
      break;
    }
  }
  
  const headerRow = rows[headerRowIndex];
  const dataRows = rows.slice(headerRowIndex + 1);
  
  console.log(`Found ${dataRows.length} data rows`);
  console.log(`Header columns: ${headerRow.join(', ')}`);
  
  // Convert rows to objects
  const objects = dataRows.map(row => {
    const obj = {};
    headerRow.forEach((header, idx) => {
      if (header) {
        obj[String(header).trim()] = row[idx] !== undefined ? String(row[idx]).trim() : '';
      }
    });
    return obj;
  }).filter(obj => Object.keys(obj).length > 0);
  
  console.log(`Converted to ${objects.length} objects`);
  
  // Validate products
  const validProducts = [];
  const errors = [];
  
  for (let i = 0; i < objects.length; i++) {
    const validation = validateProduct(objects[i], i);
    if (validation.valid && validation.data) {
      validProducts.push(validation.data);
    } else {
      errors.push(validation.error);
      if (errors.length <= 10) {
        console.warn(`  ${validation.error}`);
      }
    }
  }
  
  console.log(`\nValidation results:`);
  console.log(`  Valid: ${validProducts.length}`);
  console.log(`  Failed: ${errors.length}`);
  
  if (validProducts.length === 0) {
    console.error('No valid products to import!');
    return;
  }
  
  // Delete existing products
  await deleteExistingProducts(brandId);
  
  // Import in batches
  const BATCH_SIZE = 500;
  let imported = 0;
  
  for (let i = 0; i < validProducts.length; i += BATCH_SIZE) {
    const batch = writeBatch(db);
    const chunk = validProducts.slice(i, i + BATCH_SIZE);
    
    chunk.forEach(product => {
      const docRef = doc(collection(db, 'products'), product.id);
      batch.set(docRef, {
        ...product,
        brandId,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    });
    
    await batch.commit();
    imported += chunk.length;
    console.log(`Imported batch: ${imported}/${validProducts.length}`);
  }
  
  console.log(`\n✅ Successfully imported ${imported} products for brand "${brandId}"`);
}

async function main() {
  const filePath = process.argv[2] || join(__dirname, '../c:/Users/mtseh/Downloads/Product report 2025 Safeblock.xlsx');
  const brandName = 'Safeblock';
  
  console.log('Importing products...');
  console.log(`File: ${filePath}`);
  console.log(`Brand: ${brandName}\n`);
  
  const brandId = await findBrandId(brandName);
  if (!brandId) {
    console.error('Brand not found. Exiting.');
    process.exit(1);
  }
  
  console.log(`Found brand ID: ${brandId}\n`);
  
  await importProducts(filePath, brandId);
  
  console.log('\n✅ Import complete!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
