import { pick } from './parseFile';

export interface ProductData {
  id: string;
  name: string;
  sku: string;
  category: string;
  margin_tier: 'high' | 'medium' | 'low';
  margin_percentage: number;
  stock_level: number;
  stock_capacity: number;
  stock_age_days: number;
  price: number;
  cost_price?: number;
  revenue_period?: number;
  qty_sold_period?: number;
  first_available_date?: string;
  priority_tag?: string;
  supplier?: string;
}

function sanitizeDocId(value: string): string {
  return value.replace(/[/\\]/g, '_').trim() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function daysFromFirstAvailable(val: string): number | null {
  if (!val || !val.trim()) return null;
  const n = parseFloat(val);
  let date: Date;
  if (!isNaN(n) && n > 0) {
    date = new Date((n - 25569) * 86400 * 1000);
  } else {
    date = new Date(val.trim());
  }
  if (isNaN(date.getTime())) return null;
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

function calcGrossMarginPct(sell: number, cost: number): number | null {
  if (sell <= 0) return null;
  return ((sell - cost) / sell) * 100;
}

export function validateProduct(
  row: Record<string, string>,
  index: number
): { valid: boolean; data?: ProductData; error?: string } {
  const name = pick(row, 'περιγραφή', 'title', 'name', 'product_name', 'product', 'item', 'item_name', 'description', 'product_title', 'όνομα', 'προϊόν');
  const sku = pick(row, 'κωδικός', 'item_id', 'sku', 'sku_id', 'id', 'product_id', 'code', 'barcode', 'ean');
  const category = pick(row, 'ομάδα', 'category', 'product_category', 'product_type', 'group', 'κατηγορία', 'type', 'department');
  const marginTier = pick(row, 'margin_tier', 'margin_category', 'tier');
  const marginPct = pick(row, 'margin_percentage', 'margin_pct', 'margin', 'margin_%', 'gross_margin_%', 'gross_margin', 'profit_margin', 'profit', 'κέρδος');
  const stockLevel = pick(row, 'διαθεσιμότητα', 'stock_on_hand', 'stock_level', 'stock', 'quantity', 'qty', 'inventory', 'on_hand', 'units', 'απόθεμα', 'ποσότητα', 'available_stock', 'δυναμικό_υπόλοιπο', 'κίνηση', 'availability');
  const stockCapacity = pick(row, 'stock_capacity', 'capacity', 'max_stock', 'max_quantity', 'χωρητικότητα', 'επιθυμητό_απόθεμα', 'αναμενόμενα');
  const stockAge = pick(row, 'stock_age_days', 'age_days', 'days_in_stock', 'stock_age', 'age', 'mst_(ημέρες)');
  const firstAvailableDate = pick(row, 'ημ.πρώτης_παραλ.', 'first_available_date', 'first_available', 'available_date', 'date_added', 'created_date', 'creation_date', 'inventory_date', 'ημερομηνία_πρώτης_παραλαβής');
  const price = pick(row, 'λιανικής', 'χονδρικής', 'sell_price', 'price', 'unit_price', 'retail_price', 'τιμή', 'msrp');
  const costPrice = pick(row, 'τιμή_αγοράς', 'cost_price', 'cost', 'κόστος');
  const revenuePeriod = pick(row, 'revenue_period', 'revenue');
  const qtySoldPeriod = pick(row, 'πωλήσεις', 'qty_sold_period', 'qty_sold', 'quantity_sold', 'sales', 'sold', 'units_sold');
  const priority = pick(row, 'priority_tag', 'priority_flag', 'priority', 'tag', 'label', 'alerts', 'κατάσταση');
  const supplier = pick(row, 'supplier', 'vendor', 'supplier_name', 'vendor_name', 'προμηθευτής');

  if (!sku && !name) {
    return { valid: false, error: `Row ${index + 1}: Missing SKU and Name` };
  }

  const rawId = sku || name.slice(0, 60) || `product-${Date.now()}-${index}`;
  const sl = (stockLevel || '').toLowerCase();
  const stockLevelNum =
    sl.includes('in stock') || sl === 'in_stock' ? 1
    : sl.includes('out of stock') || sl === 'out_of_stock' ? 0
    : Math.round(parseFloat(String(stockLevel || '0').replace(',', '.')) || 0);
  const stockCapacityNum = parseInt(stockCapacity || '0', 10) || 0;
  const sellPriceNum = parseFloat(String(price || '0').replace(',', '.')) || 0;
  const costPriceNum = parseFloat(String(costPrice || '0').replace(',', '.')) || 0;

  let stockAgeDays = parseInt(stockAge || '0', 10) || 0;
  if (stockAgeDays === 0 && firstAvailableDate && firstAvailableDate.trim() !== '') {
    const computed = daysFromFirstAvailable(firstAvailableDate);
    if (computed !== null && computed >= 0) stockAgeDays = computed;
  }

  let marginPctNum = parseFloat(String(marginPct || '0').replace(',', '.')) || 0;
  if (sellPriceNum > 0 && costPriceNum > 0) {
    const computed = calcGrossMarginPct(sellPriceNum, costPriceNum);
    if (computed !== null && computed > 0 && (marginPctNum === 0 || !marginPct)) {
      marginPctNum = Math.round(computed * 10) / 10;
    }
  }

  const product: ProductData = {
    id: sanitizeDocId(String(rawId)),
    name: name || sku,
    sku: sku || rawId,
    category: category || 'Uncategorized',
    margin_tier: (['high', 'medium', 'low'].includes((marginTier || '').toLowerCase())
      ? (marginTier || 'medium').toLowerCase()
      : 'medium') as 'high' | 'medium' | 'low',
    margin_percentage: marginPctNum,
    stock_level: stockLevelNum,
    stock_capacity: stockCapacityNum || stockLevelNum || 1,
    stock_age_days: stockAgeDays,
    price: sellPriceNum,
    ...(costPrice ? { cost_price: costPriceNum } : {}),
    ...(revenuePeriod ? { revenue_period: parseFloat(String(revenuePeriod || '0').replace(',', '.')) || 0 } : {}),
    ...(qtySoldPeriod ? { qty_sold_period: Math.round(parseFloat(String(qtySoldPeriod).replace(',', '.')) || 0) } : {}),
    ...(firstAvailableDate ? { first_available_date: firstAvailableDate } : {}),
    ...(priority ? { priority_tag: priority } : {}),
    ...(supplier ? { supplier } : {}),
  };

  return { valid: true, data: product };
}
