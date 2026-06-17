import { useMemo } from 'react';
import type { Campaign } from '../types';
import type { BudgetOpportunityEngineOptions, BudgetOpportunityResult } from '../types/budgetSuggestions';
import { computeBudgetOpportunities } from '../services/budgetOpportunityEngine';

/** Budget suggestions from daily campaign metrics (client-side); scheduled history /
 * notifications are a future Cloud Function + Firestore. */
export function useBudgetSuggestions(
  campaigns: Campaign[],
  options?: Partial<BudgetOpportunityEngineOptions>
): BudgetOpportunityResult {
  return useMemo(
    () => computeBudgetOpportunities(campaigns, { ...options, referenceDate: new Date() }),
    [campaigns, options]
  );
}
