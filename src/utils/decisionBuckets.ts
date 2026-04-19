/**
 * Decision Buckets — Triage layer για merchant-centric ταξινόμηση SKUs.
 *
 * Αντί για raw σενάρια "0 πωλήσεις 7 ημερών", δουλεύουμε σε εμπορικά νοήματα:
 *   - Dead Capital   → στάσιμα κεφάλαια
 *   - Stockout Risk  → επικείμενη έλλειψη
 *   - Hot Seller     → bestsellers
 *   - Margin Bleeder → πουλάει αλλά χωρίς κέρδος
 *   - Slow Mover     → χαμηλή κίνηση + κρατημένο stock
 *   - Discontinue    → υποψήφιο για κατάργηση
 *   - Replenish Now  → χρειάζεται άμεση παραγγελία
 *   - New / Unknown  → δεν έχουμε αρκετά δεδομένα
 *
 * Pure & deterministic — δεν εξαρτάται από hooks. Δίνει εξήγηση ανά SKU
 * (`reasons`) ώστε το UI να τη δείξει στον χρήστη και τα AI prompts να
 * έχουν context.
 *
 * Κάθε bucket έχει `recommendedPolicy` που δείχνει σε ένα από τα 8 υπάρχοντα
 * commercial policies — έτσι το triage card μπορεί να γίνει router.
 */

import type { Product } from '../types';
import type { ProductSignal } from '../hooks/useProductSignals';
import { getStockAgeDays } from './productUtils';

export type BucketId =
  | 'dead_capital'
  | 'stockout_risk'
  | 'hot_seller'
  | 'margin_bleeder'
  | 'slow_mover'
  | 'discontinue'
  | 'replenish_now'
  | 'new_or_unknown';

export type RecommendedPolicy =
  | 'profit_max'
  | 'stock_clearance'
  | 'price_benchmark'
  | 'seasonal_discount'
  | 'sales_base'
  | 'revenue_push'
  | 'brand_launch'
  | 'mixed'
  | null;

export interface BucketDef {
  id: BucketId;
  label: string;
  shortLabel: string;
  description: string;
  /** Tailwind text/badge color suffix (π.χ. 'rose', 'amber', 'emerald'). */
  color: 'rose' | 'amber' | 'emerald' | 'sky' | 'violet' | 'slate' | 'orange' | 'indigo';
  recommendedPolicy: RecommendedPolicy;
  /** CTA που εμφανίζει το triage card. */
  cta: string;
}

