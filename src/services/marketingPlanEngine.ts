import type { Campaign } from '../types';
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
  performance: MarketingPlanAction[];
  organic: MarketingPlanAction[];
  budgetSplit: { googleAds: number; meta: number; organic: number; other: number };
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
    return {
      fromDate: `${ny}-${pad(nm)}-01`,
      toDate: `${ny}-${pad(nm)}-${pad(ld)}`,
      periodLabel: 'Επόμενος μήνας',
    };
  }
  if (presetId === 'next_quarter') {
    const qStartMonth = Math.floor((m - 1) / 3) * 3 + 4;
    const startM = qStartMonth > 12 ? qStartMonth - 12 : qStartMonth;
    const startY = qStartMonth > 12 ? y + 1 : y;
    const endM = startM + 2 > 12 ? startM + 2 - 12 : startM + 2;
    const endY = startM + 2 > 12 ? startY + 1 : startY;
    const ld = lastDayOfMonth(endY, endM);
    return {
      fromDate: `${startY}-${pad(startM)}-01`,
      toDate: `${endY}-${pad(endM)}-${pad(ld)}`,
      periodLabel: 'Επόμενο τρίμηνο',
    };
  }
  const seasonal: Record<string, { sm: number; sd: number; em: number; ed: number; label: string }> = {
    black_friday: { sm: 11, sd: 20, em: 11, ed: 30, label: 'Black Friday' },
    christmas: { sm: 12, sd: 1, em: 12, ed: 24, label: 'Χριστούγεννα' },
    january_sales: { sm: 1, sd: 10, em: 2, ed: 28, label: 'Εκπτώσεις Ιανουαρίου' },
    back_to_school: { sm: 9, sd: 1, em: 9, ed: 20, label: 'Back to School' },
  };
  const s = seasonal[presetId] ?? seasonal.black_friday;
  return {
    fromDate: `${y}-${pad(s.sm)}-${pad(s.sd)}`,
    toDate: `${y}-${pad(s.em)}-${pad(s.ed)}`,
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
    campaignAngle: `Χτίζουμε το marketing plan γύρω από ${category}, με έμφαση στη διαθεσιμότητα, την εποχικότητα και τα προϊόντα που απέδειξαν ζήτηση πέρυσι.`,
    proofPoints,
    ctaIdeas: ['Δείτε τη συλλογή', 'Προλάβετε τη διαθεσιμότητα', 'Ανακαλύψτε τις επιλογές της περιόδου'],
    source: 'fallback',
  };
}

export function buildMarketingPlanDraft(input: {
  presetId: MarketingPlanPresetId;
  monthlyBudget?: number;
  campaigns?: Campaign[];
  storeRevenue12m?: number;
  topCampaignRoas?: number;
  hasGa4?: boolean;
  insight?: MarketingPlanInsight | null;
  coreMessage?: MarketingPlanCoreMessage | null;
}): MarketingPlanDraft {
  const period = resolvePlanPeriod(input.presetId);
  const insight = input.insight ?? undefined;
  const budget = input.monthlyBudget || 0;
  const googleShare = 55;
  const metaShare = 35;
  const organicShare = 10;
  const fallbackMessage = buildFallbackCoreMessage(insight);
  const coreMessage = input.coreMessage ?? fallbackMessage;

  const performance: MarketingPlanAction[] = [
    {
      id: 'perf-1',
      channel: 'performance',
      title: 'Επανεκτίμηση καμπανιών υψηλού ROAS',
      detail: 'Διατηρήστε budget σε καμπάνιες με ROAS πάνω από μέσο όρο· μειώστε spend σε underperformers.',
      priority: 'high',
    },
    {
      id: 'perf-2',
      channel: 'performance',
      title: 'Shopping / catalog refresh',
      detail: insight?.reorderPlan?.[0]
        ? `Προτεραιότητα feed σε ${insight.reorderPlan[0].subcategory || insight.reorderPlan[0].category}, γιατί είχε την ισχυρότερη περσινή ένδειξη.`
        : 'Συγχρονίστε feed και εικόνες SKU πριν την περίοδο — ιδίως νέα arrivals και εκπτώσεις.',
      priority: 'medium',
    },
    {
      id: 'perf-3',
      channel: 'budget',
      title: 'Budget guardrail βάσει αποθέματος',
      detail: 'Μην αυξάνετε spend σε κατηγορίες που έχουν χαμηλό stock χωρίς παράλληλη απόφαση παραγγελίας.',
      priority: 'high',
    },
  ];

  const organic: MarketingPlanAction[] = input.hasGa4
    ? [
        {
          id: 'org-1',
          channel: 'organic',
          title: 'Content pillars από top categories',
          detail: coreMessage.campaignAngle,
          priority: 'medium',
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
  if ((input.storeRevenue12m ?? 0) <= 0) {
    risks.push('Λείπουν e-shop δεδομένα — το plan βασίζεται κυρίως σε ad platforms.');
  }
  if (budget <= 0) {
    risks.push('Δεν έχει οριστεί monthly budget στη Strategy — προτείνεται ορισμός για budget split.');
  }
  if (insight?.dataQuality.notes.length) {
    risks.push(...insight.dataQuality.notes);
  }

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
    performance,
    organic,
    budgetSplit: {
      googleAds: googleShare,
      meta: metaShare,
      organic: organicShare,
      other: Math.max(0, 100 - googleShare - metaShare - organicShare),
    },
    risks,
  };
}
