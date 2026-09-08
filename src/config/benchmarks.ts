import type { BenchmarkMetricId, BenchmarkSizeBand, BenchmarkVertical, BenchmarkVerticalKey } from '../types';
import { formatCurrency, formatNumber, formatPercent } from '../utils/format';

/**
 * How the benchmark metrics are presented.
 *
 * The server decides what is measurable and what may cross a brand boundary
 * (`functions/src/benchmarkAggregator.ts`); this file decides what each number is called and how it
 * is read. The two are separate on purpose: renaming a metric must never be able to change which
 * data leaves a tenant.
 *
 * Every metric carries the question it answers. That is not decoration — the report exists because
 * these questions were being answered from memory, and a card that states the question it settles
 * is the difference between a dashboard and an answer.
 */

export const BENCHMARK_VERTICAL_LABELS: Record<BenchmarkVerticalKey, string> = {
  fashion: 'Ένδυση',
  footwear: 'Υπόδηση',
  sports: 'Αθλητικά',
  beauty: 'Καλλυντικά & Περιποίηση',
  health_pharmacy: 'Υγεία & Φαρμακείο',
  electronics: 'Ηλεκτρονικά',
  home_garden: 'Σπίτι & Κήπος',
  food_beverage: 'Τρόφιμα & Ποτά',
  baby_kids: 'Βρεφικά & Παιδικά',
  pets: 'Pet shop',
  diy_industrial: 'Εργαλεία & Βιομηχανικά',
  books_media: 'Βιβλία & Media',
  jewellery_watches: 'Κοσμήματα & Ρολόγια',
  automotive: 'Αυτοκίνητο & Μοτο',
  other: 'Άλλος κλάδος',
  unclassified: 'Χωρίς κλάδο',
};

/**
 * The same trades in the genitive, for the one place the label is read into a sentence
 * («14 e-shops ένδυσης»). Greek declines and a lowercased nominative reads as a typo in the
 * headline of the page, so the forms are written out rather than derived — there is no rule to
 * derive them by.
 */
export const BENCHMARK_VERTICAL_GENITIVE: Record<BenchmarkVerticalKey, string> = {
  fashion: 'ένδυσης',
  footwear: 'υπόδησης',
  sports: 'αθλητικών',
  beauty: 'καλλυντικών & περιποίησης',
  health_pharmacy: 'υγείας & φαρμακείου',
  electronics: 'ηλεκτρονικών',
  home_garden: 'σπιτιού & κήπου',
  food_beverage: 'τροφίμων & ποτών',
  baby_kids: 'βρεφικών & παιδικών',
  pets: 'pet shop',
  diy_industrial: 'εργαλείων & βιομηχανικών',
  books_media: 'βιβλίων & media',
  jewellery_watches: 'κοσμημάτων & ρολογιών',
  automotive: 'αυτοκινήτου & μότο',
  other: 'άλλου κλάδου',
  unclassified: 'χωρίς κλάδο',
};

/** The order the admin selector offers. `unclassified` is a server outcome, not a choice. */
export const BENCHMARK_VERTICAL_OPTIONS: BenchmarkVertical[] = [
  'fashion',
  'footwear',
  'sports',
  'beauty',
  'health_pharmacy',
  'electronics',
  'home_garden',
  'food_beverage',
  'baby_kids',
  'pets',
  'diy_industrial',
  'books_media',
  'jewellery_watches',
  'automotive',
  'other',
];

/** Bands are described by what they mean, not by their thresholds: the euro cut-offs are a server
 *  detail, and printing them would let a reader place any shop they can see the band of. */
export const BENCHMARK_SIZE_BAND_LABELS: Record<BenchmarkSizeBand | 'all', string> = {
  micro: 'πολύ μικρού μεγέθους',
  small: 'μικρού μεγέθους',
  mid: 'μεσαίου μεγέθους',
  large: 'μεγάλου μεγέθους',
  all: 'κάθε μεγέθους',
};

export interface BenchmarkMetricConfig {
  id: BenchmarkMetricId;
  label: string;
  /** The question this metric settles, in the words it gets asked in. */
  question: string;
  /** What exactly is counted. Present because a benchmark without a definition is an argument. */
  definition: string;
  format: (value: number) => string;
  /** False where a higher number is not better, so the delta is not coloured green by reflex. */
  goodWhenRising: boolean;
}