export const BUCKET_DEFS: Record<BucketId, BucketDef> = {
  dead_capital: {
    id: 'dead_capital',
    label: 'Αδρανή κεφάλαια',
    shortLabel: 'Αδρανές απόθεμα',
    description:
      'Απόθεμα με σημαντική δέσμευση κεφαλαίου και μηδενική κίνηση κατά το τελευταίο τρίμηνο.',
    color: 'rose',
    recommendedPolicy: 'stock_clearance',
    cta: 'Άνοιξε Stock Clearance',
  },
  stockout_risk: {
    id: 'stockout_risk',
    label: 'Κίνδυνος έλλειψης',
    shortLabel: 'Έλλειψη αποθέματος',
    description:
      'Η ζήτηση παραμένει ενεργή, αλλά η επάρκεια είναι περιορισμένη και απαιτείται έγκαιρη αναπλήρωση.',
    color: 'orange',
    recommendedPolicy: null,
    cta: 'Παραγγελία προμηθευτή',
  },
  hot_seller: {
    id: 'hot_seller',
    label: 'Προϊόντα υψηλής ζήτησης',
    shortLabel: 'Υψηλή ζήτηση',
    description:
      'Προϊόντα με ισχυρή πρόσφατη ζήτηση και ικανοποιητικό μικτό περιθώριο (ως % της τιμής πώλησης, όχι καθαρό κέρδος).',
    color: 'emerald',
    recommendedPolicy: 'profit_max',
    cta: 'Ενίσχυση με Profit Max',
  },
  margin_bleeder: {
    id: 'margin_bleeder',
    label: 'Ανεπαρκές μικτό περιθώριο',
    shortLabel: 'Χαμηλό μικτό περιθώριο',
    description:
      'Πωλήσεις με εκτιμώμενο μικτό περιθώριο επί της τιμής πώλησης (τιμή − κόστος) αρνητικό ή πολύ χαμηλό. Δεν περιλαμβάνει φόρους, logistics ή λειτουργικά — άρα όχι «καθαρό» κέρδος.',
    color: 'amber',
    recommendedPolicy: 'price_benchmark',
    cta: 'Έλεγχος τιμολόγησης',
  },
  slow_mover: {
    id: 'slow_mover',
    label: 'Βραδεία κίνηση',
    shortLabel: 'Βραδυκίνητο',
    description: 'Περιορισμένη κίνηση σε σχέση με το διαθέσιμο απόθεμα και τη δέσμευση κεφαλαίου.',
    color: 'sky',
    recommendedPolicy: 'seasonal_discount',
    cta: 'Στοχευμένη προσφορά',
  },
  discontinue: {
    id: 'discontinue',
    label: 'Προς απόσυρση',
    shortLabel: 'Απόσυρση',
    description:
      'Κωδικοί με ένδειξη κατάργησης ή με παλαιό απόθεμα χωρίς ουσιαστικό ιστορικό πωλήσεων.',
    color: 'violet',
    recommendedPolicy: 'stock_clearance',
    cta: 'Καθάρισμα αποθέματος',
  },
  replenish_now: {
    id: 'replenish_now',
    label: 'Ανάγκη αναπλήρωσης',
    shortLabel: 'Αναπλήρωση',
    description: 'Το επίπεδο αποθέματος και η τρέχουσα ζήτηση υποδεικνύουν ανάγκη άμεσης παραγγελίας.',
    color: 'indigo',
    recommendedPolicy: null,
    cta: 'Παραγγελία προμηθευτή',
  },
  new_or_unknown: {
    id: 'new_or_unknown',
    label: 'Νέα ή ανεπαρκή σήματα',
    shortLabel: 'Ανεπαρκή σήματα',
    description:
      'Δεν λείπει ο κωδικός από τον κατάλογο· λείπουν αξιόπιστα σήματα για εμπορική ταξινόμηση (πωλήσεις/ζήτηση, κίνηση αποθέματος, κόστη). Χωρίς αυτά το σύστημα δεν τον εντάσσει σε ρίσκο ή ευκαιρία.',
    color: 'slate',
    recommendedPolicy: null,
    cta: 'Συγκέντρωση δεδομένων',
  },
};

export const BUCKET_ORDER: BucketId[] = [
  'dead_capital',
  'stockout_risk',
  'margin_bleeder',
  'discontinue',
  'slow_mover',
  'hot_seller',
  'replenish_now',
  'new_or_unknown',
];

/**
 * Thematic groups για το UI — ομαδοποιούν τα 8 buckets σε νοηματικές
 * κατηγορίες ώστε ο merchant να βλέπει το «τι κατάσταση είναι» πριν τη
 * δράση. Σχεδιαστική επιλογή: Επείγον = χάνεις χρήμα/πωλήσεις τώρα,
 * Ευκαιρίες = προς ανάπτυξη, Παρακολούθηση = γνωστό αλλά μη επείγον,
 * Διερεύνηση = δεν ξέρουμε ακόμα.
 */
export type BucketGroupId = 'critical' | 'opportunity' | 'watch' | 'investigate';

export interface BucketGroup {
  id: BucketGroupId;
  label: string;
  subtitle: string;
  buckets: BucketId[];
  color: 'rose' | 'emerald' | 'amber' | 'slate';
}

