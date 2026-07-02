import { type Firestore, FieldValue } from 'firebase-admin/firestore';
import { supplierDocId } from './erpConnectorFirestore';
import { logger } from './utils/logger';

const WRITE_BATCH_SIZE = 500;
const DELETE_BATCH_SIZE = 400;
export const MEGAVENTORY_NORMALIZED_SOURCE = 'megaventory_custom_report';

export interface MegaventoryNormalizationCounts {
  products: number;
  suppliers: number;
  procurement_inventory: number;
  procurement_pricing_policy: number;
  procurement_item_evaluation: number;
}

type WriteItem = {
  id: string;
  data: Record<string, unknown>;
};

function sanitizeFirestoreDocId(raw: string): string {
  let s = String(raw ?? '').trim();
  if (!s) s = '_';
  s = s.replace(/\//g, '_').replace(/\\/g, '_');
  s = s.replace(/[\u0000-\u001F\u007F]/g, '_');
  if (s === '.' || s === '..') s = '_dot_';
  if (s.length > 1500) s = s.slice(0, 1500);
  return s;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  return s === '-' ? '' : s;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = text(value).replace(/[€$£%]/g, '').replace(/\s+/g, '');
  if (!raw) return null;
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  let normalized = raw;
  if (lastDot >= 0 && lastComma >= 0) {
    normalized = lastComma > lastDot
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (lastComma >= 0) {
    normalized = raw.replace(',', '.');
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function cleanNumber(value: unknown): number | undefined {
  const n = numberOrNull(value);
  return n === null ? undefined : n;
}

function cleanDate(value: unknown): string | undefined {
  const s = text(value);
  if (!s) return undefined;

  const mvMatch = s.match(/\/Date\((-?\d+)(?:[+-]\d+)?\)\//);
  if (mvMatch) {
    const millis = Number(mvMatch[1]);
    if (Number.isFinite(millis)) {
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }

  const date = new Date(s);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  return s;
}

function splitCategory(category: string, subCategory: string): { category: string; procurementCategory: string } {
  const parts = category.split('/').map((p) => p.trim()).filter(Boolean);
  const procurementCategory = subCategory || parts.at(-1) || category;
  return {
    category: procurementCategory || category,
    procurementCategory,
  };
}

function marginTier(rawTier: string, marginPct?: number): 'high' | 'medium' | 'low' | undefined {
  const tier = rawTier.toLowerCase();
  if (['high', 'medium', 'low'].includes(tier)) return tier as 'high' | 'medium' | 'low';
  if (typeof marginPct !== 'number') return undefined;
  if (marginPct > 30) return 'high';
  if (marginPct > 15) return 'medium';
  return 'low';
}

function priorityTag(priority: string, abcClass: string): string | undefined {
  const p = priority || abcClass;
  if (!p) return undefined;
  return p;
}

async function deleteMegaventoryNormalizedRows(db: Firestore, collectionName: string, brandId: string): Promise<number> {
  let deleted = 0;
  for (;;) {
    const snap = await db
      .collection(collectionName)
      .where('brandId', '==', brandId)
      .where('source', '==', MEGAVENTORY_NORMALIZED_SOURCE)
      .limit(DELETE_BATCH_SIZE)
      .get();
    if (snap.empty) break;

    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();
    deleted += snap.size;
    if (snap.size < DELETE_BATCH_SIZE) break;
  }
  return deleted;
}

async function writeItems(db: Firestore, collectionName: string, brandId: string, items: WriteItem[]): Promise<void> {
  for (let i = 0; i < items.length; i += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const item of items.slice(i, i + WRITE_BATCH_SIZE)) {
      const data = Object.fromEntries(
        Object.entries(item.data).filter(([, value]) => value !== undefined),
      );
      batch.set(
        db.collection(collectionName).doc(sanitizeFirestoreDocId(item.id)),
        {
          ...data,
          brandId,
          source: MEGAVENTORY_NORMALIZED_SOURCE,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
}

export async function normalizeMegaventoryCustomReportRows(
  db: Firestore,
  brandId: string,
  reportRows: Record<string, unknown>[],
): Promise<MegaventoryNormalizationCounts> {
  // suppliers deliberately NOT delete-recreated: user-edited tod/lead_time must survive syncs (PER-183)
  const collections = [
    'products',
    'procurement_inventory',
    'procurement_pricing_policy',
    'procurement_item_evaluation',
  ];
  await Promise.all(collections.map((collection) => deleteMegaventoryNormalizedRows(db, collection, brandId)));

  const productItems: WriteItem[] = [];
  const inventoryItems: WriteItem[] = [];
  const pricingItems: WriteItem[] = [];
  const evaluationItems: WriteItem[] = [];
  const suppliers = new Map<string, WriteItem>();

  for (const row of reportRows) {
    const sku = text(row.SKU_ID);
    if (!sku) continue;

    const productName = text(row.Product_Name) || sku;
    const categoryRaw = text(row.Category);
    const subCategory = text(row.SubCategory);
    const { category, procurementCategory } = splitCategory(categoryRaw, subCategory);
    const supplier = text(row.Supplier);
    const status = text(row.Status);
    const abcClass = text(row.ABC_Class);
    const flowGroup = text(row.Flow_Group);
    const priority = text(row.Priority_Flag);
    const seasonality = text(row.Seasonality_Tag);
    const sellPrice = cleanNumber(row.Sell_Price);
    const listPrice = cleanNumber(row.List_Price);
    const costPrice = cleanNumber(row.Cost_Price);
    const stockOnHand = cleanNumber(row.Stock_On_Hand);
    const availableStock = cleanNumber(row.Available_Stock);
    const qtySold = cleanNumber(row.Qty_Sold_Period);
    const revenue = cleanNumber(row.Revenue_Period);
    const stockAgeDays = cleanNumber(row.Stock_Age_Days);
    const reorderPoint = cleanNumber(row.Reorder_Point);
    const reorderQty = cleanNumber(row.Reorder_Qty);
    const marginPct = cleanNumber(row['Gross_Margin_%']);
    const resolvedMarginTier = marginTier(text(row.Margin_Tier), marginPct);
    const firstAvailableDate = cleanDate(row.First_Available_Date);
    const lastSaleDate = cleanDate(row.Last_Sale_Date);
    const stock = availableStock ?? stockOnHand ?? 0;

    productItems.push({
      id: `mv_report_product_${brandId}_${sku}`,
      data: {
        id: sku,
        sku,
        name: productName,
        category,
        procurement_category: procurementCategory,
        brand: text(row.Brand),
        barcode: text(row.Barcode),
        supplier,
        price: sellPrice ?? listPrice ?? 0,
        list_price: listPrice ?? null,
        cost_price: costPrice ?? null,
        margin_percentage: marginPct ?? null,
        margin_tier: resolvedMarginTier ?? null,
        stock_level: stock,
        stock_on_hand: stockOnHand ?? null,
        available_stock: availableStock ?? null,
        stock_capacity: Math.max(stock * 2, stock),
        stock_age_days: stockAgeDays ?? null,
        qty_sold_lifetime: qtySold ?? null,
        revenue_period: revenue ?? null,
        last_sale_at: lastSaleDate ?? null,
        first_available_date: firstAvailableDate ?? null,
        procurement_status: status || undefined,
        priority_tag: priorityTag(priority, abcClass),
        reorder_point: reorderPoint ?? null,
        reorder_qty: reorderQty ?? null,
        abc_class: abcClass,
        flow_group: flowGroup,
        seasonality_tag: seasonality,
      },
    });

    inventoryItems.push({
      id: `mv_report_inventory_${brandId}_${sku}`,
      data: {
        ΚΩΔΙΚΟΣ: sku,
        ΠΕΡΙΓΡΑΦΗ: productName,
        ΚΑΤΗΓΟΡΙΑ: procurementCategory || category,
        ΠΡΟΜΗΘΕΥΤΗΣ: supplier,
        ΟΜΑΔΑ_ΡΟΗΣ: flowGroup,
        ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ: abcClass || priority,
        STATUS_ΚΩΔΙΚΟΥ: status,
        ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ_Μ_Μ: costPrice ?? '',
        ΔΙΑΘΕΣΙΜΟ_ΥΠΟΛΟΙΠΟ: availableStock ?? stockOnHand ?? '',
        ΔΥΝΑΜΙΚΟ_ΥΠΟΛΟΙΠΟ: stockOnHand ?? availableStock ?? '',
        ΣΥΝΟΛΙΚΕΣ_ΠΩΛΗΣΕΙΣ: qtySold ?? '',
        ΗΜΕΡΕΣ_ΕΠΑΡΚΕΙΑΣ_ΔΙΑΘΕΣΙΜΟΥ_ΑΠΟΘΕΜΑΤΟΣ: '',
        ΠΟΣΟΤΗΤΑ_ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ: reorderQty ?? '',
        ΑΞΙΑ_ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ: costPrice !== undefined && reorderQty !== undefined ? +(costPrice * reorderQty).toFixed(2) : '',
        Reorder_Point: reorderPoint ?? '',
        Seasonality_Tag: seasonality,
        First_Available_Date: firstAvailableDate ?? '',
        Last_Sale_Date: lastSaleDate ?? '',
      },
    });

    pricingItems.push({
      id: `mv_report_pricing_${brandId}_${sku}`,
      data: {
        ΚΩΔΙΚΟΣ: sku,
        ΚΟΣΤΟΣ_ΑΓΟΡΑΣ: costPrice ?? '',
        ΠΡΩΤΟΓΕΝΕΣ_ΚΟΣΤΟΣ: costPrice ?? '',
        ΣΥΝΟΛΙΚΟ_ΚΟΣΤΟΣ: costPrice ?? '',
        ΑΞΙΟΛΟΓΗΣΗ_ΕΙΔΟΥΣ: abcClass || priority,
        ΜΕΣΗ_ΤΙΜΗ_ΠΩΛΗΣΗΣ: sellPrice ?? '',
        ΤΙΜΟΚΑΤΑΛΟΓΟΣ_ΒΑΣΗΣ: listPrice ?? sellPrice ?? '',
        ΕΤΑΙΡΙΚΟΣ_ΚΑΤΑΛΟΓΟΣ: sellPrice ?? '',
        Gross_Margin_Percent: marginPct ?? '',
        Margin_Tier: resolvedMarginTier ?? '',
      },
    });

    evaluationItems.push({
      id: `mv_report_eval_${brandId}_${sku}`,
      data: {
        ΚΩΔΙΚΟΣ: sku,
        ΑΞΙΟΛΟΓΗΣΗ: abcClass || priority || resolvedMarginTier || '',
        ΒΑΘΜΟΛΟΓΙΑ: evaluationScore(abcClass, priority, marginPct),
        ABC_Class: abcClass,
        Priority_Flag: priority,
        Margin_Tier: resolvedMarginTier ?? '',
      },
    });

    if (supplier) {
      const supplierKey = supplier.toLocaleUpperCase('el-GR');
      if (!suppliers.has(supplierKey)) {
        suppliers.set(supplierKey, {
          id: supplierDocId(brandId, supplier),
          data: { name: supplier },
        });
      }
    }
  }

  await Promise.all([
    writeItems(db, 'products', brandId, productItems),
    writeItems(db, 'suppliers', brandId, Array.from(suppliers.values())),
    writeItems(db, 'procurement_inventory', brandId, inventoryItems),
    writeItems(db, 'procurement_pricing_policy', brandId, pricingItems),
    writeItems(db, 'procurement_item_evaluation', brandId, evaluationItems),
  ]);

  const counts = {
    products: productItems.length,
    suppliers: suppliers.size,
    procurement_inventory: inventoryItems.length,
    procurement_pricing_policy: pricingItems.length,
    procurement_item_evaluation: evaluationItems.length,
  };

  logger.info(`[MegaventoryNormalizer] ${brandId}: ${JSON.stringify(counts)}`);
  return counts;
}

function evaluationScore(abcClass: string, priority: string, marginPct?: number): number | '' {
  const value = (abcClass || priority).trim().toUpperCase();
  if (value === 'A') return 100;
  if (value === 'B') return 70;
  if (value === 'C') return 40;
  if (value.includes('HIGH')) return 90;
  if (value.includes('MEDIUM')) return 60;
  if (value.includes('LOW')) return 30;
  if (typeof marginPct === 'number') return Math.max(0, Math.min(100, Math.round(marginPct)));
  return '';
}
