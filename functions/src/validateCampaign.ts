import { pick } from './parseFile';

export interface CampaignData {
  id: string;
  name: string;
  channel: string;
  status: string;
  period: string;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  amount_spent: number;
  roas: number;
  start_date?: string;
  end_date?: string;
}

function sanitizeDocId(value: string): string {
  return value.replace(/[/\\]/g, '_').trim() || `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function validateCampaign(
  row: Record<string, string>,
  index: number,
  channelOverride?: string
): { valid: boolean; data?: CampaignData; error?: string } {
  const name = pick(row, 'campaign_name', 'campaign name', 'campaign', 'name');
  if (!name) {
    return { valid: false, error: `Row ${index + 1}: Missing campaign name` };
  }

  const impressions = parseFloat(pick(row, 'impressions', 'impr', 'impr.') || '0') || 0;
  const clicks = parseFloat(pick(row, 'clicks', 'link_clicks', 'link clicks') || '0') || 0;
  const conversions = parseFloat(pick(row, 'conversions', 'results', 'purchases', 'purchase', 'conv.') || '0') || 0;
  const spent = parseFloat(
    (pick(row, 'amount_spent', 'amount spent', 'cost', 'spend', 'spent', 'amount_spent_(eur)') || '0')
      .replace(/[^\d.,-]/g, '').replace(',', '.')
  ) || 0;
  const ctr = parseFloat(
    (pick(row, 'ctr', 'ctr_(link_click-through_rate)', 'click-through_rate') || '0').replace('%', '').replace(',', '.')
  ) || (impressions > 0 ? (clicks / impressions) * 100 : 0);
  const roas = parseFloat(
    (pick(row, 'roas', 'purchase_roas', 'purchase roas', 'return_on_ad_spend') || '0').replace(',', '.')
  ) || 0;

  const channel = channelOverride || detectChannel(name);
  const status = pick(row, 'status', 'delivery', 'campaign_status') || 'active';
  const period = pick(row, 'period', 'month', 'reporting_starts', 'date_range', 'date') || '';
  const startDate = pick(row, 'start_date', 'reporting_starts', 'date_start');
  const endDate = pick(row, 'end_date', 'reporting_ends', 'date_stop');

  const campaign: CampaignData = {
    id: sanitizeDocId(`${name}_${period || index}`),
    name,
    channel,
    status,
    period,
    impressions,
    clicks,
    ctr: Math.round(ctr * 100) / 100,
    conversions,
    amount_spent: spent,
    roas: Math.round(roas * 100) / 100,
    ...(startDate ? { start_date: startDate } : {}),
    ...(endDate ? { end_date: endDate } : {}),
  };

  return { valid: true, data: campaign };
}

function detectChannel(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('google') || lower.includes('search') || lower.includes('pmax') || lower.includes('shopping'))
    return 'Google Ads';
  if (lower.includes('meta') || lower.includes('facebook') || lower.includes('instagram') || lower.includes('fb'))
    return 'Meta';
  if (lower.includes('tiktok')) return 'TikTok';
  if (lower.includes('email') || lower.includes('newsletter')) return 'Email';
  return 'Other';
}
