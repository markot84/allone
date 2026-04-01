import { useMemo } from 'react';
import type { Campaign } from '../types';
import type { BudgetOpportunityEngineOptions, BudgetOpportunityResult } from '../types/budgetSuggestions';
import { computeBudgetOpportunities } from '../services/budgetOpportunityEngine';

/**
 * Προτάσεις budget από ημερήσια metrics καμπανιών (client-side).
 * Για scheduled ιστορικό / ειδοποιήσεις: μελλοντικά Cloud Function + Firestore.
 */
export function useBudgetSuggestions(
  campaigns: Campaign[],
  options?: Partial<BudgetOpportunityEngineOptions>
): BudgetOpportunityResult {
  return useMemo(
    () => computeBudgetOpportunities(campaigns, { ...options, referenceDate: new Date() }),
    [campaigns, options]
  );
}