export const BUCKET_GROUPS: BucketGroup[] = [
  {
    id: 'critical',
    label: 'Άμεση προτεραιότητα',
    subtitle:
      'Κωδικοί που δεσμεύουν κεφάλαιο, εμφανίζουν ασθενές μικτό περιθώριο (επί τιμής πώλησης) ή ενέχουν κίνδυνο έλλειψης.',
    buckets: ['dead_capital', 'stockout_risk', 'margin_bleeder'],
    color: 'rose',
  },
  {
    id: 'opportunity',
    label: 'Εμπορικές ευκαιρίες',
    subtitle: 'Προϊόντα υψηλής ζήτησης και κωδικοί που απαιτούν έγκαιρη αναπλήρωση.',
    buckets: ['hot_seller', 'replenish_now'],
    color: 'emerald',
  },
  {
    id: 'watch',
    label: 'Παρακολούθηση και αποφάσεις',
    subtitle: 'Κωδικοί με χαμηλή κυκλοφορία ή ενδείξεις απόσυρσης που απαιτούν εμπορική απόφαση.',
    buckets: ['slow_mover', 'discontinue'],
    color: 'amber',
  },
  {
    id: 'investigate',
    label: 'Ανεπαρκή σήματα αξιολόγησης',
    subtitle:
      'Κωδικοί που παραμένουν εδώ όταν δεν υπάρχει ακόμη επαρκές ιστορικό πωλήσεων ή κόστους ώστε να ταξινομηθούν σε ρίσκο/ευκαιρία.',
    buckets: ['new_or_unknown'],
    color: 'slate',
  },
];

/**
 * Tunable thresholds. Defaults βασισμένα σε εμπορικά benchmarks του domain
 * (B2C retail). Θα γίνουν per-brand overrides σε επόμενο sprint.
 */
export interface BucketThresholds {
  deadCapitalMinTied: number; // €
  deadCapitalMinAgeDays: number;
  stockoutMaxDaysOfCover: number;
  stockoutMin30dQty: number;
  hotSellerMinMarginPct: number;
  hotSellerTopPercentile: number; // 0..1 (π.χ. 0.2 = top 20% qty30d)
  marginBleederMaxPct: number;
  slowMoverMax90dQty: number;
  slowMoverMinTied: number;
  slowMoverMinAgeDays: number;
  discontinueMinAgeDays: number;
  replenishMaxDaysOfCover: number;
  newSkuMaxAgeDays: number;
}

export const DEFAULT_THRESHOLDS: BucketThresholds = {
  deadCapitalMinTied: 200,
  deadCapitalMinAgeDays: 90,
  stockoutMaxDaysOfCover: 14,
  stockoutMin30dQty: 1,
  hotSellerMinMarginPct: 20,
  hotSellerTopPercentile: 0.2,
  marginBleederMaxPct: 5,
  slowMoverMax90dQty: 2,
  slowMoverMinTied: 50,
  slowMoverMinAgeDays: 30,
  discontinueMinAgeDays: 180,
  replenishMaxDaysOfCover: 7,
  newSkuMaxAgeDays: 30,
};

/**
 * Sub-categorization για το «Νέα / άγνωστο» bucket. Αναγκαίο γιατί το bucket
 * πιάνει ΟΥΣΙΑΣΤΙΚΑ διαφορετικά cases (π.χ. ένα νέο SKU vs ένα gift card vs
 * ένα παλιό SKU χωρίς integrations) και ο merchant πρέπει να ξεχωρίσει.
 */
export type UnknownReason = 'new_sku' | 'no_signals' | 'virtual_sku';

export interface BucketAssignment {
  sku: string;
  productId: string;
  productName: string;
  buckets: BucketId[];
  reasons: Partial<Record<BucketId, string>>;
  /** Severity για ranking μέσα στο bucket (μεγαλύτερο = πιο επείγον). */
  severity: number;
  /** Tied capital (€) — βασικό KPI για prioritization. */
  tiedCapital: number;
  /** Επιπλέον context για το UI (rich SKU rows). */
  meta: {
    stock?: number;
    qty30d?: number;
    qty90d?: number;
    daysOfCover?: number;
    ageDays?: number;
    marginPct?: number;
    lastSaleAt?: string | null;
    /** Συμπληρωματικός λόγος για new_or_unknown classification. */
    unknownReason?: UnknownReason;
  };
}

