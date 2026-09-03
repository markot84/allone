import { describe, expect, it } from 'vitest';
import { guessRoute } from './guessRoute';

describe('guessRoute (PER-337)', () => {
  it('routes reorder-for-low-stock actions to the PI low-stock filter', () => {
    expect(
      guessRoute('Προγραμματίστε άμεσα παραγγελία για τα προϊόντα υψηλής ζήτησης (Nike, Wilson) που έχουν χαμηλό απόθεμα.')
    ).toEqual({ section: 'products', hashQuery: 'stock=low' });
    expect(guessRoute('Παραγγείλετε ξανά τους κωδικούς που εξαντλούνται')).toEqual({ section: 'products', hashQuery: 'stock=low' });
    expect(guessRoute('Reorder the low stock bestsellers')).toEqual({ section: 'products', hashQuery: 'stock=low' });
    expect(guessRoute('Ελέγξτε τη διαθεσιμότητα των προϊόντων υψηλής ζήτησης για την αποφυγή απώλειας πωλήσεων.')).toEqual({
      section: 'products',
      hashQuery: 'stock=low',
    });
  });

  it('matches accented AI phrasing on existing routes', () => {
    expect(guessRoute('Δημιουργήστε προωθητική ενέργεια εκκαθάρισης για τα 86 προϊόντα με πλεονάζον απόθεμα.')).toEqual({
      section: 'products',
      hashQuery: 'stock=excess',
    });
    expect(guessRoute('Ελέγξτε τις παραγγελίες e-shop')).toEqual({ section: 'ecommerce' });
    expect(guessRoute('Διακόψτε την καμπάνια «CAMP_new_AW» που δεν αποδίδει')).toEqual({ section: 'campaigns' });
  });

  it('routes idle-stock phrasing to the dead filter', () => {
    expect(guessRoute('Δημιουργήστε σχέδιο εκκαθάρισης για τα 13 αδρανή προϊόντα.')).toEqual({ section: 'products', hashQuery: 'stock=dead' });
  });

  it('falls back to dashboard for unmatched text', () => {
    expect(guessRoute('Κάτι γενικό')).toEqual({ section: 'dashboard' });
  });
});
