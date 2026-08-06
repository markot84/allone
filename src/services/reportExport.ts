/**
 * Export reports to Excel or PDF. Each report type uses real data from hooks.
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Product, RFMSegment, Campaign } from '../types';
import { getStockAgeDays } from '../utils/productUtils';
import { formatCurrencyCompact, formatNumber } from '../utils/format';
import { getDisplayConversionValue, getDisplayConversions } from '../utils/roiUtils';
import { sanitizeRow } from '../utils/spreadsheetSafe';

export type ReportFormat = 'excel' | 'pdf';

const PDF_SUPPORTED: Record<string, boolean> = {
  executive: true,
  segment: true,
  channel: true,
  inventory: false,
  campaign: false,
  product: false,
};

const SCHEDULED_REPORTS_KEY = 'perf_plus_scheduled_reports';

export interface ScheduledReport {
  id: string;
  name: string;
  frequency: string;
  recipients: string[];
  reportType: string;
  status: 'active' | 'paused';
  createdAt: string;
}

export function getScheduledReports(): ScheduledReport[] {
  try {
    const raw = localStorage.getItem(SCHEDULED_REPORTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveScheduledReport(report: Omit<ScheduledReport, 'id' | 'createdAt'>): ScheduledReport {
  const list = getScheduledReports();
  const newReport: ScheduledReport = {
    ...report,
    id: `sched_${Date.now()}`,
    createdAt: new Date().toISOString(),
  };
  list.push(newReport);
  localStorage.setItem(SCHEDULED_REPORTS_KEY, JSON.stringify(list));
  return newReport;
}

export function deleteScheduledReport(id: string): void {
  const list = getScheduledReports().filter((r) => r.id !== id);
  localStorage.setItem(SCHEDULED_REPORTS_KEY, JSON.stringify(list));
}

export function isPdfSupported(reportId: string): boolean {
  return PDF_SUPPORTED[reportId] ?? false;
}

export function safeBrandName(name: string | undefined): string {
  return (name || 'Brand').replace(/[^a-zA-Z0-9Α-Ωα-ωά-ώ_-]/g, '_').replace(/_+/g, '_').slice(0, 40) || 'Brand';
}

type ReportExportData = {
  products?: Product[];
  segments?: RFMSegment[];
  campaigns?: Campaign[];
  organicRecords?: Array<{ period?: string; organic_revenue?: number }>;
  totalOrganicRevenue?: number;
  ecommerceRevenue?: number;
  brandName?: string;
};

function getExecutiveRevenueBreakdown(data: ReportExportData) {
  const campaigns = data.campaigns ?? [];
  const organicRevenue = data.totalOrganicRevenue ?? (data.organicRecords ?? []).reduce((s, r) => s + (r.organic_revenue ?? 0), 0);
  const campaignValue = campaigns.reduce((s, c) => s + getDisplayConversionValue(c, false), 0);
  const ecommerceRevenue = data.ecommerceRevenue ?? 0;
  const totalRevenue = ecommerceRevenue + organicRevenue + campaignValue;
  return { campaigns, organicRevenue, campaignValue, ecommerceRevenue, totalRevenue };
}

export async function exportReport(
  reportId: string,
  format: ReportFormat,
  data: ReportExportData
): Promise<void> {
  if (format === 'pdf' && !PDF_SUPPORTED[reportId]) {
    throw new Error('PDF δεν υποστηρίζεται για αυτό το report');
  }
  if (format === 'pdf') {
    return exportReportToPdf(reportId, data);
  }
  return exportReportToExcel(reportId, data);
}

async function exportReportToPdf(
  reportId: string,
  data: ReportExportData
): Promise<void> {
  const doc = new jsPDF();
  const date = new Date().toISOString().split('T')[0];
  const brand = safeBrandName(data.brandName);

  doc.setFontSize(18);
  doc.text('allone Report', 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`${brand} · Generated: ${date}`, 14, 28);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(12);

  switch (reportId) {
    case 'executive': {
      const { campaigns, organicRevenue, campaignValue, ecommerceRevenue, totalRevenue } = getExecutiveRevenueBreakdown(data);
      doc.text('Executive Summary', 14, 40);
      autoTable(doc, {
        startY: 48,
        head: [['Metric', 'Value']],
        body: [
          ['Total Revenue', formatCurrencyCompact(totalRevenue)],
          ['e-shop Revenue', formatCurrencyCompact(ecommerceRevenue)],
          ['Οργανικά Έσοδα', formatCurrencyCompact(organicRevenue)],
          ['Campaign Conversion Value', formatCurrencyCompact(campaignValue)],
          ['Περίοδοι Οργανικών', String((data.organicRecords ?? []).length)],
          ['Campaigns', String(campaigns.length)],
        ],
      });
      break;
    }
    case 'segment': {
      const segments = data.segments ?? [];
      doc.text('Segment Performance', 14, 40);
      autoTable(doc, {
        startY: 48,
        head: [['Segment', 'Count', 'Revenue Share %', 'RFM Score']],
        body: segments.map((s) => [s.name, String(s.count), String(s.revenue_share), s.rfm_score ?? '']),
      });
      break;
    }
    case 'channel': {
      const campaigns = data.campaigns ?? [];
      const byChannel: Record<string, { spent: number; value: number; count: number }> = {};
      campaigns.forEach((c) => {
        const ch = c.channel || 'Other';
        if (!byChannel[ch]) byChannel[ch] = { spent: 0, value: 0, count: 0 };
        byChannel[ch].spent += c.amount_spent ?? 0;
        byChannel[ch].value += getDisplayConversionValue(c, false);
        byChannel[ch].count += 1;
      });
      doc.text('Channel Attribution', 14, 40);
      autoTable(doc, {
        startY: 48,
        head: [['Channel', 'Campaigns', 'Spent', 'Value', 'ROAS']],
        body: Object.entries(byChannel).map(([ch, v]) => [
          ch,
          String(v.count),
          formatCurrencyCompact(v.spent),
          formatCurrencyCompact(v.value),
          v.spent > 0 ? formatNumber(v.value / v.spent, 2) : '-',
        ]),
      });
      break;
    }
    default:
      throw new Error(`PDF not supported for ${reportId}`);
  }

  doc.save(`${brand}_${reportId}_report_${date}.pdf`);
}

async function exportReportToExcel(
  reportId: string,
  data: ReportExportData
): Promise<void> {
  const XLSX = await import('xlsx');
  // Neutralize formula injection (SEC-M5) on every cell before building a sheet.
  const aoaSafe = (rows: unknown[][]) => XLSX.utils.aoa_to_sheet(rows.map(sanitizeRow));
  const date = new Date().toISOString().split('T')[0];
  const brand = safeBrandName(data.brandName);

  let ws: ReturnType<typeof XLSX.utils.aoa_to_sheet>;
  let sheetName: string;
  let filename: string;

  switch (reportId) {
    case 'executive': {
      const { campaigns, organicRevenue, campaignValue, ecommerceRevenue, totalRevenue } = getExecutiveRevenueBreakdown(data);
      ws = aoaSafe([
        ['Executive Summary', ''],
        ['Brand', data.brandName || '—'],
        ['Generated', date],
        [''],
        ['Metric', 'Value'],
        ['Total Revenue', totalRevenue],
        ['e-shop Revenue', ecommerceRevenue],
        ['Οργανικά Έσοδα', organicRevenue],
        ['Campaign Conversion Value', campaignValue],
        ['Περίοδοι Οργανικών', (data.organicRecords ?? []).length],
        ['Campaigns', campaigns.length],
      ]);
      sheetName = 'Executive';
      filename = `${brand}_executive_summary_${date}.xlsx`;
      break;
    }
    case 'segment': {
      const segments = data.segments ?? [];
      ws = aoaSafe([
        ['Brand', data.brandName || '—'],
        ['Generated', date],
        [''],
        ['Segment', 'Count', 'Revenue Share %', 'RFM Score', 'Description'],
        ...segments.map((s) => [s.name, s.count, s.revenue_share, s.rfm_score, s.description ?? '']),
      ]);
      sheetName = 'Segments';
      filename = `${brand}_segment_performance_${date}.xlsx`;
      break;
    }
    case 'inventory': {
      const products = data.products ?? [];
      ws = aoaSafe([
        ['Brand', data.brandName || '—'],
        ['Generated', date],
        [''],
        ['SKU', 'Name', 'Category', 'Price', 'Margin %', 'Stock Level', 'Stock Capacity', 'Stock Age Days', 'Priority Tag'],
        ...products.map((p) => [
          p.sku || '',
          p.name || '',
          p.category || '',
          p.price ?? 0,
          p.margin_percentage ?? 0,
          p.stock_level ?? 0,
          p.stock_capacity ?? 0,
          getStockAgeDays(p),
          p.priority_tag ?? '',
        ]),
      ]);
      sheetName = 'Inventory';
      filename = `${brand}_inventory_health_${date}.xlsx`;
      break;
    }
    case 'channel': {
      const campaigns = data.campaigns ?? [];
      const byChannel: Record<string, { spent: number; value: number; count: number }> = {};
      campaigns.forEach((c) => {
        const ch = c.channel || 'Other';
        if (!byChannel[ch]) byChannel[ch] = { spent: 0, value: 0, count: 0 };
        byChannel[ch].spent += c.amount_spent ?? 0;
        byChannel[ch].value += getDisplayConversionValue(c, false);
        byChannel[ch].count += 1;
      });
      ws = aoaSafe([
        ['Brand', data.brandName || '—'],
        ['Generated', date],
        [''],
        ['Channel', 'Campaigns', 'Amount Spent', 'Conversion Value', 'ROAS'],
        ...Object.entries(byChannel).map(([ch, v]) => [
          ch,
          v.count,
          v.spent,
          v.value,
          v.spent > 0 ? (v.value / v.spent).toFixed(2) : '-',
        ]),
      ]);
      sheetName = 'Channels';
      filename = `${brand}_channel_attribution_${date}.xlsx`;
      break;
    }
    case 'campaign': {
      const campaigns = data.campaigns ?? [];
      ws = aoaSafe([
        ['Brand', data.brandName || '—'],
        ['Generated', date],
        [''],
        ['Name', 'Channel', 'Period', 'Amount Spent', 'Impressions', 'Clicks', 'Conversions', 'Conversion Value', 'ROAS'],
        ...campaigns.map((c) => [
          c.name || '',
          c.channel || '',
          c.period || '',
          c.amount_spent ?? 0,
          c.impressions ?? 0,
          c.clicks ?? 0,
          getDisplayConversions(c, false),
          getDisplayConversionValue(c, false),
          c.amount_spent ? (getDisplayConversionValue(c, false) / c.amount_spent).toFixed(2) : '-',
        ]),
      ]);
      sheetName = 'Campaigns';
      filename = `${brand}_campaign_performance_${date}.xlsx`;
      break;
    }
    case 'product': {
      const products = data.products ?? [];
      ws = aoaSafe([
        ['Brand', data.brandName || '—'],
        ['Generated', date],
        [''],
        ['SKU', 'Name', 'Category', 'Price', 'Margin %', 'Stock Level', 'Stock Age Days', 'Priority Tag', 'Margin Tier'],
        ...products.map((p) => [
          p.sku || '',
          p.name || '',
          p.category || '',
          p.price ?? 0,
          p.margin_percentage ?? 0,
          p.stock_level ?? 0,
          getStockAgeDays(p),
          p.priority_tag ?? '',
          p.margin_tier ?? '',
        ]),
      ]);
      sheetName = 'Products';
      filename = `${brand}_product_prioritization_${date}.xlsx`;
      break;
    }
    default:
      throw new Error(`Unknown report type: ${reportId}`);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