interface ClassifierContext {
  thresholds: BucketThresholds;
  /** Κατώφλι qty30d για top percentile (Hot Seller). Pre-computed στο classifyAll. */
  hotSellerQty30dCutoff: number;
}

/** Κλασικό status normalization — πιάνει ελληνικά + αγγλικά. */
function statusMatchesDiscontinue(status: string | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return /προς\s*κατάργησ|καταργ|discontin|phase\s*out|eol/i.test(s);
}

function fmtEur(n: number): string {
  return `${n.toLocaleString('el-GR', { maximumFractionDigits: 0 })}€`;
}

/** Classify ένα SKU. Επιστρέφει buckets + per-bucket reason text. */
function classifyOne(
  product: Product,
  signal: ProductSignal | undefined,
  ctx: ClassifierContext
): BucketAssignment {
  const r = signal?.resolved;
  const stock = r?.stock ?? product.stock_level ?? 0;
  const cost = r?.cost ?? product.cost_price;
  const tied = r?.tied_capital ?? (typeof cost === 'number' ? cost * stock : 0);
  const margin = r?.margin_pct ?? product.margin_percentage;
  const qty7d = r?.qty7d;
  const qty30d = r?.qty30d;
  const qty90d = r?.qty90d;
  const qtyLifetime = r?.qty_lifetime ?? product.qty_sold_lifetime;
  const status = r?.status ?? product.procurement_status;
  const dco = r?.days_of_cover;
  const ageDays = getStockAgeDays(product);
  const hasWindowSource = signal?.hasWindowSource ?? false;

  const buckets: BucketId[] = [];
  const reasons: Partial<Record<BucketId, string>> = {};
  const t = ctx.thresholds;

  // 1) Dead Capital — έχει προτεραιότητα
  if (
    tied >= t.deadCapitalMinTied &&
    ageDays >= t.deadCapitalMinAgeDays &&
    hasWindowSource &&
    (qty90d ?? 0) === 0 &&
    stock > 0
  ) {
    buckets.push('dead_capital');
    reasons.dead_capital = `${fmtEur(tied)} δεσμευμένα, 0 κίνηση 90 ημερών, ${ageDays} ημέρες stock.`;
  }

  // 2) Discontinue — status match ή lifetime=0 με παλιό stock
  if (
    statusMatchesDiscontinue(status) ||
    (typeof qtyLifetime === 'number' &&
      qtyLifetime === 0 &&
      ageDays >= t.discontinueMinAgeDays &&
      stock > 0)
  ) {
    buckets.push('discontinue');
    reasons.discontinue = statusMatchesDiscontinue(status)
      ? `Status: «${status}».`
      : `0 πωλήσεις lifetime, ${ageDays} ημέρες stock.`;
  }

  // 3) Stockout Risk — γρήγορη κίνηση + λίγες ημέρες επάρκειας
  if (
    typeof dco === 'number' &&
    dco <= t.stockoutMaxDaysOfCover &&
    typeof qty30d === 'number' &&
    qty30d >= t.stockoutMin30dQty &&
    stock > 0
  ) {
    buckets.push('stockout_risk');
    reasons.stockout_risk = `${dco} ημέρες επάρκειας, ${qty30d} τμχ τον τελ. μήνα.`;
  }

  // 4) Replenish Now — procurement signal ή πολύ μικρή επάρκεια
  if (
    (signal?.resolved && typeof dco === 'number' && dco < t.replenishMaxDaysOfCover && (qty30d ?? 0) > 0)
  ) {
    buckets.push('replenish_now');
    reasons.replenish_now = `${dco} ημέρες επάρκειας — προτείνεται άμεση παραγγελία.`;
  }

  // 5) Hot Seller — top percentile qty30d + υγιές margin
  if (
    typeof qty30d === 'number' &&
    qty30d >= ctx.hotSellerQty30dCutoff &&
    qty30d > 0 &&
    typeof margin === 'number' &&
    margin >= t.hotSellerMinMarginPct
  ) {
    buckets.push('hot_seller');
    reasons.hot_seller = `${qty30d} τμχ/30d (top ${Math.round(t.hotSellerTopPercentile * 100)}%), μικτό περιθώριο ${margin.toFixed(0)}%.`;
  }

  // 6) Margin Bleeder — πουλάει αλλά margin πολύ χαμηλό
  if (
    typeof qty30d === 'number' &&
    qty30d > 0 &&
    typeof margin === 'number' &&
    margin <= t.marginBleederMaxPct
  ) {
    buckets.push('margin_bleeder');
    reasons.margin_bleeder = `${qty30d} τμχ/30d με μικτό περιθώριο ${margin.toFixed(1)}% (επί πώλησης).`;
  }

  // 7) Slow Mover — όχι Dead Capital αλλά αξίζει προσοχή
  if (
    !buckets.includes('dead_capital') &&
    !buckets.includes('discontinue') &&
    typeof qty90d === 'number' &&
    qty90d <= t.slowMoverMax90dQty &&
    tied >= t.slowMoverMinTied &&
    ageDays >= t.slowMoverMinAgeDays &&
    stock > 0
  ) {
    buckets.push('slow_mover');
    reasons.slow_mover = `${qty90d} τμχ/90d, ${fmtEur(tied)} δεσμευμένα.`;
  }

  // 8) New / Unknown — fallback όταν δεν έχουμε classification ή πολύ νέο SKU
  let unknownReason: UnknownReason | undefined;
  if (buckets.length === 0) {
    // Προτεραιότητα: virtual SKU (gift cards κλπ) → νέο με γνωστή ηλικία → χωρίς παράθυρο ζήτησης
    const isVirtual = (stock <= 0 && (cost === undefined || cost === 0));
    if (isVirtual) {
      buckets.push('new_or_unknown');
      unknownReason = 'virtual_sku';
      reasons.new_or_unknown = 'Virtual SKU — χωρίς απόθεμα/κόστος (π.χ. gift card, υπηρεσία).';
    } else if (ageDays >= 0 && ageDays < t.newSkuMaxAgeDays) {
      buckets.push('new_or_unknown');
      unknownReason = 'new_sku';
      reasons.new_or_unknown = `Νέο SKU — μόλις ${ageDays} ${ageDays === 1 ? 'ημέρα' : 'ημέρες'} στον κατάλογο.`;
    } else if (!hasWindowSource) {
      // Χωρίς orders/movement windows: ισχύει ακόμη κι αν υπάρχει procurement (ασύμφωνα SKU / μορφή κωδικού).
      buckets.push('new_or_unknown');
      unknownReason = 'no_signals';
      reasons.new_or_unknown = signal?.hasProcurement
        ? 'Δεν υπάρχουν επαληθευμένα παράθυρα ζήτησης (7/30/90 ημ.) για αυτό το SKU. Έλεγχος αντιστοίχισης κωδικού με e-shop ή ότι τα exports καλύπτουν το SKU.'
        : 'Λείπουν δεδομένα κίνησης — σύνδεσε e-shop ή ανέβασε procurement export.';
    } else {
      buckets.push('new_or_unknown');
      unknownReason = 'no_signals';
      reasons.new_or_unknown =
        'Υπάρχουν σήματα κίνησης αλλά δεν πληρούνται τα κριτήρια των εμπορικών buckets — απαιτείται χειροκίνητη αξιολόγηση.';
    }
  }

  // Severity heuristic — Dead Capital weighted by tied; Stockout by velocity gap;
  // Hot Seller by qty30d; default tied.
  let severity = tied;
  if (buckets.includes('stockout_risk') && typeof qty30d === 'number') {
    severity = Math.max(severity, qty30d * 50); // velocity proxy
  }
  if (buckets.includes('hot_seller') && typeof qty30d === 'number') {
    severity = Math.max(severity, qty30d * 100);
  }
  // Suppress 7d/lifetime warnings: τις χρησιμοποιούν reasons
  void qty7d;
  void qtyLifetime;

  return {
    sku: product.sku || product.id,
    productId: product.id,
    productName: product.name,
    buckets,
    reasons,
    severity,
    tiedCapital: tied,
    meta: {
      stock,
      qty30d,
      qty90d,
      daysOfCover: dco,
      ageDays,
      marginPct: typeof margin === 'number' ? margin : undefined,
      lastSaleAt: r?.last_sale_at ?? null,
      ...(unknownReason ? { unknownReason } : {}),
    },
  };
}

