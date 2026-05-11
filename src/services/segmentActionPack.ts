/**
 * Segment Action Pack — generates structured Excel exports
 * that bridge analysis → marketing execution.
 */
import type { RFMSegment, ChannelRecommendation } from '../types';
import { deriveBehavioralProfile, derivePredictiveMetrics } from './behavioralEngine';
import { safeBrandName } from './reportExport';
import { formatNumber } from '../utils/format';
import { SegmentCustomersService } from './firestore';

// ── Campaign template data per segment archetype ────────────────────────────

interface CampaignTemplate {
  platform: string;
  campaignType: string;
  objective: string;
  targeting: string;
  messaging: string;
  budgetGuide: string;
  kpi: string;
}

const SEGMENT_CAMPAIGN_TEMPLATES: Record<string, CampaignTemplate[]> = {
  champions: [
    { platform: 'Email / CRM', campaignType: 'Loyalty & VIP', objective: 'Retention + Upsell', targeting: 'Champions segment list', messaging: 'Exclusive early access, VIP perks, loyalty rewards', budgetGuide: '5-8% of budget', kpi: 'Repeat purchase rate, AOV increase' },
    { platform: 'Meta Ads', campaignType: 'Lookalike Audience', objective: 'Acquisition', targeting: 'Lookalike 1-2% from Champions', messaging: 'Social proof, best-seller highlights', budgetGuide: '15-20% of budget', kpi: 'CAC, ROAS > 4x' },
    { platform: 'Google Ads', campaignType: 'RLSA (Search)', objective: 'Re-engagement', targeting: 'Champions remarketing list', messaging: 'Brand + category terms with loyalty offers', budgetGuide: '5% of budget', kpi: 'Conversion rate, ROAS' },
  ],
  loyal: [
    { platform: 'Email / CRM', campaignType: 'Cross-sell Flow', objective: 'Basket expansion', targeting: 'Loyal segment', messaging: 'Complementary products, bundles, category discovery', budgetGuide: '5% of budget', kpi: 'Items per order, cross-sell rate' },
    { platform: 'Meta Ads', campaignType: 'Retargeting DPA', objective: 'Re-engagement', targeting: 'Loyal segment — website visitors 30d', messaging: 'Dynamic product ads, personalized', budgetGuide: '10% of budget', kpi: 'ROAS > 3x, frequency < 4' },
    { platform: 'Google Shopping', campaignType: 'Smart Shopping', objective: 'Sales', targeting: 'Loyal remarketing list', messaging: 'Competitive pricing, free shipping', budgetGuide: '10% of budget', kpi: 'ROAS, impression share' },
  ],
  loyal_customers: [],
  potential: [
    { platform: 'Meta Ads', campaignType: 'Conversion Campaign', objective: 'First purchase', targeting: 'Interest-based + Lookalike 2-5%', messaging: 'Welcome offer, free shipping, social proof', budgetGuide: '20-25% of budget', kpi: 'CAC < target, CVR > 2%' },
    { platform: 'Google Ads', campaignType: 'Search + Shopping', objective: 'Capture intent', targeting: 'Category & product keywords', messaging: 'Competitive pricing, USP, promotions', budgetGuide: '15-20% of budget', kpi: 'CPC, ROAS > 2x' },
    { platform: 'Email / CRM', campaignType: 'Welcome Series', objective: 'Onboarding & 2nd purchase', targeting: 'New subscribers / first-time buyers', messaging: '3-email series: welcome → education → offer', budgetGuide: '2-3% of budget', kpi: '2nd purchase rate within 30d' },
  ],
  potential_loyalists: [],
  at_risk: [
    { platform: 'Email / CRM', campaignType: 'Win-back Flow', objective: 'Re-activation', targeting: 'At Risk segment (90-180d inactive)', messaging: 'We miss you, special comeback offer, limited time', budgetGuide: '5% of budget', kpi: 'Re-activation rate, open rate' },
    { platform: 'Meta Ads', campaignType: 'Retargeting', objective: 'Re-engagement', targeting: 'At Risk segment — custom audience', messaging: 'Personalized offer, new arrivals, urgency', budgetGuide: '8-10% of budget', kpi: 'Re-purchase rate, ROAS > 2x' },
    { platform: 'SMS', campaignType: 'Flash Offer', objective: 'Immediate re-activation', targeting: 'At Risk with phone numbers', messaging: 'Short, direct: exclusive -20% 48h only', budgetGuide: '2% of budget', kpi: 'Redemption rate' },
  ],
  hibernating: [
    { platform: 'Email / CRM', campaignType: 'Last Chance', objective: 'Re-activation or list cleanup', targeting: 'Hibernating segment', messaging: 'Final reactivation attempt, strong incentive', budgetGuide: '2% of budget', kpi: 'Re-activation rate' },
    { platform: 'Display / Remarketing', campaignType: 'Brand Awareness', objective: 'Soft re-engagement', targeting: 'Hibernating — web remarketing', messaging: 'New products, brand refresh', budgetGuide: '3% of budget', kpi: 'CTR, site return rate' },
  ],
  lost: [
    { platform: 'Meta Ads', campaignType: 'Re-engagement', objective: 'Win-back attempt', targeting: 'Lost segment custom audience', messaging: 'Dramatic offer, brand story refresh', budgetGuide: '3-5% of budget', kpi: 'Re-purchase rate' },
    { platform: 'Email / CRM', campaignType: 'Sunset Flow', objective: 'List hygiene', targeting: 'Lost segment', messaging: 'Final attempt or unsubscribe — clean list for deliverability', budgetGuide: '1% of budget', kpi: 'Unsubscribe vs re-activation ratio' },
  ],
  new_customers: [
    { platform: 'Email / CRM', campaignType: 'Post-Purchase Nurture', objective: '2nd purchase', targeting: 'New customers (first 30d)', messaging: 'Thank you, product tips, cross-sell, review request', budgetGuide: '3% of budget', kpi: '2nd purchase rate, NPS' },
    { platform: 'Meta Ads', campaignType: 'Retargeting', objective: 'Repeat purchase', targeting: 'New customers custom audience', messaging: 'Complementary products, new arrivals', budgetGuide: '8% of budget', kpi: 'ROAS, repeat rate' },
    { platform: 'Google Ads', campaignType: 'Brand Search', objective: 'Capture return visits', targeting: 'Brand keywords + RLSA new customers', messaging: 'Welcome back, loyalty program', budgetGuide: '3% of budget', kpi: 'Branded CVR' },
  ],
  recent_customers: [],
  cant_lose_them: [
    { platform: 'Email / CRM', campaignType: 'VIP Recovery', objective: 'High-value retention', targeting: "Can't Lose Them segment", messaging: 'Personal touch, exclusive offer, dedicated account manager', budgetGuide: '5% of budget', kpi: 'Re-purchase rate, response rate' },
    { platform: 'Phone / Personal', campaignType: 'Direct Outreach', objective: 'Relationship recovery', targeting: 'Top 20% by revenue in segment', messaging: 'Personal call, feedback request, bespoke offer', budgetGuide: '2% of budget', kpi: 'Retention rate, CLV recovery' },
  ],
  customers_needing_attention: [
    { platform: 'Email / CRM', campaignType: 'Engagement Flow', objective: 'Prevent churn', targeting: 'Needs Attention segment', messaging: 'Personalized recommendations, satisfaction survey', budgetGuide: '4% of budget', kpi: 'Open rate, click rate, next purchase' },
    { platform: 'Meta Ads', campaignType: 'Retargeting', objective: 'Re-engagement', targeting: 'Needs Attention custom audience', messaging: 'New arrivals, curated picks', budgetGuide: '6% of budget', kpi: 'Site revisit rate, ROAS' },
  ],
};

