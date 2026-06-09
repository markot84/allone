import type { Campaign, RFMSegment } from '../types';
import type {
  MarketingPlanDataQuality,
  MarketingPlanEvidence,
  MarketingPlanInsight,
  MarketingPlanReorderGroup,
  MarketingPlanSkuSuggestion,
} from './marketingPlanInsights';

export type MarketingPlanPresetId =
  | 'next_month'
  | 'next_quarter'
  | 'black_friday'
  | 'christmas'
  | 'january_sales'
  | 'back_to_school';

export type MarketingPlanAction = {
  id: string;
  channel: 'performance' | 'organic' | 'budget' | 'risk';
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
};

export type CampaignRecommendation = {
  id: string;
  title: string;
  channel: 'google' | 'meta' | 'other';
  currentRoas: number;
  spend: number;
  action: 'scale' | 'pause' | 'monitor';
  rationale: string;
};

export type RfmTactic = {
  segment: 'vip' | 'at_risk' | 'new' | 'lapsed' | 'other';
  segmentName: string;
  size: number;
  revenueShare: number;
  action: string;
  channel: 'email' | 'paid' | 'organic';
};

export type PriceBenchmarkAlert = {
  title: string;
  yourPrice: number;
  benchmarkPrice: number;
  priceDiff: number;
  direction: 'above' | 'below';
};

export type MarketingPlanDraft = {
  presetId: MarketingPlanPresetId;
  periodLabel: string;
  fromDate: string;
  toDate: string;
  narrative: string;
  coreMessage: MarketingPlanCoreMessage;
  messageFallback: string;
  evidence?: MarketingPlanEvidence;
  reorderPlan: MarketingPlanReorderGroup[];
  skuSuggestions: MarketingPlanSkuSuggestion[];
  dataQuality?: MarketingPlanDataQuality;
  totalSkusCovered?: number;
  performance: MarketingPlanAction[];
  organic: MarketingPlanAction[];
  budgetSplit: { googleAds: number; meta: number; organic: number; other: number };
  budgetSplitSource: 'data' | 'fallback';
  campaignRecommendations: CampaignRecommendation[];
  rfmTactics: RfmTactic[];
  priceBenchmarkAlerts: PriceBenchmarkAlert[];
  ga4ChannelSummary: { channel: string; sessions: number; revenue: number }[];
  risks: string[];
};

