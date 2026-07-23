import { scenarios } from './mockScenarios';

const WEIGHT_KEYS_FOR_DRIFT = ['profit', 'stock', 'strategic', 'revenue', 'fit'] as const;

export type PreviewColumnId =
  | 'rank'
  | 'product'
  | 'category'
  | 'margin'
  | 'stock'
  | 'stock_age'
  | 'excess_pct'
  | 'priority_tag'
  | 'revenue_potential'
  | 'sales_signal'
  | 'sales_pos_neg'
  | 'benchmark_signal'
  | 'score';

export interface PreviewColumnConfig {
  id: PreviewColumnId;
  label: string;
  /** Optional: header tooltip for Score column */
  tooltip?: string;
}

export interface StrategyPreviewConfig {
  columns: PreviewColumnConfig[];
  scoreTooltip: string;
}

const SCORE_TOOLTIPS: Record<string, string> = {
  profit_max: `Η βαθμολογία προκύπτει από σταθμισμένο συνδυασμό 5 παραγόντων:
• Κερδοφορία (40%): ποσοστό περιθωρίου, με προτεραιότητα στα προϊόντα υψηλού περιθωρίου
• Απόθεμα (15%): επίπεδο και παλαιότητα αποθέματος
• Στρατηγική προτεραιότητα (15%): νέα λανσαρίσματα, εμπορική ώθηση, best seller ενδείξεις
• Έσοδα (10%): τιμή × απόθεμα ως ένδειξη δυναμικού εσόδων
• Συνάφεια πελάτη (20%): συνάφεια με το επιλεγμένο segment`,

  stock_clearance: `Η βαθμολογία προκύπτει από σταθμισμένο συνδυασμό 5 παραγόντων:
• Απόθεμα (45%): υψηλή αναλογία αποθέματος και παλαιό stock αυξάνουν την προτεραιότητα
• Κερδοφορία (15%): περιθώριο, ώστε η εκκαθάριση να μη διαβρώνει υπερβολικά το αποτέλεσμα
• Στρατηγική προτεραιότητα (10%): ενίσχυση για ενδείξεις εκκαθάρισης
• Έσοδα (10%): δυναμικό όγκου πωλήσεων
• Συνάφεια πελάτη (20%): συνάφεια με το segment
Προτεραιότητα δίνεται σε προϊόντα με πλεονάζον απόθεμα και αυξημένη ηλικία αποθήκευσης.`,

  brand_launch: `Η βαθμολογία προκύπτει από σταθμισμένο συνδυασμό 5 παραγόντων:
• Στρατηγική προτεραιότητα (50%): νέα λανσαρίσματα και brand push λαμβάνουν το υψηλότερο βάρος
• Κερδοφορία (10%): περιθώριο
• Απόθεμα (10%): διαθεσιμότητα
• Έσοδα (10%): δυναμικό όγκου
• Συνάφεια πελάτη (20%): συνάφεια με το κοινό-στόχο
Προτεραιότητα δίνεται σε προϊόντα με σαφή στρατηγική σημασία για εμπορική ανάδειξη.`,

  revenue_push: `Η βαθμολογία προκύπτει από σταθμισμένο συνδυασμό 5 παραγόντων:
• Έσοδα (35%): τιμή × απόθεμα ως ένδειξη δυναμικού εσόδων
• Κερδοφορία (15%): περιθώριο
• Απόθεμα (15%): διαθεσιμότητα για υποστήριξη ζήτησης
• Στρατηγική προτεραιότητα (15%): best seller και εποχικές ενδείξεις
• Συνάφεια πελάτη (20%): συνάφεια με το segment
Προτεραιότητα δίνεται σε προϊόντα με ισχυρό δυναμικό εσόδων.`,

  sales_base: `Η βαθμολογία «Βελτιστοποίηση βάσει πωλήσεων» βασίζεται κυρίως στη δυναμική ζήτησης:
• Προτεραιότητα σε SKU χωρίς πρόσφατες ή με στάσιμες πωλήσεις, βάσει 7/30/90 ημερών, last_sale_at και lifetime.
• Συνδυάζεται με περιθώριο, απόθεμα, στρατηγικές ενδείξεις, proxy εσόδων και συνάφεια segment.
Για ακριβέστερο διαχωρισμό «δεν πούλησε ποτέ» έναντι «σταμάτησε να πουλά», συμπληρώστε τα πεδία qty_sold_lifetime, qty_sold_last_7d/30d/90d και last_sale_at.`,

  price_benchmark: `Η βαθμολογία «Τιμολόγηση έναντι αγοράς» βασίζεται κυρίως στο συγκριτικό πλεονέκτημα τιμής:
• Υψηλότερη βαθμολογία όταν η τιμή σας είναι χαμηλότερη από το benchmark αγοράς.
• Συνδυάζεται με κερδοφορία, απόθεμα, στρατηγικές ενδείξεις, proxy εσόδων και συνάφεια segment.
Απαιτείται συγχρονισμός Merchant Center και σωστή αντιστοίχιση SKU ή product id.`,

};

