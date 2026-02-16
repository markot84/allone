/**
 * Export reports to Excel. Each report type uses real data from hooks.
 */
import type { Product, RFMSegment, Campaign } from '../types';
import { getStockAgeDays } from '../utils/productUtils';

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

export async function exportReportToExcel(
  reportId: string,
  data: {
    products?: Product[];
    segments?: RFMSegment[];
    campaigns?: Campaign[];
    analyticsRecords?: Array<{ date?: unknown; total_revenue?: number; attributed_revenue?: number }>;
  }
): Promise<void> {
  const XLSX = await import('xlsx');
  const date = new Date().toISOString().split('T')[0];

  let ws: ReturnType<typeof XLSX.utils.aoa_to_sheet>;
  let sheetName: string;
  let filename: string;

  switch (reportId) {
    case 'executive': {
      const records = data.analyticsRecords ?? [];
      const campaigns = data.campaigns ?? [];
      const totalRevenue = records.reduce((s, r) => s + (r.total_revenue ?? 0), 0);
      const attributed = records.reduce((s, r) => s + (r.attributed_revenue ?? 0), 0);
      const campaignValue = campaigns.reduce((s, c) => s + (c.conversion_value ?? 0), 0);
      ws = XLSX.utils.aoa_to_sheet([
        ['Executive Summary', ''],
        ['Generated', date],
        [''],
        ['Metric', 'Value'],
        ['Total Revenue (Analytics)', totalRevenue],
        ['Attributed Revenue', attributed],
        ['Campaign Conversion Value', campaignValue],
        ['Records', records.length],
      ]);
      sheetName = 'Executive';
      filename = `executive_summary_${date}.xlsx`;
      break;
    }
    case 'segment': {
      const segments = data.segments ?? [];
      ws = XLSX.utils.aoa_to_sheet([
        ['Segment', 'Count', 'Revenue Share %', 'RFM Score', 'Description'],
        ...segments.map((s) => [s.name, s.count, s.revenue_share, s.rfm_score, s.description ?? '']),
      ]);
      sheetName = 'Segments';
      filename = `segment_performance_${date}.xlsx`;
      break;
    }
    case 'inventory': {
      const products = data.products ?? [];
      ws = XLSX.utils.aoa_to_sheet([
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
      filename = `inventory_health_${date}.xlsx`;
      break;
    }
    case 'channel': {
      const campaigns = data.campaigns ?? [];
      const byChannel: Record<string, { spent: number; value: number; count: number }> = {};
      campaigns.forEach((c) => {
        const ch = c.channel || 'Other';
        if (!byChannel[ch]) byChannel[ch] = { spent: 0, value: 0, count: 0 };
        byChannel[ch].spent += c.amount_spent ?? 0;
        byChannel[ch].value += c.conversion_value ?? 0;
        byChannel[ch].count += 1;
      });
      ws = XLSX.utils.aoa_to_sheet([
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
      filename = `channel_attribution_${date}.xlsx`;
      break;
    }
    case 'campaign': {
      const campaigns = data.campaigns ?? [];
      ws = XLSX.utils.aoa_to_sheet([
        ['Name', 'Channel', 'Period', 'Amount Spent', 'Impressions', 'Clicks', 'Conversions', 'Conversion Value', 'ROAS'],
        ...campaigns.map((c) => [
          c.name || '',
          c.channel || '',
          c.period || '',
          c.amount_spent ?? 0,
          c.impressions ?? 0,
          c.clicks ?? 0,
          c.conversions ?? 0,
          c.conversion_value ?? 0,
          c.roas ?? '-',
        ]),
      ]);
      sheetName = 'Campaigns';
      filename = `campaign_performance_${date}.xlsx`;
      break;
    }
    case 'product': {
      const products = data.products ?? [];
      ws = XLSX.utils.aoa_to_sheet([
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
      filename = `product_prioritization_${date}.xlsx`;
      break;
    }
    default:
      throw new Error(`Unknown report type: ${reportId}`);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}