export interface ClassifyResult {
  /** Όλες οι αναθέσεις, ανεξαρτήτως bucket. */
  assignments: BucketAssignment[];
  /** Counts ανά bucket. */
  counts: Record<BucketId, number>;
  /** Top SKUs ανά bucket (sorted by severity desc). */
  topByBucket: Record<BucketId, BucketAssignment[]>;
  /** Συνολικό tied capital ανά bucket — χρήσιμο για prioritization στο UI. */
  tiedByBucket: Record<BucketId, number>;
  /** SKUs χωρίς καμία ανάθεση (debug). */
  unclassified: number;
}

/**
 * Classify όλα τα products. Pre-computes top-percentile cutoff για Hot Seller.
 */
export function classifyAll(
  products: Product[],
  getSignal: (sku: string) => ProductSignal | undefined,
  thresholds: BucketThresholds = DEFAULT_THRESHOLDS,
  options: { topN?: number } = {}
): ClassifyResult {
  const topN = options.topN ?? 50;

  // Hot Seller cutoff: top X% qty30d (orders-grade only)
  const qty30dValues: number[] = [];
  for (const p of products) {
    const sig = getSignal((p.sku || p.id || '').trim());
    if (sig?.hasWindowSource && typeof sig.resolved.qty30d === 'number' && sig.resolved.qty30d > 0) {
      qty30dValues.push(sig.resolved.qty30d);
    }
  }
  qty30dValues.sort((a, b) => b - a);
  const cutoffIdx = Math.max(0, Math.floor(qty30dValues.length * thresholds.hotSellerTopPercentile) - 1);
  const hotSellerQty30dCutoff = qty30dValues.length > 0 ? qty30dValues[cutoffIdx] || 1 : Number.POSITIVE_INFINITY;

  const ctx: ClassifierContext = { thresholds, hotSellerQty30dCutoff };

  const assignments: BucketAssignment[] = [];
  const counts: Record<BucketId, number> = {
    dead_capital: 0, stockout_risk: 0, hot_seller: 0, margin_bleeder: 0,
    slow_mover: 0, discontinue: 0, replenish_now: 0, new_or_unknown: 0,
  };
  const tiedByBucket: Record<BucketId, number> = {
    dead_capital: 0, stockout_risk: 0, hot_seller: 0, margin_bleeder: 0,
    slow_mover: 0, discontinue: 0, replenish_now: 0, new_or_unknown: 0,
  };
  const topByBucket: Record<BucketId, BucketAssignment[]> = {
    dead_capital: [], stockout_risk: [], hot_seller: [], margin_bleeder: [],
    slow_mover: [], discontinue: [], replenish_now: [], new_or_unknown: [],
  };
  let unclassified = 0;

  for (const p of products) {
    const sig = getSignal((p.sku || p.id || '').trim());
    const a = classifyOne(p, sig, ctx);
    assignments.push(a);
    if (a.buckets.length === 0) {
      unclassified++;
      continue;
    }
    for (const b of a.buckets) {
      counts[b]++;
      tiedByBucket[b] += a.tiedCapital;
      topByBucket[b].push(a);
    }
  }

  for (const b of BUCKET_ORDER) {
    topByBucket[b].sort((x, y) => y.severity - x.severity);
    if (topByBucket[b].length > topN) topByBucket[b] = topByBucket[b].slice(0, topN);
  }

  return { assignments, counts, topByBucket, tiedByBucket, unclassified };
}
