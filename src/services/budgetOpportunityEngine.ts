/**
 * Υπολογισμός προτάσεων budget από `Campaign.dailyMetrics`.
 * Σύγκριση recent vs baseline παραθύρου — κανόνες v1 (κλιμάκωση / δοκιμή / μείωση / έλεγχος).
 */

import type { Campaign } from '../types';
import type {
  BudgetMetricWindow,
  BudgetOpportunityEngineMeta,
  BudgetOpportunityEngineOptions,
  BudgetOpportunityResult,
  BudgetOpportunitySuggestion,
  BudgetSuggestionKind,
} from '../types/budgetSuggestions';
import { DEFAULT_BUDGET_OPPORTUNITY_OPTIONS } from '../types/budgetSuggestions';

type DailyRow = {
  impressions: number;
  clicks: number;
  conversions: number;
  amount_spent: number;
  conversion_value: number;
};

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function sumWindow(
  dm: Record<string, DailyRow> | undefined,
  start: Date,
  end: Date,
  label: 'recent' | 'baseline'
): BudgetMetricWindow | null {
  if (!dm || Object.keys(dm).length === 0) return null;
  const startStr = toYmd(start);
  const endStr = toYmd(end);
  let spend = 0;
  let revenue = 0;
  let conversions = 0;
  let clicks = 0;
  let impressions = 0;
  let activeDays = 0;

  for (const [key, row] of Object.entries(dm)) {
    if (key < startStr || key > endStr) continue;
    const s = row.amount_spent || 0;
    spend += s;
    revenue += row.conversion_value || 0;
    conversions += row.conversions || 0;
    clicks += row.clicks || 0;
    impressions += row.impressions || 0;
    if (s > 0.01) activeDays += 1;
  }

  const roas = spend > 0 ? revenue / spend : 0;
  return {
    label,
    startDate: startStr,
    endDate: endStr,
    spend,
    revenue,
    roas,
    conversions,
    clicks,
    impressions,
    activeDays,
  };
}

function mergeDailyMetrics(campaigns: Campaign[]): Record<string, DailyRow> {
  const out: Record<string, DailyRow> = {};
  for (const c of campaigns) {
    const dm = c.dailyMetrics as Record<string, DailyRow> | undefined;
    if (!dm) continue;
    for (const [date, row] of Object.entries(dm)) {
      if (!out[date]) {
        out[date] = {
          impressions: 0,
          clicks: 0,
          conversions: 0,
          amount_spent: 0,
          conversion_value: 0,
        };
      }
      out[date].impressions += row.impressions || 0;
      out[date].clicks += row.clicks || 0;
      out[date].conversions += row.conversions || 0;
      out[date].amount_spent += row.amount_spent || 0;
      out[date].conversion_value += row.conversion_value || 0;
    }
  }
  return out;
}

function confidenceForWindows(
  recent: BudgetMetricWindow,
  baseline: BudgetMetricWindow,
  minDays: number
): 'high' | 'medium' | 'low' {
  if (recent.activeDays >= minDays && baseline.activeDays >= minDays) return 'high';
  if (recent.activeDays >= 2 && baseline.activeDays >= 2) return 'medium';
  return 'low';
}

function kindToTitle(kind: BudgetSuggestionKind, name: string): string {
  switch (kind) {
    case 'scale_up':
      return `Κλιμάκωση budget — ${name}`;
    case 'scale_test':
      return `Δοκιμαστική αύξηση — ${name}`;
    case 'reduce':
      return `Μείωση ή επανέλεγχος spend — ${name}`;
    case 'review':
      return `Έλεγχος απόδοσης — ${name}`;
    default:
      return `Παρακολούθηση — ${name}`;
  }
}