export const BENCHMARK_METRICS: BenchmarkMetricConfig[] = [
  {
    id: 'aov',
    label: 'Μέση αξία παραγγελίας',
    question: 'Είναι καλό το καλάθι μου για τον κλάδο μου;',
    definition: 'Καθαρός τζίρος e-shop διά πλήθος έγκυρων παραγγελιών, στο ίδιο διάστημα για κάθε κατάστημα.',
    format: (value) => `€${formatCurrency(value, 2)}`,
    goodWhenRising: true,
  },
  {
    id: 'growthYoY',
    label: 'Ανάπτυξη YoY',
    question: 'Μεγαλώνω επειδή μεγαλώνει η αγορά ή επειδή κάνω κάτι σωστά;',
    definition: 'Οι τελευταίοι 12 πλήρεις μήνες προς τους 12 προηγούμενους. Καταστήματα με λιγότερο από 24 μήνες ιστορικό δεν μετρούν εδώ.',
    format: (value) => `${value > 0 ? '+' : ''}${formatPercent(value * 100, 1)}`,
    goodWhenRising: true,
  },
  {
    id: 'ordersPerCustomer',
    label: 'Παραγγελίες ανά πελάτη',
    question: 'Επιστρέφουν οι πελάτες μου όσο επιστρέφουν στον ανταγωνισμό;',
    definition: 'Παραγγελίες διά αναγνωρισμένους πελάτες. Τα guest checkouts εξαιρούνται, γιατί δεν έχουν σταθερή ταυτότητα για να μετρηθεί επανάληψη.',
    format: (value) => formatNumber(value, 2),
    goodWhenRising: true,
  },
  {
    id: 'championsShare',
    label: 'Μερίδα Champions',
    question: 'Πόσο συγκεντρωμένη είναι η αξία στους καλούς πελάτες;',
    definition: 'Ποσοστό αναγνωρισμένων πελατών που το RFM κατατάσσει ως Champions, με τα ίδια quintile όρια για όλους.',
    format: (value) => formatPercent(value * 100, 1),
    goodWhenRising: true,
  },
  {
    id: 'directChannelShare',
    label: 'Πωλήσεις από το δικό μου e-shop',
    question: 'Είμαι πιο εξαρτημένος από marketplaces από τον κλάδο μου;',
    definition: 'Τζίρος από το ίδιο το e-shop προς τζίρο e-shop συν marketplaces. Δεν περιλαμβάνει intercompany ή παραγγελίες προς έλεγχο.',
    format: (value) => formatPercent(value * 100, 1),
    goodWhenRising: true,
  },
];

export const BENCHMARK_METRIC_MAP = Object.fromEntries(
  BENCHMARK_METRICS.map((metric) => [metric.id, metric])
) as Record<BenchmarkMetricId, BenchmarkMetricConfig>;

export const MONTH_LABELS_SHORT = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μάι', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];

/** Where a value sits in the cohort. Named rather than numeric, because "στο κορυφαίο 25%" is the
 *  sentence people repeat, and a percentile rank over 8 shops would be false precision. */
export type BenchmarkQuartile = 'top' | 'upper-mid' | 'lower-mid' | 'bottom';

export function quartileOf(
  value: number,
  spread: { p25: number; p50: number; p75: number },
  goodWhenRising: boolean
): BenchmarkQuartile {
  const rank: BenchmarkQuartile =
    value >= spread.p75 ? 'top' : value >= spread.p50 ? 'upper-mid' : value >= spread.p25 ? 'lower-mid' : 'bottom';
  if (goodWhenRising) return rank;
  // For a metric where lower is better, the same position in the spread is the opposite verdict.
  return rank === 'top' ? 'bottom' : rank === 'upper-mid' ? 'lower-mid' : rank === 'lower-mid' ? 'upper-mid' : 'top';
}

export const BENCHMARK_QUARTILE_LABELS: Record<BenchmarkQuartile, string> = {
  top: 'Κορυφαίο 25%',
  'upper-mid': 'Πάνω από τη διάμεσο',
  'lower-mid': 'Κάτω από τη διάμεσο',
  bottom: 'Κάτω 25%',
};

/** Cohort description in one line: "14 e-shops ένδυσης, μεσαίου μεγέθους". */
export function describeCohort(
  vertical: BenchmarkVerticalKey | 'all',
  sizeBand: BenchmarkSizeBand | 'all',
  brandCount: number
): string {
  const shops = `${formatNumber(brandCount)} e-shops`;
  const trade = vertical === 'all' || vertical === 'unclassified' ? '' : ` ${BENCHMARK_VERTICAL_GENITIVE[vertical]}`;
  const size = sizeBand === 'all' ? '' : `, ${BENCHMARK_SIZE_BAND_LABELS[sizeBand]}`;
  return `${shops}${trade}${size}`;
}
