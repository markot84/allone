import type { Product } from '../types';
import { getStockAgeDays } from './productUtils';
import { safeBrandName } from '../services/reportExport';

const HEADERS = ['SKU', 'Name', 'Category', 'Price', 'Margin %', 'Stock Level', 'Stock Capacity', 'Stock Age Days', 'Priority Tag'] as const;

function rowsFromProducts(products: Product[]) {
  return products.map((p) => [
    p.sku || '',
    p.name || '',
    p.category || '',
    (p.price || 0).toFixed(2),
    (p.margin_percentage || 0).toFixed(1),
    String(p.stock_level || 0),
    String(p.stock_capacity || 0),
    String(getStockAgeDays(p)),
    p.priority_tag || '',
  ]);
}

/** UTF-8 CSV download (current filters / selection). */
export function downloadProductIntelligenceCsv(products: Product[], brandName?: string) {
  const brand = safeBrandName(brandName);
  const date = new Date().toISOString().split('T')[0];
  const rows = rowsFromProducts(products);
  const csvContent = [
    ['Brand', brandName || '—'].join(','),
    ['Generated', date].join(','),
    '',
    HEADERS.join(','),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
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
export async function downloadProductIntelligenceXlsx(products: Product[], brandName?: string) {
  const XLSX = await import('xlsx');
  const brand = safeBrandName(brandName);
  const date = new Date().toISOString().split('T')[0];
  const metaRows = [['Brand', brandName || '—'], ['Generated', date], [''], [...HEADERS]];
  const rows = products.map((p) => [
    p.sku || '',
    p.name || '',
    p.category || '',
    p.price || 0,
    p.margin_percentage || 0,
    p.stock_level || 0,
    p.stock_capacity || 0,
    getStockAgeDays(p),
    p.priority_tag || '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([...metaRows, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Products');
  XLSX.writeFile(wb, `${brand}_products_export_${date}.xlsx`);
}