function buildSuggestion(params: {
  id: string;
  scope: 'campaign' | 'channel';
  campaignId?: string;
  campaignName?: string;
  channel: string;
  kind: BudgetSuggestionKind;
  recent: BudgetMetricWindow;
  baseline: BudgetMetricWindow;
  rationale: string;
  suggestedBudgetDeltaPercent?: { min: number; max: number };
  minActiveDaysHigh: number;
}): BudgetOpportunitySuggestion {
  const conf = confidenceForWindows(params.recent, params.baseline, params.minActiveDaysHigh);
  return {
    id: params.id,
    scope: params.scope,
    campaignId: params.campaignId,
    campaignName: params.campaignName,
    channel: params.channel,
    kind: params.kind,
    confidence: conf,
    title: kindToTitle(params.kind, params.campaignName || params.channel),
    rationale: params.rationale,
    metrics: { recent: params.recent, baseline: params.baseline },
    suggestedBudgetDeltaPercent: params.suggestedBudgetDeltaPercent,
    generatedAt: new Date().toISOString(),
  };
}

function classifyWindows(
  recent: BudgetMetricWindow,
  baseline: BudgetMetricWindow,
  opts: BudgetOpportunityEngineOptions
): BudgetSuggestionKind | null {
  const min = opts.minSpendPerWindow;
  if (recent.spend < min || baseline.spend < min) return null;

  const rr = recent.roas;
  const br = baseline.roas;

  if (br <= 0 && rr > 0) return 'review';
  if (br <= 0) return null;

  if (rr >= br * opts.scaleRoasImprovementFactor && recent.conversions >= baseline.conversions * 0.85) {
    return 'scale_up';
  }

  if (rr <= br * opts.reduceRoasDeclineFactor) {
    return 'reduce';
  }

  if (rr >= br * 1.03 && recent.spend < min * 1.5 && rr >= 2) {
    return 'scale_test';
  }

  return null;
}

function rationaleForKind(
  kind: BudgetSuggestionKind,
  recent: BudgetMetricWindow,
  baseline: BudgetMetricWindow
): string {
  const r = (n: number) => (Math.round(n * 100) / 100).toString();
  switch (kind) {
    case 'scale_up':
      return `ROAS πρόσφατα ${r(recent.roas)}x έναντι ${r(baseline.roas)}x στην προηγούμενη περίοδο — η απόδοση βελτιώθηκε με επαρκές spend. Εξετάστε σταδιακή αύξηση budget.`;
    case 'scale_test':
      return `Ισχυρό ROAS (${r(recent.roas)}x) αλλά χαμηλότερο spend πρόσφατα — δοκιμή μικρής κλιμάκωσης για περισσότερο όγκο δεδομένων.`;
    case 'reduce':
      return `ROAS έπεσε σε ${r(recent.roas)}x από ${r(baseline.roas)}x — εξετάστε μείωση bid/budget ή διόρθωση στοχεύσεων πριν αυξήσετε ξανά spend.`;
    case 'hold':
      return `Σταθερή απόδοση μεταξύ περιόδων (ROAS ~${r(recent.roas)}x) — διατήρηση budget έως νέας τάσης.`;
    case 'review':
    default:
      return `Μικτή εικόνα: ROAS πρόσφατα ${r(recent.roas)}x, προηγουμένως ${r(baseline.roas)}x — χειροκίνητος έλεγχος καμπάνιας και creative.`;
  }
}

function deltaForKind(kind: BudgetSuggestionKind): { min: number; max: number } | undefined {
  switch (kind) {
    case 'scale_up':
      return { min: 10, max: 25 };
    case 'scale_test':
      return { min: 5, max: 15 };
    case 'reduce':
      return { min: -30, max: -10 };
    default:
      return undefined;
  }
}

/**
 * Κύρια είσοδος: λίστα campaigns (ίδια brand), επιλογές engine.
 */
