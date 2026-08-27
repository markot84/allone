import type { Product } from '../types';
import { getDaysOfStock, getStockAgeDays } from './productUtils';
import { safeBrandName } from '../services/reportExport';
import { sanitizeSpreadsheetCell, sanitizeRow } from './spreadsheetSafe';

// Mirrors the PI table columns (Brand + DOS, not the raw stock_age_days the UI never shows).
const HEADERS = ['SKU', 'Name', 'Category', 'Brand', 'Margin %', 'Stock Level', 'DOS', 'Tag', 'Price', 'Value (€)', 'Stock Capacity', 'Stock Age Days'] as const;

function dosCell(p: Product): string {
  const dos = getDaysOfStock(p);
  return dos === Number.POSITIVE_INFINITY ? '∞' : String(Math.round(dos));
}

// PER-323: additive per row (group rows carry the children's sum) — the column total matches the cards.
function valueCell(p: Product): number {
  return Math.round((p.stock_value ?? Math.max(0, (p.price || 0) * (p.stock_level || 0))) * 100) / 100;
}

// Range groups export as a string; single-price rows stay numeric so spreadsheet math keeps working.
function priceCell(p: Product): string | number {
  return p.price_min != null && p.price_max != null && p.price_min < p.price_max
    ? `${p.price_min.toFixed(2)}–${p.price_max.toFixed(2)}`
    : Math.round((p.price || 0) * 100) / 100;
}

function rowsFromProducts(products: Product[]) {
  return products.map((p) => [
    p.sku || '',
    p.name || '',
    p.category || '',
    p.brand || '',
    (p.margin_percentage || 0).toFixed(1),
    String(p.stock_level || 0),
    dosCell(p),
    p.priority_tag || '',
    priceCell(p),
    String(valueCell(p)),
    String(p.stock_capacity || 0),
    String(getStockAgeDays(p)),
  ]);
}

/** PER-318: [label, value] rows describing active filters/grouping/sort so the file self-explains. */
export type ExportMeta = Array<[string, string]>;

/** UTF-8 CSV download (current filters / selection). */
export function downloadProductIntelligenceCsv(products: Product[], brandName?: string, meta?: ExportMeta) {
  const brand = safeBrandName(brandName);
  const date = new Date().toISOString().split('T')[0];
  const rows = rowsFromProducts(products);
  const csvContent = [
    ['Brand', sanitizeSpreadsheetCell(brandName || '—')].join(','),
    ['Generated', date].join(','),
    ...(meta ?? []).map((row) => row.map((cell) => `"${String(sanitizeSpreadsheetCell(cell)).replace(/"/g, '""')}"`).join(',')),
    '',
    HEADERS.join(','),
    // Neutralize formula injection (SEC-M5) per cell before CSV quoting.
    ...rows.map((row) => row.map((cell) => `"${String(sanitizeSpreadsheetCell(cell)).replace(/"/g, '""')}"`).join(',')),
  ].join('\n');

  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `${brand}_products_export_${date}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** .xlsx download (current filters / selection). */
export async function downloadProductIntelligenceXlsx(products: Product[], brandName?: string, meta?: ExportMeta) {
  const XLSX = await import('xlsx');
  const brand = safeBrandName(brandName);
  const date = new Date().toISOString().split('T')[0];
  const metaRows = [['Brand', brandName || '—'], ['Generated', date], ...(meta ?? []), [''], [...HEADERS]];
  const rows = products.map((p) => [
    p.sku || '',
    p.name || '',
    p.category || '',
    p.brand || '',
    p.margin_percentage || 0,
    p.stock_level || 0,
    dosCell(p),
    p.priority_tag || '',
    priceCell(p),
    valueCell(p),
    p.stock_capacity || 0,
    getStockAgeDays(p),
  ]);
  const ws = XLSX.utils.aoa_to_sheet([...metaRows, ...rows].map(sanitizeRow));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  XLSX.writeFile(wb, `${brand}_products_export_${date}.xlsx`);
}
