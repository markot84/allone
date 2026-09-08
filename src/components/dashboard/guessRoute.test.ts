/** These are the actions the model has actually produced in briefings, copied verbatim from
 * what the owner saw on screen. A briefing action that lands on an unfiltered catalogue is worse
 * than no link at all — it promises a set of products and delivers 6.451 of them. */
import { describe, expect, it } from 'vitest';
import { guessRoute } from './guessRoute';

describe('guessRoute — restock actions reach the low-stock filter', () => {
  it.each([
    'Ελέγξτε τη διαθεσιμότητα και προγραμματίστε παραγγελίες για τα προϊόντα υψηλής ζήτησης με χαμηλό απόθεμα.',
    'Προγραμματίστε συμπληρωματική παραγγελία για τα μαγιό 3Guys που έχουν χαμηλό απόθεμα και υψηλή ζήτηση.',
    'Προγραμματίστε άμεση παραγγελία για τα μαγιό 3Guys JAS-B που έχουν ζήτηση και χαμηλό απόθεμα.',
    'Αναπληρώστε το απόθεμα στα προϊόντα υψηλής ζήτησης που εμφανίζουν έλλειψη για να αποφύγετε απώλεια πωλήσεων.',
    'Προγραμματίστε άμεσα την αναπλήρωση αποθέματος για τα προϊόντα υψηλής ζήτησης που εξαντλούνται.',
  ])('%s', (action) => {
    expect(guessRoute(action)).toEqual({ section: 'products', hashQuery: 'stock=low' });
  });
});

describe('guessRoute — clearance actions reach the right bucket', () => {
  it('sends idle-stock actions to the dead bucket', () => {
    expect(
      guessRoute('Δημιουργήστε ένα πλάνο εκποίησης για τους 485 κωδικούς σε αδράνεια για να απελευθερώσετε κεφάλαιο.')
    ).toEqual({ section: 'products', hashQuery: 'stock=dead' });
    expect(
      guessRoute('Εκκινήστε καμπάνια εκποίησης για τα 15 αδρανή προϊόντα με στόχο την άμεση ρευστοποίηση αποθέματος.')
    ).toEqual({ section: 'products', hashQuery: 'stock=dead' });
  });

  it('sends a purely excess-stock action to the excess bucket', () => {
    expect(guessRoute('Σχεδιάστε προσφορές για τους 87 κωδικούς σε πλεόνασμα.')).toEqual({
      section: 'products',
      hashQuery: 'stock=excess',
    });
  });
});

describe('guessRoute — everything else keeps its destination', () => {
  it('routes campaign, segment and efficiency actions away from the catalogue', () => {
    expect(guessRoute("Διακόψτε άμεσα την καμπάνια 'CAMP_StoreLocatorGR_AW_' που έχει μηδενική απόδοση.").section).toBe('campaigns');
    expect(guessRoute("Στοχεύστε το τμήμα πελατών 'At Risk' (9%) με μια ειδική προσφορά επαναδραστηριοποίησης.").section).toBe('rfm');
    expect(guessRoute('Ελέγξτε άμεσα τον συγχρονισμό των διαφημιστικών λογαριασμών.').section).toBe('data');
  });

  it('keeps the explicit high-margin filter for the phrasing that asks for it', () => {
    expect(guessRoute('Prioritise high-margin lines this month')).toEqual({
      section: 'products',
      hashQuery: 'filter=high-margin-low-stock',
    });
  });

  it('falls back to the dashboard when nothing matches', () => {
    expect(guessRoute('Δείτε τη γενική εικόνα της εβδομάδας.')).toEqual({ section: 'dashboard' });
  });
});