function getTemplatesForSegment(segment: RFMSegment): CampaignTemplate[] {
  const directMatch = SEGMENT_CAMPAIGN_TEMPLATES[segment.id];
  if (directMatch && directMatch.length > 0) return directMatch;

  const nameKey = segment.name.toLowerCase().replace(/[\s'-]+/g, '_');
  const nameMatch = SEGMENT_CAMPAIGN_TEMPLATES[nameKey];
  if (nameMatch && nameMatch.length > 0) return nameMatch;

  // Fallback based on lifecycle stage / engagement
  const behavioral = deriveBehavioralProfile(segment);
  if (behavioral.lifecycle_stage === 'loyal' || behavioral.lifecycle_stage === 'active') {
    return SEGMENT_CAMPAIGN_TEMPLATES['loyal'] || [];
  }
  if (behavioral.lifecycle_stage === 'declining') {
    return SEGMENT_CAMPAIGN_TEMPLATES['at_risk'] || [];
  }
  if (behavioral.lifecycle_stage === 'dormant') {
    return SEGMENT_CAMPAIGN_TEMPLATES['hibernating'] || [];
  }
  return SEGMENT_CAMPAIGN_TEMPLATES['potential'] || [];
}

// ── CSV helpers ─────────────────────────────────────────────────────────────

export type ExportFormat = 'xlsx' | 'csv';

function csvEscape(val: string | number): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: (string | number)[][]): string {
  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

function downloadCsv(content: string, filename: string) {
  const blob = new Blob(['\ufeff' + content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Export functions ─────────────────────────────────────────────────────────

export async function exportSegmentActionPack(
  segment: RFMSegment,
  brandName?: string,
  channelRecommendation?: ChannelRecommendation | null,
  format: ExportFormat = 'xlsx',
): Promise<void> {
  const date = new Date().toISOString().split('T')[0];
  const behavioral = deriveBehavioralProfile(segment);
  const predictive = derivePredictiveMetrics(segment);

  const profileRows: (string | number)[][] = [
    ['SEGMENT ACTION PACK', '', ''],
    ['Brand', brandName || '—', ''],
    ['Generated', date, ''],
    [''],
    ['SEGMENT PROFILE', '', ''],
    ['Name', segment.name, ''],
    ['RFM Score', segment.rfm_score || '—', ''],
    ['Customers', segment.count, ''],
    ['% of Base', `${segment.percentage}%`, ''],
    ['Revenue Share', `${segment.revenue_share}%`, ''],
    ['Description', segment.description || '', ''],
    [''],
    ['BEHAVIORAL PROFILE', '', ''],
    ['Persona', behavioral.persona, ''],
    ['Lifecycle Stage', behavioral.lifecycle_stage, ''],
    ['Purchase Frequency', behavioral.purchase_frequency, ''],
    ['Avg Basket Size', `€${behavioral.avg_basket_size}`, ''],
    ['Price Sensitivity', behavioral.price_sensitivity, ''],
    ['Device Preference', behavioral.device_preference, ''],
    ['Engagement Score', `${behavioral.engagement_score}/100`, ''],
    ['Upsell Score', `${behavioral.upsell_score}/100`, ''],
    ['Cross-sell Score', `${behavioral.cross_sell_score}/100`, ''],
    ['Preferred Channels', behavioral.preferred_channels.join(', '), ''],
    ['Peak Days', behavioral.peak_days.join(', ') || '—', ''],
    ['Peak Hours', behavioral.peak_hours.join(', ') || '—', ''],
    ['Payment Method', behavioral.payment_method, ''],
    [''],
    ['PREDICTIVE METRICS', '', ''],
    ['Estimated LTV', `€${formatNumber(predictive.estimated_ltv)}`, ''],
    ['LTV Confidence', `${Math.round(predictive.ltv_confidence)}%`, ''],
    ['Churn Risk', `${predictive.churn_risk}% (${predictive.churn_risk_label})`, ''],
    ['Next Purchase Probability', `${predictive.next_purchase_probability}%`, ''],
    ['Days to Next Purchase', predictive.days_to_next_purchase, ''],
    ['Predicted Next Order Value', `€${formatNumber(predictive.predicted_next_order_value)}`, ''],
    ['Revenue Forecast 30d', `€${formatNumber(predictive.revenue_forecast_30d)}`, ''],
    ['Revenue Forecast 90d', `€${formatNumber(predictive.revenue_forecast_90d)}`, ''],
    ['Demand Trend', predictive.demand_trend, ''],
    ['Retention Score', `${predictive.retention_score}/100`, ''],
  ];

  // Channel Plan
  const channelPlanRows: (string | number)[][] = [
    ['CHANNEL PLAN', '', '', ''],
    ['Segment', segment.name, '', ''],
    [''],
  ];

  if (channelRecommendation) {
    channelPlanRows.push(['PRIMARY CHANNELS', '', '', '']);
    (channelRecommendation.primary || []).forEach(ch => {
      const pct = channelRecommendation.budget_allocation?.[ch];
      channelPlanRows.push([ch, pct ? `${pct}%` : '', 'Primary', '']);
    });
    channelPlanRows.push(['']);
    channelPlanRows.push(['SECONDARY CHANNELS', '', '', '']);
    (channelRecommendation.secondary || []).forEach(ch => {
      const pct = channelRecommendation.budget_allocation?.[ch];
      channelPlanRows.push([ch, pct ? `${pct}%` : '', 'Secondary', '']);
    });
    channelPlanRows.push(['']);
    if (channelRecommendation.rationale) {
      channelPlanRows.push(['AI RATIONALE', '', '', '']);
      channelRecommendation.rationale.split('||').forEach(line => {
        channelPlanRows.push([line.trim(), '', '', '']);
      });
    }
    channelPlanRows.push(['']);
    if (channelRecommendation.actions && channelRecommendation.actions.length > 0) {
      channelPlanRows.push(['RECOMMENDED ACTIONS', '', '', '']);
      channelPlanRows.push(['Channel', 'Action', 'Reason', 'Suggested Change']);
      channelRecommendation.actions.forEach(a => {
        channelPlanRows.push([a.channel, a.type, a.reason, a.suggestedChange != null ? `${a.suggestedChange}%` : '']);
      });
    }
  } else {
    channelPlanRows.push(['Preferred Channels (Behavioral)', '', '', '']);
    behavioral.preferred_channels.forEach(ch => {
      channelPlanRows.push([ch, '', '', '']);
    });
  }

  // Sheet 3: Campaign Templates
  const templates = getTemplatesForSegment(segment);
  const templateRows: (string | number)[][] = [
    ['CAMPAIGN TEMPLATES', '', '', '', '', '', ''],
    ['Segment', segment.name, '', '', '', '', ''],
    [''],
    ['Platform', 'Campaign Type', 'Objective', 'Targeting', 'Messaging', 'Budget Guide', 'KPIs'],
    ...templates.map(t => [t.platform, t.campaignType, t.objective, t.targeting, t.messaging, t.budgetGuide, t.kpi]),
  ];

  if (templates.length === 0) {
    templateRows.push(['No specific templates — use Channel Plan recommendations', '', '', '', '', '', '']);
  }

  const brand = safeBrandName(brandName);
  const segName = segment.name.replace(/[\s/\\]+/g, '_');

  if (format === 'csv') {
    const allRows = [...profileRows, [''], ...channelPlanRows, [''], ...templateRows];
    downloadCsv(rowsToCsv(allRows), `${brand}_ActionPack_${segName}_${date}.csv`);
    return;
  }

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(profileRows);
  ws1['!cols'] = [{ wch: 25 }, { wch: 35 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Segment Profile');
  const ws2 = XLSX.utils.aoa_to_sheet(channelPlanRows);
  ws2['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Channel Plan');
  const ws3 = XLSX.utils.aoa_to_sheet(templateRows);
  ws3['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 22 }, { wch: 30 }, { wch: 40 }, { wch: 18 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Campaign Templates');
  XLSX.writeFile(wb, `${brand}_ActionPack_${segName}_${date}.xlsx`);
}

export async function exportAllSegmentActionPacks(
  segments: RFMSegment[],
  brandName?: string,
  _channelRecommendation?: ChannelRecommendation | null,
  format: ExportFormat = 'xlsx',
): Promise<void> {
  const date = new Date().toISOString().split('T')[0];

  const summaryRows: (string | number)[][] = [
    ['ALL SEGMENTS ACTION PACK', '', '', '', '', '', ''],
    ['Brand', brandName || '—', '', '', '', '', ''],
    ['Generated', date, '', '', '', '', ''],
    ['Total Segments', segments.length, '', '', '', '', ''],
    [''],
    ['Segment', 'Customers', '% Base', 'Revenue %', 'RFM Score', 'Lifecycle', 'Churn Risk'],
    ...segments.map(s => {
      const b = deriveBehavioralProfile(s);
      const p = derivePredictiveMetrics(s);
      return [s.name, s.count, `${s.percentage}%`, `${s.revenue_share}%`, s.rfm_score || '—', b.lifecycle_stage, `${p.churn_risk}%`];
    }),
  ];

  const segmentBlocks: (string | number)[][][] = segments.map(seg => {
    const behavioral = deriveBehavioralProfile(seg);
    const predictive = derivePredictiveMetrics(seg);
    const templates = getTemplatesForSegment(seg);
    const rows: (string | number)[][] = [
      ['SEGMENT', seg.name, '', '', '', '', ''],
      ['RFM Score', seg.rfm_score || '—', 'Customers', seg.count, '% Base', `${seg.percentage}%`, ''],
      ['Revenue %', `${seg.revenue_share}%`, 'Persona', behavioral.persona, 'Lifecycle', behavioral.lifecycle_stage, ''],
      [''],
      ['Engagement', `${behavioral.engagement_score}/100`, 'Churn Risk', `${predictive.churn_risk}% (${predictive.churn_risk_label})`, 'Est. LTV', `€${formatNumber(predictive.estimated_ltv)}`, ''],
      ['Price Sens.', behavioral.price_sensitivity, 'Avg Basket', `€${behavioral.avg_basket_size}`, 'Frequency', behavioral.purchase_frequency, ''],
      ['Preferred Ch.', behavioral.preferred_channels.join(', '), '', '', '', '', ''],
      [''],
      ['CAMPAIGN TEMPLATES', '', '', '', '', '', ''],
      ['Platform', 'Campaign Type', 'Objective', 'Targeting', 'Messaging', 'Budget Guide', 'KPIs'],
      ...templates.map(t => [t.platform, t.campaignType, t.objective, t.targeting, t.messaging, t.budgetGuide, t.kpi]),
    ];
    if (templates.length === 0) {
      rows.push(['Use Channel Plan recommendations for this segment', '', '', '', '', '', '']);
    }
    return rows;
  });

  const brand = safeBrandName(brandName);

  if (format === 'csv') {
    const allRows = [...summaryRows, ['']];
    segmentBlocks.forEach(block => { allRows.push([''], ...block); });
    downloadCsv(rowsToCsv(allRows), `${brand}_AllSegments_ActionPack_${date}.csv`);
    return;
  }

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  segments.forEach((seg, i) => {
    const sheetName = seg.name.substring(0, 28).replace(/[[\]:*?/\\]/g, '');
    const ws = XLSX.utils.aoa_to_sheet(segmentBlocks[i]);
    ws['!cols'] = [{ wch: 18 }, { wch: 22 }, { wch: 20 }, { wch: 28 }, { wch: 35 }, { wch: 18 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, `${brand}_AllSegments_ActionPack_${date}.xlsx`);
}

// ── Strategy export ─────────────────────────────────────────────────────────

interface StrategyExportData {
  brandName?: string;
  scenarioName: string;
  duration?: string;
  monthlyBudget?: number | null;
  segments: RFMSegment[];
  channelRecommendation?: ChannelRecommendation | null;
}

export async function exportStrategyPlan(data: StrategyExportData & { format?: ExportFormat }): Promise<void> {
  const format = data.format ?? 'xlsx';
  const date = new Date().toISOString().split('T')[0];

  const overviewRows: (string | number)[][] = [
    ['STRATEGY EXECUTION PLAN', '', '', ''],
    ['Brand', data.brandName || '—', '', ''],
    ['Strategy', data.scenarioName, '', ''],
    ['Duration', data.duration || '—', '', ''],
    ['Monthly Budget', data.monthlyBudget ? `€${formatNumber(data.monthlyBudget)}` : '—', '', ''],
    ['Generated', date, '', ''],
    [''],
  ];

  if (data.channelRecommendation) {
    overviewRows.push(['CHANNEL MIX', '', '', '']);
    overviewRows.push(['Channel', 'Type', 'Budget %', 'Budget €']);
    const allCh = [
      ...(data.channelRecommendation.primary || []).map(c => ({ name: c, type: 'Primary' })),
      ...(data.channelRecommendation.secondary || []).map(c => ({ name: c, type: 'Secondary' })),
    ];
    allCh.forEach(ch => {
      const pct = data.channelRecommendation?.budget_allocation?.[ch.name] || 0;
      const eur = data.monthlyBudget ? Math.round((pct / 100) * data.monthlyBudget) : 0;
      overviewRows.push([ch.name, ch.type, `${pct}%`, eur ? `€${formatNumber(eur)}` : '—']);
    });
    overviewRows.push(['']);
    if (data.channelRecommendation.rationale) {
      overviewRows.push(['AI RATIONALE', '', '', '']);
      data.channelRecommendation.rationale.split('||').forEach(line => {
        overviewRows.push([line.trim(), '', '', '']);
      });
    }
  }

  const segRows: (string | number)[][] = [
    ['TARGET SEGMENTS', '', '', '', '', '', ''],
    [''],
    ['Segment', 'Customers', '% Base', 'Revenue %', 'Lifecycle', 'Churn Risk', 'Recommended Action'],
    ...data.segments.map(s => {
      const b = deriveBehavioralProfile(s);
      const p = derivePredictiveMetrics(s);
      const action = p.churn_risk > 60 ? 'Win-back urgently' :
        p.churn_risk > 30 ? 'Re-engage' :
        b.lifecycle_stage === 'new' ? 'Nurture → 2nd purchase' :
        b.lifecycle_stage === 'loyal' ? 'Upsell / Cross-sell' : 'Maintain';
      return [s.name, s.count, `${s.percentage}%`, `${s.revenue_share}%`, b.lifecycle_stage, `${p.churn_risk}%`, action];
    }),
  ];

  const allTemplateRows: (string | number)[][] = [
    ['CAMPAIGN TEMPLATES BY SEGMENT', '', '', '', '', '', '', ''],
    [''],
    ['Segment', 'Platform', 'Campaign Type', 'Objective', 'Targeting', 'Messaging', 'Budget Guide', 'KPIs'],
  ];
  data.segments.forEach(s => {
    const templates = getTemplatesForSegment(s);
    templates.forEach(t => {
      allTemplateRows.push([s.name, t.platform, t.campaignType, t.objective, t.targeting, t.messaging, t.budgetGuide, t.kpi]);
    });
  });
  const brand = safeBrandName(data.brandName);

  if (format === 'csv') {
    const allRows = [...overviewRows, [''], ...segRows, [''], ...allTemplateRows];
    downloadCsv(rowsToCsv(allRows), `${brand}_StrategyPlan_${data.scenarioName.replace(/\s+/g, '_')}_${date}.csv`);
    return;
  }

  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet(overviewRows);
  ws1['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Strategy Overview');
  const ws2 = XLSX.utils.aoa_to_sheet(segRows);
  ws2['!cols'] = [{ wch: 25 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, ws2, 'Segments');
  const ws3 = XLSX.utils.aoa_to_sheet(allTemplateRows);
  ws3['!cols'] = [{ wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 38 }, { wch: 16 }, { wch: 28 }];
  XLSX.utils.book_append_sheet(wb, ws3, 'Campaign Templates');
  XLSX.writeFile(wb, `${brand}_StrategyPlan_${data.scenarioName.replace(/\s+/g, '_')}_${date}.xlsx`);
}

// ── Customer list exports ───────────────────────────────────────────────────

export async function exportSegmentCustomerList(
  brandId: string,
  segment: RFMSegment,
  brandName?: string,
  format: ExportFormat = 'csv',
): Promise<{ count: number }> {
  const importedCustomers = await SegmentCustomersService.getForSegment(brandId, segment.id);
  const customers = importedCustomers.length > 0 ? importedCustomers : segment.customers ?? [];
  if (customers.length === 0) throw new Error('Δεν υπάρχουν customer-level δεδομένα με email/customer id για αυτό το segment.');

  const date = new Date().toISOString().split('T')[0];
  const brand = safeBrandName(brandName);
  const segName = segment.name.replace(/[\s/\\]+/g, '_');

  const headers = ['Customer ID', 'Email', 'Segment', 'Recency', 'Frequency', 'Monetary', 'RFM Score'];
  const rows: (string | number)[][] = customers.map(c => [
    c.customerId,
    c.email || '',
    segment.name,
    c.recency ?? '',
    c.frequency ?? '',
    c.monetary ?? '',
    c.rfmScore || '',
  ]);

  if (format === 'csv') {
    const allRows = [headers, ...rows];
    downloadCsv(rowsToCsv(allRows), `${brand}_Customers_${segName}_${date}.csv`);
  } else {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      [`CUSTOMER LIST — ${segment.name}`, '', '', '', '', '', ''],
      ['Brand', brandName || '—', '', 'Total', customers.length, '', ''],
      ['Generated', date, '', '', '', '', ''],
      [''],
      headers,
      ...rows,
    ]);
    ws['!cols'] = [{ wch: 20 }, { wch: 25 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, segment.name.substring(0, 28));
    XLSX.writeFile(wb, `${brand}_Customers_${segName}_${date}.xlsx`);
  }

  return { count: customers.length };
}

export async function exportAllSegmentCustomerLists(
  brandId: string,
  segments: RFMSegment[],
  brandName?: string,
  format: ExportFormat = 'csv',
): Promise<{ count: number }> {
  const allCustomers = await SegmentCustomersService.getAllBySegment(brandId);
  const hasDerivedCustomers = segments.some((seg) => (seg.customers?.length ?? 0) > 0);
  if (allCustomers.size === 0 && !hasDerivedCustomers) {
    throw new Error('Δεν υπάρχουν customer-level δεδομένα με email/customer id για export.');
  }

  const date = new Date().toISOString().split('T')[0];
  const brand = safeBrandName(brandName);
  let totalCount = 0;

  const headers = ['Customer ID', 'Email', 'Segment', 'Recency', 'Frequency', 'Monetary', 'RFM Score'];

  if (format === 'csv') {
    const allRows: (string | number)[][] = [headers];
    for (const seg of segments) {
      const importedCustomers = allCustomers.get(seg.id) || [];
      const customers = importedCustomers.length > 0 ? importedCustomers : seg.customers ?? [];
      totalCount += customers.length;
      for (const c of customers) {
        allRows.push([c.customerId, c.email || '', seg.name, c.recency ?? '', c.frequency ?? '', c.monetary ?? '', c.rfmScore || '']);
      }
    }
    downloadCsv(rowsToCsv(allRows), `${brand}_AllCustomers_BySegment_${date}.csv`);
  } else {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const seg of segments) {
      const importedCustomers = allCustomers.get(seg.id) || [];
      const customers = importedCustomers.length > 0 ? importedCustomers : seg.customers ?? [];
      if (customers.length === 0) continue;
      totalCount += customers.length;
      const rows = customers.map(c => [c.customerId, c.email || '', seg.name, c.recency ?? '', c.frequency ?? '', c.monetary ?? '', c.rfmScore || '']);
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = [{ wch: 20 }, { wch: 25 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws, seg.name.substring(0, 28).replace(/[[\]:*?/\\]/g, ''));
    }
    XLSX.writeFile(wb, `${brand}_AllCustomers_BySegment_${date}.xlsx`);
  }

  return { count: totalCount };
}
