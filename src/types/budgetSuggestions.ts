/**
 * Προτάσεις ευκαιριών budget — σχεδιασμός v1
 *
 * Πηγή δεδομένων: `Campaign.dailyMetrics` (ημερήσια spend/revenue/conversions).
 * Σύγκριση δύο χρονικών παραθύρων (π.χ. τελευταίες 7 ημέρες vs προηγούμενες 7).
 * Οι προτάσεις είναι **υποστηρικτικές** — όχι αυτόματη εφαρμογή budget στις πλατφόρμες.
 */

/** Τι είδους ενέργεια προτείνεται (για UI / φίλτρα). */
export type BudgetSuggestionKind =
  | 'scale_up'
  | 'scale_test'
  | 'hold'
  | 'reduce'
  | 'review';

/** Εμβέλεια: ανά καμπάνια ή συγκεντρωτικά ανά κανάλι. */
export type BudgetSuggestionScope = 'campaign' | 'channel';

export interface BudgetMetricWindow {
  label: 'recent' | 'baseline';
  /** ISO ημερομηνία (ημέρα) */
  startDate: string;
  endDate: string;
  spend: number;
  revenue: number;
  roas: number;
  conversions: number;
  clicks: number;
  impressions: number;
  /** Πόσες ημερομηνίες είχαν ουσιαστικό spend > 0 */
  activeDays: number;
}

/** Μία δομημένη πρόταση προς εμφάνιση στο UI. */
export interface BudgetOpportunitySuggestion {
  /** Σταθερό κλειδί για λίστες / React keys */
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
  /**
   * Προτεινόμενη μεταβολή μηνιαίου/ημερήσιου budget ως εύρος %.
   * Δεν συνδέεται με API — μόνο οδηγός.
   */
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

/** Παράμετροι κανόνων — ρυθμίσιμα (μετέπειτα από brand settings). */
export interface BudgetOpportunityEngineOptions {
  /** Ημέρες «πρόσφατου» παραθύρου (προς σήμερα). */
  recentDays: number;
  /** Ημέρες «βασικής» περιόδου αμέσως πριν το recent. */
  baselineDays: number;
  /** Ελάχιστο spend ανά παράθυρο για να εκδοθεί πρόταση (νόμισμα brand). */
  minSpendPerWindow: number;
  /** ROAS πρόσφατα ≥ baseline × factor → κλιμάκωση */
  scaleRoasImprovementFactor: number;
  /** ROAS πρόσφατα ≤ baseline × factor → μείωση */
  reduceRoasDeclineFactor: number;
  /** Ελάχιστες ενεργές ημέρες ανά παράθυρο για confidence high */
  minActiveDaysHighConfidence: number;
  /** Αναφοράς «σήμερα» — default τώρα (για tests περνάτε σταθερή ημερομηνία). */
  referenceDate?: Date;
  /** Να παραχθούν και συγκεντρωτικές προτάσεις ανά κανάλι */
  includeChannelRollups: boolean;
}

export const DEFAULT_BUDGET_OPPORTUNITY_OPTIONS: BudgetOpportunityEngineOptions = {
  recentDays: 7,
  baselineDays: 7,
  minSpendPerWindow: 25,
  scaleRoasImprovementFactor: 1.08,
  reduceRoasDeclineFactor: 0.85,
  minActiveDaysHighConfidence: 4,
  /** Default false — αποφεύγει διπλές εμφανίσεις με campaign-level (ενεργοποιήστε για executive view ανά κανάλι). */
  includeChannelRollups: false,
};
