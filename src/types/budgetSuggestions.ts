/** Budget opportunity suggestions from `Campaign.dailyMetrics`, comparing two time
 *  windows (e.g. last 7 days vs previous 7). Advisory only — never auto-applied. */

/** Kind of suggested action (for UI / filters). */
export type BudgetSuggestionKind =
  | 'scale_up'
  | 'scale_test'
  | 'hold'
  | 'reduce'
  | 'review';

/** Scope: per campaign or aggregated per channel. */
export type BudgetSuggestionScope = 'campaign' | 'channel';

export interface BudgetMetricWindow {
  label: 'recent' | 'baseline';
  /** ISO date (day) */
  startDate: string;
  endDate: string;
  spend: number;
  revenue: number;
  roas: number;
  conversions: number;
  clicks: number;
  impressions: number;
  /** Number of dates with meaningful spend > 0 */
  activeDays: number;
}

/** A structured suggestion to display in the UI. */
export interface BudgetOpportunitySuggestion {
  /** Stable key for lists / React keys */
  id: string;
  scope: BudgetSuggestionScope;
  campaignId?: string;
  campaignName?: string;
  channel: string;
  kind: BudgetSuggestionKind;
  confidence: 'high' | 'medium' | 'low';
  title: string;
  rationale: string;
  metrics: {
    recent: BudgetMetricWindow;
    baseline: BudgetMetricWindow;
  };
  /** Suggested budget change as a % range; guidance only, not wired to any API. */
  suggestedBudgetDeltaPercent?: { min: number; max: number };
  generatedAt: string;
}

export interface BudgetOpportunityEngineMeta {
  recentDays: number;
  baselineDays: number;
  campaignsWithDailyMetrics: number;
  campaignsSkippedNoDaily: number;
  channelsAnalyzed: number;
}

export interface BudgetOpportunityResult {
  suggestions: BudgetOpportunitySuggestion[];
  meta: BudgetOpportunityEngineMeta;
}

/** Rule parameters - configurable (later via brand settings). */
export interface BudgetOpportunityEngineOptions {
  /** Days in the "recent" window (toward today). */
  recentDays: number;
  /** Days in the "baseline" period immediately before recent. */
  baselineDays: number;
  /** Minimum spend per window to emit a suggestion (brand currency). */
  minSpendPerWindow: number;
  /** Recent ROAS >= baseline x factor -> scale up */
  scaleRoasImprovementFactor: number;
  /** Recent ROAS <= baseline x factor -> reduce */
  reduceRoasDeclineFactor: number;
  /** Minimum active days per window for high confidence */
  minActiveDaysHighConfidence: number;
  /** Reference "today" - defaults to now (pass a fixed date for tests). */
  referenceDate?: Date;
  /** Also produce aggregated per-channel suggestions */
  includeChannelRollups: boolean;
}

export const DEFAULT_BUDGET_OPPORTUNITY_OPTIONS: BudgetOpportunityEngineOptions = {
  recentDays: 7,
  baselineDays: 7,
  minSpendPerWindow: 25,
  scaleRoasImprovementFactor: 1.08,
  reduceRoasDeclineFactor: 0.85,
  minActiveDaysHighConfidence: 4,
  /** Default false - avoids duplicate display with campaign-level (enable for a per-channel executive view). */
  includeChannelRollups: false,
};