export const strategyPreviewConfigs: Record<string, StrategyPreviewConfig> = {
  profit_max: {
    columns: [
      { id: 'rank', label: 'Θέση' },
      { id: 'product', label: 'Προϊόν' },
      { id: 'category', label: 'Κατηγορία' },
      { id: 'margin', label: 'Margin' },
      { id: 'stock', label: 'Απόθεμα' },
      { id: 'score', label: 'Βαθμολογία', tooltip: SCORE_TOOLTIPS.profit_max },
    ],
    scoreTooltip: SCORE_TOOLTIPS.profit_max,
  },

  stock_clearance: {
    columns: [
      { id: 'rank', label: 'Θέση' },
      { id: 'product', label: 'Προϊόν' },
      { id: 'category', label: 'Κατηγορία' },
      { id: 'stock', label: 'Απόθεμα' },
      { id: 'stock_age', label: 'Ηλικία αποθέματος' },
      { id: 'excess_pct', label: 'Πλεονάζον %' },
      { id: 'score', label: 'Βαθμολογία', tooltip: SCORE_TOOLTIPS.stock_clearance },
    ],
    scoreTooltip: SCORE_TOOLTIPS.stock_clearance,
  },

  brand_launch: {
    columns: [
      { id: 'rank', label: 'Θέση' },
      { id: 'product', label: 'Προϊόν' },
      { id: 'category', label: 'Κατηγορία' },
      { id: 'priority_tag', label: 'Προτεραιότητα' },
      { id: 'margin', label: 'Margin' },
      { id: 'score', label: 'Βαθμολογία', tooltip: SCORE_TOOLTIPS.brand_launch },
    ],
    scoreTooltip: SCORE_TOOLTIPS.brand_launch,
  },

  revenue_push: {
    columns: [
      { id: 'rank', label: 'Θέση' },
      { id: 'product', label: 'Προϊόν' },
      { id: 'category', label: 'Κατηγορία' },
      { id: 'revenue_potential', label: 'Δυναμικό εσόδων' },
      { id: 'margin', label: 'Περιθώριο' },
      { id: 'score', label: 'Βαθμολογία', tooltip: SCORE_TOOLTIPS.revenue_push },
    ],
    scoreTooltip: SCORE_TOOLTIPS.revenue_push,
  },

  sales_base: {
    columns: [
      { id: 'rank', label: 'Θέση' },
      { id: 'product', label: 'Προϊόν' },
      { id: 'category', label: 'Κατηγορία' },
      { id: 'stock', label: 'Απόθεμα' },
      { id: 'sales_signal', label: 'Πωλήσεις' },
      { id: 'sales_pos_neg', label: 'Πωλήσεις ±', tooltip: 'Πωλήσεις / επιστροφές (τεμάχια) στην επιλεγμένη περίοδο, από τα παραστατικά του ERP. «—» όταν η πηγή δεν διαχωρίζει επιστροφές.' },
      { id: 'margin', label: 'Περιθώριο' },
      { id: 'score', label: 'Βαθμολογία', tooltip: SCORE_TOOLTIPS.sales_base },
    ],
    scoreTooltip: SCORE_TOOLTIPS.sales_base,
  },

  price_benchmark: {
    columns: [
      { id: 'rank', label: 'Θέση' },
      { id: 'product', label: 'Προϊόν' },
      { id: 'category', label: 'Κατηγορία' },
      { id: 'stock', label: 'Απόθεμα' },
      { id: 'benchmark_signal', label: 'vs Αγορά' },
      { id: 'margin', label: 'Περιθώριο' },
      { id: 'score', label: 'Βαθμολογία', tooltip: SCORE_TOOLTIPS.price_benchmark },
    ],
    scoreTooltip: SCORE_TOOLTIPS.price_benchmark,
  },
};

export function getPreviewConfig(selectedScenario: string, weights: Record<string, number>): StrategyPreviewConfig {
  const base = strategyPreviewConfigs[selectedScenario] ?? strategyPreviewConfigs.profit_max;
  const canonical = scenarios.find((s) => s.id === selectedScenario)?.weights;
  if (
    canonical &&
    WEIGHT_KEYS_FOR_DRIFT.some((k) => (weights[k] ?? 0) !== (canonical[k] ?? 0))
  ) {
    const driftTooltip = `Η βαθμολογία υπολογίζεται με τα **τρέχοντα** βάρη, τα οποία έχουν διαφοροποιηθεί από το preset «${selectedScenario}»:
• Κερδοφορία: ${weights.profit ?? 0}%
• Απόθεμα: ${weights.stock ?? 0}%
• Στρατηγική προτεραιότητα: ${weights.strategic ?? 0}%
• Έσοδα: ${weights.revenue ?? 0}%
• Συνάφεια πελάτη: ${weights.fit ?? 0}%`;
    return {
      ...base,
      scoreTooltip: driftTooltip,
      columns: base.columns.map((c) =>
        c.id === 'score' ? { ...c, tooltip: driftTooltip } : c
      ),
    };
  }
  return base;
}
