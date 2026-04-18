import type { PriceBenchmark } from '../hooks/usePriceBenchmarks';
import type { PriceInsight } from '../hooks/usePriceInsights';

export type InventoryCell = { stock: number | null; sold: number | null } | null;

function escapeCsvCell(v: string): string {
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatEur(n: number): string {
  return n.toLocaleString('el-GR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pctLabel(fraction: number): string {
  const pct = Math.round(fraction * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function downloadText(filename: string, mime: string, body: string): void {
  const blob = new Blob(['\ufeff' + body], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportBenchmarksCsv(
  rows: PriceBenchmark[],
  lookup: (productId: string, gtin: string) => InventoryCell,
  filename: string
): void {
  const headers = [
    'Προϊόν',
    'Product ID',
    'Brand',
    'Στοκ',
    'Πωλήσεις',
    'Η τιμή σας',
    'Benchmark',
    'Διαφορά τιμής %',
    'GTIN',
  ];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((b) => {
      const inv = lookup(b.productId, b.gtin);
      const stock = inv?.stock;
      const sold = inv?.sold;
      return [
        b.title || b.productId,
        b.productId,
        b.brand || '',
        typeof stock === 'number' ? String(stock) : '',
        typeof sold === 'number' ? String(sold) : '',
        formatEur(b.yourPrice),
        b.benchmarkPrice > 0 ? formatEur(b.benchmarkPrice) : '',
        String(b.priceDiff),
        b.gtin || '',
      ]
        .map(escapeCsvCell)
        .join(',');
    }),
  ];
  downloadText(filename, 'text/csv', lines.join('\n'));
}

export async function exportBenchmarksXlsx(
  rows: PriceBenchmark[],
  lookup: (productId: string, gtin: string) => InventoryCell,
  filename: string
): Promise<void> {
  const XLSX = await import('xlsx');
  const data: (string | number)[][] = [
    ['Προϊόν', 'Product ID', 'Brand', 'Στοκ', 'Πωλήσεις', 'Η τιμή σας', 'Benchmark', 'Διαφορά τιμής %', 'GTIN'],
    ...rows.map((b) => {
      const inv = lookup(b.productId, b.gtin);
      const stock = inv?.stock;
      const sold = inv?.sold;
      return [
        b.title || b.productId,
        b.productId,
        b.brand || '',
        typeof stock === 'number' ? stock : '',
        typeof sold === 'number' ? sold : '',
        b.yourPrice,
        b.benchmarkPrice > 0 ? b.benchmarkPrice : '',
        b.priceDiff,
        b.gtin || '',
      ];
    }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Benchmarks');
  XLSX.writeFile(wb, filename);
}

export function exportInsightsCsv(
  rows: PriceInsight[],
  sellerLabel: string,
  lookup: (productId: string, gtin: string) => InventoryCell,
  filename: string
): void {
  const headers = [
    'Προϊόν',
    'Product ID',
    'Πωλητής',
    'Brand',
    'Στοκ',
    'Πωλήσεις',
    'Τρέχουσα τιμή',
    'Προτεινόμενη τιμή',
    'Διαφορά τιμής %',
    'Impr. lift %',
    'Clicks lift %',
    'Conv. lift %',
  ];
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((i) => {
      const inv = lookup(i.productId, '');
      const stock = inv?.stock;
      const sold = inv?.sold;
      return [
        i.title || i.productId,
        i.productId,
        sellerLabel,
        i.brand || '',
        typeof stock === 'number' ? String(stock) : '',
        typeof sold === 'number' ? String(sold) : '',
        formatEur(i.currentPrice),
        formatEur(i.suggestedPrice),
        String(i.priceDiffPercent),
        pctLabel(i.predictedImpressionsChange),
        pctLabel(i.predictedClicksChange),
        pctLabel(i.predictedConversionsChange),
      ]
        .map(escapeCsvCell)
        .join(',');
    }),
  ];
  downloadText(filename, 'text/csv', lines.join('\n'));
}

export async function exportInsightsXlsx(
  rows: PriceInsight[],
  sellerLabel: string,
  lookup: (productId: string, gtin: string) => InventoryCell,
  filename: string
): Promise<void> {
  const XLSX = await import('xlsx');
  const data: (string | number)[][] = [
    [
      'Προϊόν',
      'Product ID',
      'Πωλητής',
      'Brand',
      'Στοκ',
      'Πωλήσεις',
      'Τρέχουσα τιμή',
      'Προτεινόμενη τιμή',
      'Διαφορά τιμής %',
      'Impr. lift',
      'Clicks lift',
      'Conv. lift',
    ],
    ...rows.map((i) => {
      const inv = lookup(i.productId, '');
      const stock = inv?.stock;
      const sold = inv?.sold;
      return [
        i.title || i.productId,
        i.productId,
        sellerLabel,
        i.brand || '',
        typeof stock === 'number' ? stock : '',
        typeof sold === 'number' ? sold : '',
        i.currentPrice,
        i.suggestedPrice,
        i.priceDiffPercent,
        i.predictedImpressionsChange,
        i.predictedClicksChange,
        i.predictedConversionsChange,
      ];
    }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Price Insights');
  XLSX.writeFile(wb, filename);
}