export function computeBudgetOpportunities(
  campaigns: Campaign[],
  partialOptions?: Partial<BudgetOpportunityEngineOptions>
): BudgetOpportunityResult {
  const opts: BudgetOpportunityEngineOptions = {
    ...DEFAULT_BUDGET_OPPORTUNITY_OPTIONS,
    ...partialOptions,
  };
  const ref = opts.referenceDate ? new Date(opts.referenceDate) : new Date();
  ref.setHours(12, 0, 0, 0);
  // Use yesterday as recentEnd: ad platforms finalize data overnight, today is always incomplete.
  const recentEnd = addDays(ref, -1);
  const recentStart = addDays(recentEnd, -(opts.recentDays - 1));
  const baselineEnd = addDays(recentStart, -1);
  const baselineStart = addDays(baselineEnd, -(opts.baselineDays - 1));

  const suggestions: BudgetOpportunitySuggestion[] = [];
  let skippedNoDaily = 0;
  let withDaily = 0;

  for (const c of campaigns) {
    const dm = c.dailyMetrics as Record<string, DailyRow> | undefined;
    if (!dm || Object.keys(dm).length === 0) {
      skippedNoDaily += 1;
      continue;
    }
    withDaily += 1;

    const recent = sumWindow(dm, recentStart, recentEnd, 'recent');
    const baseline = sumWindow(dm, baselineStart, baselineEnd, 'baseline');
    if (!recent || !baseline) continue;

    const kind = classifyWindows(recent, baseline, opts);
    if (!kind || kind === 'hold') continue;

    const rationale = rationaleForKind(kind, recent, baseline);
    const id = `camp-${c.id}-${kind}`;
    suggestions.push(
      buildSuggestion({
        id,
        scope: 'campaign',
        campaignId: c.id,
        campaignName: c.name,
        channel: c.channel || 'Other',
        kind,
        recent,
        baseline,
        rationale,
        suggestedBudgetDeltaPercent: deltaForKind(kind),
        minActiveDaysHigh: opts.minActiveDaysHighConfidence,
      })
    );
  }

  if (opts.includeChannelRollups) {
    const byChannel = new Map<string, Campaign[]>();
    for (const c of campaigns) {
      const ch = c.channel || 'Other';
      if (!byChannel.has(ch)) byChannel.set(ch, []);
      byChannel.get(ch)!.push(c);
    }

    for (const [channel, list] of byChannel) {
      const merged = mergeDailyMetrics(list);
      if (Object.keys(merged).length === 0) continue;

      const recent = sumWindow(merged, recentStart, recentEnd, 'recent');
      const baseline = sumWindow(merged, baselineStart, baselineEnd, 'baseline');
      if (!recent || !baseline) continue;

      const kind = classifyWindows(recent, baseline, opts);
      if (!kind || kind === 'hold') continue;

      const id = `ch-${channel.replace(/\s+/g, '_')}-${kind}`;

      suggestions.push(
        buildSuggestion({
          id,
          scope: 'channel',
          campaignName: undefined,
          channel,
          kind,
          recent,
          baseline,
          rationale: `${rationaleForKind(kind, recent, baseline)} (συνολικά για κανάλι ${channel})`,
          suggestedBudgetDeltaPercent: deltaForKind(kind),
          minActiveDaysHigh: opts.minActiveDaysHighConfidence,
        })
      );
    }
  }

  const priority: Record<BudgetSuggestionKind, number> = {
    reduce: 0,
    review: 1,
    scale_test: 2,
    scale_up: 3,
    hold: 4,
  };
  const confOrder = { high: 0, medium: 1, low: 2 };

  suggestions.sort((a, b) => {
    const pk = priority[a.kind] - priority[b.kind];
    if (pk !== 0) return pk;
    return confOrder[a.confidence] - confOrder[b.confidence];
  });

  const meta: BudgetOpportunityEngineMeta = {
    recentDays: opts.recentDays,
    baselineDays: opts.baselineDays,
    campaignsWithDailyMetrics: withDaily,
    campaignsSkippedNoDaily: skippedNoDaily,
    channelsAnalyzed: opts.includeChannelRollups ? new Set(campaigns.map((c) => c.channel || 'Other')).size : 0,
  };

  return { suggestions, meta };
}