export type MarketingPlanCoreMessage = {
  headline: string;
  campaignAngle: string;
  proofPoints: string[];
  ctaIdeas: string[];
  source: 'ai' | 'fallback';
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

export function resolvePlanPeriod(presetId: MarketingPlanPresetId): {
  fromDate: string;
  toDate: string;
  periodLabel: string;
} {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth() + 1;

  if (presetId === 'next_month') {
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    const ld = lastDayOfMonth(ny, nm);
    return { fromDate: `${ny}-${pad(nm)}-01`, toDate: `${ny}-${pad(nm)}-${pad(ld)}`, periodLabel: 'Επόμενος μήνας' };
  }
  if (presetId === 'next_quarter') {
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 4;
    const startM = qStartMonth > 12 ? qStartMonth - 12 : qStartMonth;
    const startY = qStartMonth > 12 ? y + 1 : y;
    const endM = startM + 2 > 12 ? startM + 2 - 12 : startM + 2;
    const endY = startM + 2 > 12 ? startY + 1 : startY;
    const ld = lastDayOfMonth(endY, endM);
    return { fromDate: `${startY}-${pad(startM)}-01`, toDate: `${endY}-${pad(endM)}-${pad(ld)}`, periodLabel: 'Επόμενο τρίμηνο' };
  }
  const seasonal: Record<string, { sm: number; sd: number; em: number; ed: number; label: string; rollYear?: boolean }> = {
    black_friday: { sm: 11, sd: 20, em: 11, ed: 30, label: 'Black Friday', rollYear: true },
    christmas:    { sm: 12, sd: 1,  em: 12, ed: 24, label: 'Χριστούγεννα', rollYear: true },
    january_sales:{ sm: 1,  sd: 10, em: 2,  ed: 28, label: 'Εκπτώσεις Ιανουαρίου' },
    back_to_school:{ sm: 9, sd: 1,  em: 9,  ed: 20, label: 'Back to School', rollYear: true },
  };
  const s = seasonal[presetId] ?? seasonal.black_friday;
  // Roll to next year if the season has already passed this year
  const targetDate = new Date(y, s.sm - 1, s.sd);
  const targetYear = s.rollYear && targetDate < now ? y + 1 : y;
  const endYear = s.em < s.sm ? targetYear + 1 : targetYear;
  return {
    fromDate: `${targetYear}-${pad(s.sm)}-${pad(s.sd)}`,
    toDate: `${endYear}-${pad(s.em)}-${pad(s.ed)}`,
    periodLabel: s.label,
  };
}

export function buildFallbackCoreMessage(insight?: MarketingPlanInsight): MarketingPlanCoreMessage {
  const top = insight?.reorderPlan?.[0];
  const label = insight?.period.periodLabel ?? 'την περίοδο';
  const category = top?.subcategory || top?.category || 'τις κατηγορίες με ζήτηση';
  const headline = `${label}: Εστιάζουμε σε ${category}`;
  const proofPoints = top
    ? [
        `Πέρυσι: ${Math.round(top.lastYearUnits).toLocaleString('el-GR')} τεμάχια`,
        `Τζίρος περσινής περιόδου: €${Math.round(top.lastYearRevenue).toLocaleString('el-GR')}`,
        `Τρέχον stock: ${Math.round(top.currentStock).toLocaleString('el-GR')} τεμάχια`,
      ]
    : ['Το μήνυμα βασίζεται στα διαθέσιμα στοιχεία πωλήσεων και αποθέματος.'];
  return {
    headline,
    campaignAngle: `Χτίζουμε το marketing plan γύρω από ${category}, με έμφαση στη διαθεσιμότητα, εποχικότητα και ζήτηση.`,
    proofPoints,
    ctaIdeas: ['Δείτε τη συλλογή', 'Προλάβετε τη διαθεσιμότητα', 'Ανακαλύψτε τις επιλογές της περιόδου'],
    source: 'fallback',
  };
}

/** Dynamic budget split from actual campaign spend/revenue. Falls back to 55/35/10. */
function computeDynamicBudgetSplit(campaigns: Campaign[]): { split: { googleAds: number; meta: number; organic: number; other: number }; source: 'data' | 'fallback' } {
  const active = campaigns.filter((c) => (c.amount_spent || 0) > 0);
  const googleRev = active.filter((c) => c.channel === 'Google Ads').reduce((s, c) => s + (c.purchase_conversion_value || 0), 0);
  const metaRev = active.filter((c) => c.channel === 'Meta').reduce((s, c) => s + (c.purchase_conversion_value || 0), 0);
  const totalRev = googleRev + metaRev;

  if (totalRev > 0) {
    const paidShare = 90;
    const googleAds = Math.round((googleRev / totalRev) * paidShare);
    const meta = paidShare - googleAds;
    return { split: { googleAds, meta, organic: 10, other: 0 }, source: 'data' };
  }

  // Fallback: spend-based split
  const googleSpend = active.filter((c) => c.channel === 'Google Ads').reduce((s, c) => s + (c.amount_spent || 0), 0);
  const metaSpend = active.filter((c) => c.channel === 'Meta').reduce((s, c) => s + (c.amount_spent || 0), 0);
  const totalSpend = googleSpend + metaSpend;
  if (totalSpend > 0) {
    const googleAds = Math.round((googleSpend / totalSpend) * 90);
    const meta = 90 - googleAds;
    // LOGIC-14: this is a spend-based inference, not revenue-backed data — label it 'fallback'
    // so consumers don't present it as a data-driven split.
    return { split: { googleAds, meta, organic: 10, other: 0 }, source: 'fallback' };
  }

  return { split: { googleAds: 55, meta: 35, organic: 10, other: 0 }, source: 'fallback' };
}

/** Top/bottom campaigns by ROAS with scale/pause recommendations. */
export function buildCampaignRecommendations(campaigns: Campaign[]): CampaignRecommendation[] {
  const active = campaigns.filter((c) => (c.amount_spent || 0) > 50 && (c.roas ?? 0) > 0);
  if (active.length === 0) return [];
  const avgRoas = active.reduce((s, c) => s + (c.roas || 0), 0) / active.length;

  return active
    .sort((a, b) => (b.roas || 0) - (a.roas || 0))
    .slice(0, 6)
    .map((c) => {
      const roas = Math.round((c.roas || 0) * 10) / 10;
      const action: CampaignRecommendation['action'] =
        roas >= avgRoas * 1.25 ? 'scale' : roas <= avgRoas * 0.6 ? 'pause' : 'monitor';
      const channel: CampaignRecommendation['channel'] =
        c.channel === 'Meta' ? 'meta' : c.channel === 'Google Ads' ? 'google' : 'other';
      return {
        id: c.id,
        title: c.name,
        channel,
        currentRoas: roas,
        spend: Math.round(c.amount_spent || 0),
        action,
        rationale:
          action === 'scale'
            ? `ROAS ${roas}x — ${Math.round(((roas / avgRoas) - 1) * 100)}% πάνω από τον μέσο (${avgRoas.toFixed(1)}x). Αύξησε budget.`
            : action === 'pause'
              ? `ROAS ${roas}x — κάτω από 60% του μέσου (${avgRoas.toFixed(1)}x). Παύση ή αναθεώρηση.`
              : `ROAS ${roas}x κοντά στον μέσο (${avgRoas.toFixed(1)}x). Monitoring χωρίς αλλαγές.`,
      };
    });
}

/** RFM segment → actionable tactic mapping. */
export function buildRfmTactics(segments: RFMSegment[]): RfmTactic[] {
  const tactics: RfmTactic[] = [];
  for (const seg of segments) {
    if (!seg.count) continue;
    const name = seg.name.toLowerCase();
    const revenueShare = seg.revenue_share ?? 0;

    if (name.includes('champion') || name.includes('vip') || name.includes('loyal') || name.includes('πιστοί') || name.includes('κορυφ')) {
      tactics.push({ segment: 'vip', segmentName: seg.name, size: seg.count, revenueShare, action: 'Early access email & exclusive offers πριν την περίοδο', channel: 'email' });
    } else if (name.includes('at risk') || name.includes('at_risk') || name.includes('κίνδυνο') || name.includes('χάσιμο')) {
      tactics.push({ segment: 'at_risk', segmentName: seg.name, size: seg.count, revenueShare, action: 'Win-back campaign με 15% έκπτωση + δωρεάν αποστολή', channel: 'paid' });
    } else if (name.includes('lapsed') || name.includes('lost') || name.includes('χαμένο') || name.includes('ανενεργ')) {
      tactics.push({ segment: 'lapsed', segmentName: seg.name, size: seg.count, revenueShare, action: 'Reactivation sequence 3-step email: υπενθύμιση → προσφορά → last chance', channel: 'email' });
    } else if (name.includes('new') || name.includes('νέο') || name.includes('πρώτ')) {
      tactics.push({ segment: 'new', segmentName: seg.name, size: seg.count, revenueShare, action: 'Welcome series + first repeat purchase offer (δωρεάν αποστολή)', channel: 'email' });
    } else if (seg.count > 0) {
      tactics.push({ segment: 'other', segmentName: seg.name, size: seg.count, revenueShare, action: 'Targeted campaign βάσει ιστορικού αγορών', channel: 'paid' });
    }
  }
  return tactics.sort((a, b) => b.revenueShare - a.revenueShare).slice(0, 5);
}

type PriceBenchmarkInput = { title: string; yourPrice: number; benchmarkPrice: number; priceDiff: number };

/** Top SKUs priced significantly above/below market benchmark. */
function buildPriceBenchmarkAlerts(benchmarks: PriceBenchmarkInput[]): PriceBenchmarkAlert[] {
  const withDiff = benchmarks.filter((b) => b.benchmarkPrice > 0 && Math.abs(b.priceDiff) > 0);
  const above = withDiff.filter((b) => b.priceDiff > 5).sort((a, b) => b.priceDiff - a.priceDiff).slice(0, 4);
  const below = withDiff.filter((b) => b.priceDiff < -5).sort((a, b) => a.priceDiff - b.priceDiff).slice(0, 4);
  return [
    ...above.map((b) => ({ title: b.title, yourPrice: b.yourPrice, benchmarkPrice: b.benchmarkPrice, priceDiff: b.priceDiff, direction: 'above' as const })),
    ...below.map((b) => ({ title: b.title, yourPrice: b.yourPrice, benchmarkPrice: b.benchmarkPrice, priceDiff: b.priceDiff, direction: 'below' as const })),
  ];
}

type GA4ChannelInput = { channel: string; sessions: number; totalRevenue?: number };

function buildGA4ChannelSummary(trafficSources: GA4ChannelInput[]): { channel: string; sessions: number; revenue: number }[] {
  return trafficSources
    .filter((s) => s.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions)
    .slice(0, 6)
    .map((s) => ({ channel: s.channel, sessions: s.sessions, revenue: s.totalRevenue ?? 0 }));
}

export function buildMarketingPlanDraft(input: {
  presetId: MarketingPlanPresetId;
  monthlyBudget?: number;
  campaigns?: Campaign[];
  storeRevenue12m?: number;
  hasGa4?: boolean;
  insight?: MarketingPlanInsight | null;
  coreMessage?: MarketingPlanCoreMessage | null;
  segments?: RFMSegment[];
  priceBenchmarks?: PriceBenchmarkInput[];
  ga4TrafficSources?: GA4ChannelInput[];
}): MarketingPlanDraft {
  const period = resolvePlanPeriod(input.presetId);
  const insight = input.insight ?? undefined;
  const budget = input.monthlyBudget || 0;
  const campaigns = (input.campaigns ?? []) as Campaign[];
  const fallbackMessage = buildFallbackCoreMessage(insight);
  const coreMessage = input.coreMessage ?? fallbackMessage;

  const { split: budgetSplit, source: budgetSplitSource } = computeDynamicBudgetSplit(campaigns);
  const campaignRecommendations = buildCampaignRecommendations(campaigns);
  const rfmTactics = buildRfmTactics(input.segments ?? []);
  const priceBenchmarkAlerts = buildPriceBenchmarkAlerts(input.priceBenchmarks ?? []);
  const ga4ChannelSummary = buildGA4ChannelSummary(input.ga4TrafficSources ?? []);

  const performance: MarketingPlanAction[] = [
    {
      id: 'perf-1',
      channel: 'performance',
      title: 'Επανεκτίμηση καμπανιών υψηλού ROAS',
      detail: campaignRecommendations.filter((c) => c.action === 'scale').length > 0
        ? `${campaignRecommendations.filter((c) => c.action === 'scale').map((c) => c.title).slice(0, 2).join(', ')}: scale up budget.`
        : 'Διατηρήστε budget σε καμπάνιες με ROAS πάνω από μέσο όρο.',
      priority: 'high',
    },
    {
      id: 'perf-2',
      channel: 'performance',
      title: 'Shopping / catalog feed refresh',
      detail: insight?.reorderPlan?.[0]
        ? `Προτεραιότητα feed σε ${insight.reorderPlan[0].subcategory || insight.reorderPlan[0].category}.`
        : 'Συγχρονίστε feed και εικόνες SKU πριν την περίοδο.',
      priority: 'medium',
    },
    {
      id: 'perf-3',
      channel: 'budget',
      title: 'Budget guardrail βάσει αποθέματος',
      detail: 'Μην αυξάνετε spend σε κατηγορίες χωρίς επαρκές stock.',
      priority: 'high',
    },
  ];

  const organic: MarketingPlanAction[] = input.hasGa4
    ? [
        {
          id: 'org-1',
          channel: 'organic',
          title: 'Content pillars από top categories',
          detail: insight?.reorderPlan?.[0]
            ? `Εστίαση σε ${insight.reorderPlan.slice(0, 3).map((r) => r.subcategory || r.category).join(', ')}.`
            : coreMessage.campaignAngle,
          priority: 'medium',
        },
        {
          id: 'org-2',
          channel: 'organic',
          title: 'SEO: ενίσχυση σελίδων top categories',
          detail: 'Βελτιστοποίηση τίτλων, descriptions & internal links στις σελίδες με την υψηλότερη εποχική ζήτηση.',
          priority: 'low',
        },
      ]
    : [
        {
          id: 'org-1',
          channel: 'organic',
          title: 'Organic baseline',
          detail: 'Συνδέστε GA4 για στοχευμένο content plan βάσει καναλιών.',
          priority: 'low',
        },
      ];

  const risks: string[] = [];
  if ((input.storeRevenue12m ?? 0) <= 0) risks.push('Λείπουν e-shop δεδομένα — το plan βασίζεται στα διαθέσιμα στοιχεία.');
  if (budget <= 0) risks.push('Δεν έχει οριστεί monthly budget στη Strategy.');
  if (insight?.dataQuality.notes.length) risks.push(...insight.dataQuality.notes);

  return {
    presetId: input.presetId,
    periodLabel: period.periodLabel,
    fromDate: period.fromDate,
    toDate: period.toDate,
    narrative: `${coreMessage.headline}. ${coreMessage.campaignAngle}`,
    coreMessage,
    messageFallback: fallbackMessage.headline,
    evidence: insight?.evidence,
    reorderPlan: insight?.reorderPlan ?? [],
    skuSuggestions: insight?.skuSuggestions ?? [],
    dataQuality: insight?.dataQuality,
    totalSkusCovered: insight?.totalSkusCovered,
    performance,
    organic,
    budgetSplit,
    budgetSplitSource,
    campaignRecommendations,
    rfmTactics,
    priceBenchmarkAlerts,
    ga4ChannelSummary,
    risks,
  };
}
