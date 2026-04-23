/**
 * TriageCard — «Διάγνωση προτεραιοτήτων» (πρώην triage)
 *
 * Εμφανίζει τα Decision Buckets: συνδυασμός καταλόγου με σήματα πωλήσεων/κίνησης.
 * Δεν ταυτίζεται με τις κάρτες dead/excess του Product Intelligence (ERP view).
 *
 * Pure UI — η λογική ταξινόμησης είναι στο `useDecisionBuckets` / `decisionBuckets`.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle, TrendingUp, Zap, Snowflake, XCircle, Package, Sparkles,
  ChevronRight, ChevronDown, ChevronUp, HelpCircle, Info, AlertOctagon, TrendingDown,
  Clock, Boxes, Database, Plug, X,
} from 'lucide-react';
import { useDecisionBuckets, type TriageDataQuality } from '../../hooks/useDecisionBuckets';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useProcurement } from '../../hooks/useProcurement';
import {
  BUCKET_GROUPS,
  type BucketId,
  type BucketGroupId,
  type RecommendedPolicy,
  type BucketAssignment,
} from '../../utils/decisionBuckets';

const ICONS: Record<BucketId, React.ComponentType<{ size?: number; className?: string }>> = {
  dead_capital: XCircle,
  stockout_risk: AlertTriangle,
  hot_seller: TrendingUp,
  margin_bleeder: Zap,
  slow_mover: Snowflake,
  discontinue: Package,
  replenish_now: Boxes,
  new_or_unknown: Sparkles,
};

/** Συντομεύσεις για compact tabs (κλειστή κεφαλίδα). */
const GROUP_TAB_LABEL: Record<BucketGroupId, string> = {
  critical: 'Άμεση',
  opportunity: 'Ευκαιρίες',
  watch: 'Παρακολ.',
  investigate: 'Αξιολόγ.',
};

const GROUP_TAB_PILL: Record<BucketGroupId, string> = {
  critical: 'bg-rose-100 text-rose-900 ring-1 ring-rose-200/70 hover:bg-rose-200/60',
  opportunity: 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-200/70 hover:bg-emerald-200/55',
  watch: 'bg-amber-100 text-amber-950 ring-1 ring-amber-200/70 hover:bg-amber-200/50',
  investigate: 'bg-slate-100 text-slate-800 ring-1 ring-slate-200/80 hover:bg-slate-200/55',
};

const GROUP_STYLES: Record<BucketGroupId, {
  border: string; leftBar: string; titleText: string; subtitleText: string; chip: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = {
  critical: {
    border: 'border-gray-200/90',
    leftBar: 'border-l-rose-500',
    titleText: 'text-gray-900',
    subtitleText: 'text-gray-600',
    chip: 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-100',
    icon: AlertOctagon,
  },
  opportunity: {
    border: 'border-gray-200/90',
    leftBar: 'border-l-emerald-500',
    titleText: 'text-gray-900',
    subtitleText: 'text-gray-600',
    chip: 'bg-emerald-50 text-emerald-900 ring-1 ring-inset ring-emerald-100',
    icon: TrendingUp,
  },
  watch: {
    border: 'border-gray-200/90',
    leftBar: 'border-l-amber-400',
    titleText: 'text-gray-900',
    subtitleText: 'text-gray-600',
    chip: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-100',
    icon: TrendingDown,
  },
  investigate: {
    border: 'border-gray-200/90',
    leftBar: 'border-l-slate-400',
    titleText: 'text-gray-900',
    subtitleText: 'text-gray-600',
    chip: 'bg-slate-100 text-slate-800 ring-1 ring-inset ring-slate-200',
    icon: HelpCircle,
  },
};

const BUCKET_COLOR: Record<BucketId, { text: string; bg: string; ring: string }> = {
  dead_capital:    { text: 'text-rose-700',    bg: 'bg-rose-100',    ring: 'ring-rose-300' },
  stockout_risk:   { text: 'text-orange-700',  bg: 'bg-orange-100',  ring: 'ring-orange-300' },
  hot_seller:      { text: 'text-emerald-700', bg: 'bg-emerald-100', ring: 'ring-emerald-300' },
  margin_bleeder:  { text: 'text-amber-800',   bg: 'bg-amber-100',   ring: 'ring-amber-300' },
  slow_mover:      { text: 'text-sky-700',     bg: 'bg-sky-100',     ring: 'ring-sky-300' },
  discontinue:     { text: 'text-violet-700',  bg: 'bg-violet-100',  ring: 'ring-violet-300' },
  replenish_now:   { text: 'text-indigo-700',  bg: 'bg-indigo-100',  ring: 'ring-indigo-300' },
  new_or_unknown:  { text: 'text-slate-700',   bg: 'bg-slate-100',   ring: 'ring-slate-300' },
};

function fmtEur(n: number | undefined | null, opts: { dash?: boolean } = {}): string {
  if (n === undefined || n === null || !Number.isFinite(n) || n === 0) return opts.dash === false ? '0€' : '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M€`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k€`;
  return `${Math.round(n)}€`;
}

function fmtNum(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('el-GR');
}

function fmtRelative(iso: string | undefined | null): string {
  if (!iso) return 'ποτέ';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const days = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'σήμερα';
  if (days === 1) return 'χθες';
  if (days < 30) return `${days} ημέρες πριν`;
  if (days < 365) return `${Math.floor(days / 30)} μήνες πριν`;
  return `${Math.floor(days / 365)} χρόνια πριν`;
}

/** Ρητή ενημέρωση: τι είναι επιβεβαιωμένο από συστήματα vs τι είναι εκτίμηση. */
function TriageDataReliabilityCallout({
  quality,
  totalTiedCapital,
  newOrUnknownCount,
}: {
  quality: TriageDataQuality;
  totalTiedCapital: number;
  newOrUnknownCount: number;
}) {
  const t = totalTiedCapital;
  const procShare = t > 0 ? quality.tiedEurFromProcurement / t : 0;
  const compShare = t > 0 ? quality.tiedEurComputed / t : 0;
  const procPct = t > 0 ? Math.round(100 * procShare) : 0;
  const compPct = t > 0 ? Math.round(100 * compShare) : 0;
  const restPct = t > 0 ? Math.max(0, 100 - procPct - compPct) : 0;
  const stockNoCostPct =
    quality.skuCount > 0 ? Math.round((100 * quality.skusStockWithoutCost) / quality.skuCount) : 0;
  const unknownShare =
    quality.skuCount > 0 ? newOrUnknownCount / quality.skuCount : 0;

  const weakDemand = quality.demandVerifiedPct < 28;
  const weakTiedMix = t > 0 && procShare < 0.22 && compShare > 0.55;
  const manyWithoutCost = stockNoCostPct > 22;
  const dominantUnknown = unknownShare >= 0.45;

  const caution = weakDemand || weakTiedMix || manyWithoutCost || dominantUnknown;

  return (
    <div
      className={`mt-3 rounded-lg border px-3 py-2.5 text-[11px] leading-snug ${
        caution
          ? 'border-amber-300 bg-amber-50/80 text-amber-950'
          : 'border-slate-200 bg-slate-50/90 text-slate-800'
      }`}
    >
      <div className="font-semibold text-[12px] flex items-center gap-1.5 text-gray-900">
        <AlertTriangle size={14} className={caution ? 'text-amber-700 shrink-0' : 'text-slate-500 shrink-0'} />
        Αξιοπιστία δεδομένων · όρια χρήσης
      </div>
      <ul className="mt-2 space-y-1.5 text-gray-700 list-disc pl-4 marker:text-gray-400">
        <li>
          <strong>Ζήτηση / κίνηση (παράθυρα 7–90 ημ.):</strong> επαληθευμένη για{' '}
          <strong>{quality.demandVerifiedPct}%</strong> των κωδικών μέσω σύνδεσης e-shop ή ιστορικού
          μεταβολών αποθέματος. Αν το ποσοστό είναι χαμηλό, οι κατηγορίες που βασίζονται σε πρόσφατη
          ζήτηση (ευκαιρία, έλλειψη, αδράνεια με βάση πωλήσεις) <strong>δεν</strong> αντικατοπτρίζουν
          πλήρως την πραγματική εμπορική κίνηση.
        </li>
        <li>
          <strong>Δεσμευμένα κεφάλαια (άθροισμα εκτιμήσεων):</strong> περίπου{' '}
          <strong>{procPct}%</strong> από πεδίο procurement, <strong>{compPct}%</strong> υπολογιστικό
          (κόστος × διαθέσιμο απόθεμα){restPct > 0 ? `, λοιπά ~${restPct}%` : ''}. Το υπολογιστικό μέρος
          εξαρτάται από την ορθότητα κόστους και αποθέματος στις πηγές σας.
        </li>
        <li>
          <strong>Κωδικοί με απόθεμα αλλά χωρίς κόστος για εκτίμηση:</strong>{' '}
          {quality.skusStockWithoutCost.toLocaleString('el-GR')} (
          <strong>{stockNoCostPct}%</strong>) — για αυτούς το δεσμευμένο εμφανίζεται ως μηδέν.
        </li>
        <li>
          Το <strong>άθροισμα των προϊόντων που εμφανίζονται στις κατηγορίες</strong> μπορεί να είναι
          μεγαλύτερο από το σύνολο των SKU, γιατί το ίδιο προϊόν μπορεί να ανήκει ταυτόχρονα σε
          περισσότερες από μία κατηγορίες.
        </li>
      </ul>
      {dominantUnknown && (
        <p className="mt-2 text-[11px] text-gray-800 font-medium">
          Μεγάλο μέρος του καταλόγου παραμένει σε «ανεπαρκή σήματα» — η διάγνωση εδώ είναι{' '}
          <strong>μερική</strong> έως ότου ενισχυθούν οι πηγές.
        </p>
      )}
      <p className="mt-2 pt-2 border-t border-black/5 text-[11px] text-gray-700">
        Οι κατηγορίες εδώ είναι <strong>υποστήριξη απόφασης</strong>, όχι υποκατάστατο ERP, απογραφής ή
        λογιστικής. Για κρίσιμες αποφάσεις (αγορές, απόσυρση, τιμολόγηση, δεσμεύσεις κεφαλαίου)
        επιβεβαιώστε με τα εσωτερικά σας στοιχεία και τις διαδικασίες ελέγχου.
      </p>
    </div>
  );
}

interface TriageCardProps {
  onSelectPolicy?: (
    policy: NonNullable<RecommendedPolicy>,
    fromBucket: BucketId,
    payload: { skus: string[]; productIds: string[]; label: string; tiedCapital: number }
  ) => void;
}

export function TriageCard({ onSelectPolicy }: TriageCardProps) {
  const {
    counts, tiedByBucket, totalProducts, isLoading, defs,
    totalTiedCapital, assignments, dataQuality,
  } = useDecisionBuckets();
  const [expanded, setExpanded] = useState<BucketId | null>(null);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const [viewAllBucket, setViewAllBucket] = useState<BucketId | null>(null);
  /** false = συμπαγής γραμμή (~1/4 ύψους), true = πλήρης κεφαλίδα + στατιστικά. */
  const [headerSummaryExpanded, setHeaderSummaryExpanded] = useState(false);

  // Data availability — για empty state checklist
  const { connectedPlatforms, skuMovement, stockMovementBaselineDate } = useEcommerceSummary();
  const { hasData: hasProcurement } = useProcurement();
  const hasOrders = (connectedPlatforms?.length ?? 0) > 0;
  const hasMovementData = !!stockMovementBaselineDate || Object.keys(skuMovement || {}).length > 0;

  // Νέα/άγνωστο breakdown
  const unknownBreakdown = useMemo(() => {
    const out = { new_sku: 0, no_signals: 0, virtual_sku: 0 };
    for (const a of assignments) {
      if (a.buckets.includes('new_or_unknown') && a.meta.unknownReason) {
        out[a.meta.unknownReason]++;
      }
    }
    return out;
  }, [assignments]);

  const allByBucket = useMemo(() => {
    const out = {
      dead_capital: [] as BucketAssignment[],
      stockout_risk: [] as BucketAssignment[],
      hot_seller: [] as BucketAssignment[],
      margin_bleeder: [] as BucketAssignment[],
      slow_mover: [] as BucketAssignment[],
      discontinue: [] as BucketAssignment[],
      replenish_now: [] as BucketAssignment[],
      new_or_unknown: [] as BucketAssignment[],
    };
    for (const assignment of assignments) {
      for (const bucket of assignment.buckets) {
        out[bucket].push(assignment);
      }
    }
    for (const bucket of Object.keys(out) as BucketId[]) {
      out[bucket].sort((a, b) => b.severity - a.severity);
    }
    return out;
  }, [assignments]);

  /** Μοναδικά SKU με ≥1 bucket (το άθροισμα counts ανά bucket μπορεί να είναι μεγαλύτερο). */
  const skusWithAnyBucket = useMemo(
    () => assignments.filter((a) => a.buckets.length > 0).length,
    [assignments]
  );

  // ── LOADING STATE ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white p-5 animate-pulse">
        <div className="h-5 w-64 bg-gray-100 rounded mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-24 bg-gray-50 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ── EMPTY: NO PRODUCTS ────────────────────────────────────────────
  if (totalProducts === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--nts-border-gray)] bg-white p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 p-2 rounded-lg bg-slate-100">
            <Boxes size={18} className="text-slate-500" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">Καμία διάγνωση ακόμη</div>
            <div className="text-[12px] text-gray-600 mt-1">
              Ανέβασε κατάλογο προϊόντων για να εμφανιστεί η διάγνωση προτεραιοτήτων (με βάση και τις διαθέσιμες πηγές σημάτων).
            </div>
          </div>
        </div>
      </div>
    );
  }

  const visibleGroups = BUCKET_GROUPS
    .map((g) => ({ ...g, activeBuckets: g.buckets.filter((b) => counts[b] > 0) }))
    .filter((g) => g.activeBuckets.length > 0);

  // ── EMPTY: NO SIGNALS AT ALL ─────────────────────────────────────
  if (visibleGroups.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="shrink-0 p-2 rounded-lg bg-amber-100">
            <Info size={18} className="text-amber-700" />
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-900">
              {totalProducts.toLocaleString('el-GR')} SKUs — χωρίς εμπορικές κατηγορίες διάγνωσης
            </div>
            <div className="text-[12px] text-gray-600 mt-1">
              Τα προϊόντα έχουν εισαχθεί αλλά χρειαζόμαστε δεδομένα κίνησης για να εντοπίσουμε
              ευκαιρίες και ρίσκα. Ενεργοποίησε μία από τις παρακάτω πηγές:
            </div>
          </div>
        </div>
        <DataChecklist hasOrders={hasOrders} hasMovement={!!hasMovementData} hasProcurement={!!hasProcurement} />
      </div>
    );
  }

  const scrollToGroup = (groupId: BucketGroupId) => {
    document.getElementById(`triage-section-${groupId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white overflow-hidden">
      {/* HEADER — προεπιλογή συμπαγής: tabs + αριθμοί, ~1/4 του προηγούμενου ύψους */}
      <div className="border-b border-gray-100 bg-white">
        {!headerSummaryExpanded ? (
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-2 py-1 sm:px-2.5">
            <button
              type="button"
              aria-expanded={false}
              aria-label="Ανάπτυξη κεφαλίδας διάγνωσης"
              onClick={() => setHeaderSummaryExpanded(true)}
              className="shrink-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
            >
              <ChevronRight size={16} strokeWidth={2.25} />
            </button>
            <span className="shrink-0 text-[11px] font-semibold tracking-tight text-gray-900 sm:text-xs">
              Εμπορικές προτεραιότητες
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:justify-center">
              {visibleGroups.map((g) => {
                const groupCount = g.activeBuckets.reduce((s, b) => s + counts[b], 0);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => scrollToGroup(g.id)}
                    className={`inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold tabular-nums transition-colors ${GROUP_TAB_PILL[g.id]}`}
                    title={`${g.label}: ${groupCount.toLocaleString('el-GR')} SKU`}
                  >
                    <span>{GROUP_TAB_LABEL[g.id]}</span>
                    <span className="opacity-90">{groupCount.toLocaleString('el-GR')}</span>
                  </button>
                );
              })}
            </div>
            <span className="hidden shrink-0 text-[10px] tabular-nums text-gray-500 md:inline">
              {totalProducts.toLocaleString('el-GR')} SKU
              <span className="mx-1 text-gray-300">·</span>
              {fmtEur(totalTiedCapital)}
            </span>
            <button
              type="button"
              onClick={() => {
                setHeaderSummaryExpanded(true);
                setShowDocumentation(true);
              }}
              className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
              title="Τεκμηρίωση προτεραιοτήτων και σήματα αξιολόγησης"
            >
              <HelpCircle size={12} className="text-slate-500" />
              <span className="hidden sm:inline">Τεκμ.</span>
            </button>
          </div>
        ) : (
          <div className="px-3 pb-2 pt-2 sm:px-4 sm:pb-2.5 sm:pt-2.5">
            <div className="flex items-start gap-2">
              <button
                type="button"
                aria-expanded
                aria-label="Σύμπτυξη κεφαλίδας"
                onClick={() => {
                  setHeaderSummaryExpanded(false);
                  setShowDocumentation(false);
                }}
                className="shrink-0 rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-800 mt-0.5"
              >
                <ChevronUp size={16} strokeWidth={2.25} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="text-sm font-bold text-gray-900 sm:text-base">Εμπορικές Προτεραιότητες</h3>
                  <button
                    type="button"
                    onClick={() => setShowDocumentation((s) => !s)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-100 sm:text-[11px]"
                    title="Προβολή τεκμηρίωσης και σημάτων αξιολόγησης"
                  >
                    Τεκμηρίωση &amp; σήματα
                    {showDocumentation ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  </button>
                </div>
                <div className="mt-0.5 text-[10px] text-gray-500 sm:text-[11px]">
                  {totalProducts.toLocaleString('el-GR')} SKUs στον κατάλογο
                  {' · '}
                  {skusWithAnyBucket.toLocaleString('el-GR')} με κατηγορία παρακάτω
                  {' · '}
                  δεσμευμένα (άθροισμα): <strong className="text-gray-700">{fmtEur(totalTiedCapital)}</strong>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {visibleGroups.map((g) => {
                    const groupCount = g.activeBuckets.reduce((s, b) => s + counts[b], 0);
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => scrollToGroup(g.id)}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold tabular-nums transition-colors ${GROUP_TAB_PILL[g.id]}`}
                      >
                        {GROUP_TAB_LABEL[g.id]}
                        <span className="font-bold opacity-90">{groupCount.toLocaleString('el-GR')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {showDocumentation && (
        <div className="px-5 py-3 bg-slate-50/95 border-b border-gray-100 space-y-3">
          <div className="text-[12px] text-gray-600 max-w-3xl leading-relaxed">
            Εδώ οι κωδικοί ομαδοποιούνται με βάση <strong>συνδυασμό καταλόγου και σημάτων</strong> (πωλήσεις,
            παράθυρα ζήτησης, κίνηση αποθέματος, κόστη από procurement). <strong>Δεν</strong> είναι το ίδιο με τις
            κάρτες Dead / Excess στο Product Intelligence, που ακολουθούν απευθείας τους κανόνες του ERP.
          </div>
          {dataQuality && (
            <TriageDataReliabilityCallout
              quality={dataQuality}
              totalTiedCapital={totalTiedCapital}
              newOrUnknownCount={counts.new_or_unknown}
            />
          )}
          <div>
            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Από πού προέρχονται τα δεδομένα
            </div>
              <div className="grid sm:grid-cols-2 gap-3 text-[12px]">
              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <Database size={14} className="text-slate-500 shrink-0" aria-hidden />
                  Απόθεμα &amp; βαθμολόγηση (Procurement / ERP)
                </div>
                <p className="mt-1.5 text-slate-600 leading-snug">
                  Στο <strong>Product Intelligence</strong> τα dead / excess / low προκύπτουν <strong>απευθείας από το φύλλο</strong>{' '}
                  (αξιολόγηση είδους, status κωδικού, ανατροφοδότηση, απόθεμα × κόστος).
                </p>
              </div>
              <div className="rounded-lg border border-indigo-200/70 bg-indigo-50/50 p-3 shadow-sm">
                <div className="font-semibold text-indigo-950 flex items-center gap-1.5">
                  <Plug size={14} className="text-indigo-600 shrink-0" aria-hidden />
                  Εμπορική διάγνωση (ενότητες &amp; αριθμοί κάτω)
                </div>
                <p className="mt-1.5 text-indigo-900/85 leading-snug">
                  Τα <strong>πλήθη προϊόντων</strong> δίπλα σε κάθε ενότητα (π.χ. «Άμεση προτεραιότητα», συγκεκριμένο bucket)
                  μετρούν πόσα SKUs μπήκαν σε <strong>κανόνες αυτής της διάγνωσης</strong>, αφού συνδυαστεί ο κατάλογος με{' '}
                  <strong>πωλήσεις, ζήτηση και κίνηση</strong> όπου υπάρχουν πηγές. <strong>Δεν</strong> είναι οι ίδιοι
                  αριθμοί με τις κάρτες dead / excess / low στο <strong>Product Intelligence</strong>.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GROUPED SECTIONS — compact cards, accent bar (όχι πλήρες tinted panels) */}
      <div className="p-4 space-y-3">
        {visibleGroups.map((group) => {
          const style = GROUP_STYLES[group.id];
          const GroupIcon = style.icon;
          const groupTied = group.activeBuckets.reduce((s, b) => s + tiedByBucket[b], 0);
          const groupCount = group.activeBuckets.reduce((s, b) => s + counts[b], 0);
          return (
            <section
              id={`triage-section-${group.id}`}
              key={group.id}
              className={`scroll-mt-3 rounded-xl border ${style.border} border-l-[3px] ${style.leftBar} bg-white shadow-sm pl-3 pr-3 py-2.5`}
            >
              <header className="mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`shrink-0 p-1 rounded-md ${style.chip}`}>
                    <GroupIcon size={13} className="opacity-90" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <h4 className={`text-sm font-semibold tracking-tight ${style.titleText}`}>{group.label}</h4>
                      <span className="text-[11px] font-medium tabular-nums text-gray-500">
                        {groupCount.toLocaleString('el-GR')}
                        <span className="font-normal text-gray-400"> SKU</span>
                        {groupTied > 0 && (
                          <>
                            <span className="mx-1 text-gray-300">·</span>
                            <span className="text-gray-600">{fmtEur(groupTied)}</span>
                            <span className="font-normal text-gray-400"> δεσμ.</span>
                          </>
                        )}
                      </span>
                    </div>
                    <p className={`text-[11px] leading-snug mt-0.5 line-clamp-2 ${style.subtitleText}`}>
                      {group.subtitle}
                    </p>
                  </div>
                </div>
              </header>

              {group.id === 'investigate' && counts.new_or_unknown > 0 && (
                <InsufficientSignalsHint
                  hasOrders={hasOrders}
                  hasMovement={hasMovementData}
                  hasProcurement={!!hasProcurement}
                  noSignalsCount={unknownBreakdown.no_signals}
                  totalUnknown={counts.new_or_unknown}
                />
              )}

              {group.id === 'critical' && onSelectPolicy && (
                <PriorityPolicyActions
                  buckets={group.activeBuckets}
                  defs={defs}
                  counts={counts}
                  tiedByBucket={tiedByBucket}
                  allByBucket={allByBucket}
                  onSelectPolicy={onSelectPolicy}
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {group.activeBuckets.map((b) => {
                  const def = defs[b];
                  const Icon = ICONS[b];
                  const colors = BUCKET_COLOR[b];
                  const count = counts[b];
                  const tied = tiedByBucket[b];
                  const isOpen = expanded === b;
                  const tiedShare = totalTiedCapital > 0 ? Math.min(100, Math.round((tied / totalTiedCapital) * 100)) : 0;
                  const soleInGroup = group.activeBuckets.length === 1;

                  return (
                    <button
                      key={b}
                      onClick={() => setExpanded(isOpen ? null : b)}
                      className={`text-left rounded-lg border bg-white border-gray-200/90 px-2.5 py-2 min-h-[84px] transition-all hover:border-gray-300 hover:shadow-sm ${
                        isOpen ? `ring-1 ${colors.ring} border-gray-300` : ''
                      }`}
                    >
                      <div className={`flex items-start gap-1.5 mb-1 ${soleInGroup ? '' : 'justify-between'}`}>
                        <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${colors.bg}`}>
                          <Icon size={11} className={colors.text} />
                          <span className={`text-[9px] font-semibold ${colors.text} uppercase tracking-wide`}>
                            {def.shortLabel}
                          </span>
                        </div>
                        {!soleInGroup && (
                          <span className="text-sm font-bold text-gray-900 leading-none tabular-nums">{count}</span>
                        )}
                      </div>
                      <div className="text-[11px] font-semibold text-gray-800 leading-snug line-clamp-2">{def.label}</div>
                      {!soleInGroup && tied > 0 && (
                        <>
                          <div className="text-[10px] text-gray-500 mt-1.5">
                            {fmtEur(tied)} στο scope · {tiedShare}% της συνολικής αξίας
                          </div>
                          <div className="mt-1 h-1 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className={`h-full ${colors.bg} rounded-full`}
                              style={{ width: `${Math.max(2, tiedShare)}%`, opacity: 0.8 }}
                            />
                          </div>
                        </>
                      )}
                      <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-gray-500">
                        <ChevronDown
                          size={10}
                          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        />
                        {isOpen ? 'Κλείσιμο' : 'Ανάλυση'}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* EXPANDED PANEL */}
              {expanded && group.activeBuckets.includes(expanded) && (
                <ExpandedPanel
                  bucket={expanded}
                  defs={defs}
                  assignments={allByBucket[expanded]}
                  totalCount={counts[expanded]}
                  tiedTotal={tiedByBucket[expanded]}
                  unknownBreakdown={expanded === 'new_or_unknown' ? unknownBreakdown : undefined}
                  onSelectPolicy={onSelectPolicy}
                  onViewAll={() => setViewAllBucket(expanded)}
                />
              )}
            </section>
          );
        })}
      </div>

      {viewAllBucket && (
        <AllBucketProductsModal
          bucket={viewAllBucket}
          defs={defs}
          assignments={allByBucket[viewAllBucket]}
          onClose={() => setViewAllBucket(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────

/** Συνοπτική εξήγηση γιατί πολλά SKU μένουν σε new_or_unknown — χωρίς επανάληψη των αριθμών της κάρτας. */
function InsufficientSignalsHint({
  hasOrders,
  hasMovement,
  hasProcurement,
  noSignalsCount,
  totalUnknown,
}: {
  hasOrders: boolean;
  hasMovement: boolean;
  hasProcurement: boolean;
  noSignalsCount: number;
  totalUnknown: number;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const share = totalUnknown > 0 ? Math.round((noSignalsCount / totalUnknown) * 100) : 0;
  const dominantNoSignals = totalUnknown > 0 && noSignalsCount / totalUnknown >= 0.4;

  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-white/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <div className="min-w-0">
          <div className="font-semibold text-slate-800 text-[12px]">Ανεπαρκή σήματα αξιολόγησης</div>
          <div className="mt-0.5 text-[11px] text-slate-600">
            Τι σημαίνει αυτή η ομάδα και ποια δεδομένα λείπουν.
          </div>
        </div>
        <div className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
          {isOpen ? 'Κλείσιμο' : 'Προβολή'}
          {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </button>
      {isOpen && (
        <div className="border-t border-slate-200 px-3 py-2.5 text-[11px] text-slate-700 leading-snug">
          <p className="text-slate-600">
            Ο κατάλογος και τα βασικά πεδία SKU υπάρχουν. Για να βγει ασφαλής εμπορική διάγνωση χρειαζόμαστε
            τουλάχιστον μία πηγή κίνησης: παραγγελίες από e-shop, ιστορικό μεταβολών αποθέματος ή procurement
            (κόστη / κίνηση). Χωρίς αυτά ο κωδικός παραμένει εδώ, όχι επειδή «λείπει το προϊόν», αλλά επειδή
            δεν υπάρχει ακόμη επαρκές ιστορικό για ρίσκο ή ευκαιρία.
          </p>
          {dominantNoSignals && (
            <p className="mt-1.5 text-slate-600">
              Στο τρέχον snapshot περίπου το <strong>{share}%</strong> αυτής της ομάδας έχει ετικέτα «λείπουν σήματα
              κίνησης/κόστους» — έλεγξε τις παρακάτω συνδέσεις.
            </p>
          )}
          <ul className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            <li
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${
                hasOrders ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <Plug size={12} className="shrink-0 opacity-80" />
              <span>{hasOrders ? 'E-shop: ενεργό' : 'E-shop: όχι σύνδεση'}</span>
            </li>
            <li
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${
                hasMovement ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <TrendingDown size={12} className="shrink-0 opacity-80" />
              <span>{hasMovement ? 'Stock movement: ναι' : 'Stock movement: όχι'}</span>
            </li>
            <li
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${
                hasProcurement ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'
              }`}
            >
              <Database size={12} className="shrink-0 opacity-80" />
              <span>{hasProcurement ? 'Procurement: ναι' : 'Procurement: όχι'}</span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}

function getPolicyName(policy: RecommendedPolicy | null | undefined): string | null {
  if (!policy) return null;
  switch (policy) {
    case 'stock_clearance':
      return 'Stock Clearance';
    case 'profit_max':
      return 'Profit Maximization';
    case 'seasonal_discount':
      return 'Εποχιακή / Εκπτωτική';
    case 'price_benchmark':
      return 'Price Benchmarking';
    default:
      return null;
  }
}

function getRecommendationLabel(policy: RecommendedPolicy | null | undefined): string {
  return policy === 'price_benchmark' ? 'Προτεινόμενη λειτουργία' : 'Προτεινόμενη πολιτική';
}

function getRecommendationActionText(policy: RecommendedPolicy | null | undefined): string {
  return policy === 'price_benchmark' ? 'Άνοιγμα λειτουργίας' : 'Άνοιγμα';
}

function getPriorityCardTone(bucket: BucketId): {
  shell: string;
  eyebrow: string;
  metric: string;
  border: string;
} {
  switch (bucket) {
    case 'dead_capital':
      return {
        shell: 'border-rose-200/80 bg-rose-50/40 hover:border-rose-300',
        eyebrow: 'bg-rose-100/90 text-rose-800',
        metric: 'text-rose-700',
        border: 'border-rose-100/80',
      };
    case 'stockout_risk':
      return {
        shell: 'border-orange-200/80 bg-orange-50/35 hover:border-orange-300',
        eyebrow: 'bg-orange-100/90 text-orange-800',
        metric: 'text-orange-700',
        border: 'border-orange-100/80',
      };
    case 'margin_bleeder':
      return {
        shell: 'border-amber-200/80 bg-amber-50/35 hover:border-amber-300',
        eyebrow: 'bg-amber-100/90 text-amber-900',
        metric: 'text-amber-800',
        border: 'border-amber-100/80',
      };
    default:
      return {
        shell: 'border-slate-200 bg-slate-50/50 hover:border-slate-300',
        eyebrow: 'bg-slate-100 text-slate-700',
        metric: 'text-slate-800',
        border: 'border-slate-100',
      };
  }
}

function getPriorityCardOutcome(bucket: BucketId): string {
  switch (bucket) {
    case 'dead_capital':
      return 'Απελευθέρωση κεφαλαίου από στάσιμο απόθεμα.';
    case 'stockout_risk':
      return 'Προστασία πωλήσεων πριν εμφανιστεί έλλειψη.';
    case 'margin_bleeder':
      return 'Βελτίωση κερδοφορίας μέσω τιμολόγησης και μίγματος.';
    case 'slow_mover':
      return 'Στοχευμένη τόνωση για κωδικούς με χαμηλή κίνηση.';
    default:
      return 'Στοχευμένη εμπορική ενέργεια για την παρούσα ομάδα.';
  }
}

function buildPolicyPayload(
  bucket: BucketId,
  assignments: BucketAssignment[],
  label: string,
  tiedCapital: number
) {
  const skus = assignments
    .map((a) => a.sku)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  const productIds = assignments
    .map((a) => a.productId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  return {
    fromBucket: bucket,
    payload: { skus, productIds, label, tiedCapital },
  };
}

function PriorityPolicyActions({
  buckets,
  defs,
  counts,
  tiedByBucket,
  allByBucket,
  onSelectPolicy,
}: {
  buckets: BucketId[];
  defs: ReturnType<typeof useDecisionBuckets>['defs'];
  counts: ReturnType<typeof useDecisionBuckets>['counts'];
  tiedByBucket: ReturnType<typeof useDecisionBuckets>['tiedByBucket'];
  allByBucket: Record<BucketId, BucketAssignment[]>;
  onSelectPolicy: NonNullable<TriageCardProps['onSelectPolicy']>;
}) {
  const actionable = buckets.filter((bucket) => !!defs[bucket].recommendedPolicy);
  if (actionable.length === 0) return null;

  return (
    <div className="mb-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {actionable.map((bucket) => {
        const def = defs[bucket];
        const policyName = getPolicyName(def.recommendedPolicy);
        if (!policyName) return null;
        const tone = getPriorityCardTone(bucket);
        const productCount = counts[bucket];
        const tiedCapital = tiedByBucket[bucket];

        return (
          <button
            key={bucket}
            type="button"
            onClick={() => {
              const { fromBucket, payload } = buildPolicyPayload(
                bucket,
                allByBucket[bucket],
                def.label,
                tiedByBucket[bucket]
              );
              onSelectPolicy(def.recommendedPolicy as NonNullable<RecommendedPolicy>, fromBucket, payload);
            }}
            className={`rounded-lg border text-left transition-all hover:shadow-sm ${tone.shell}`}
          >
            <div className="flex flex-col gap-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${tone.eyebrow}`}>
                    {def.shortLabel}
                  </div>
                  <div className="mt-1 text-[13px] font-semibold leading-snug text-gray-900 line-clamp-2">{def.label}</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-gray-600 line-clamp-2">
                    {getPriorityCardOutcome(bucket)}
                  </div>
                </div>
              </div>
              <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border px-2.5 py-1.5 ${tone.border} bg-white/70`}>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[9px] uppercase tracking-wide text-gray-500">Προϊόντα</span>
                  <span className="text-sm font-bold tabular-nums text-gray-900">
                    {productCount.toLocaleString('el-GR')}
                  </span>
                </div>
                <div className="h-3 w-px bg-gray-200 hidden sm:block" aria-hidden />
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[9px] uppercase tracking-wide text-gray-500">Scope</span>
                  <span className={`text-sm font-bold tabular-nums ${tiedCapital > 0 ? tone.metric : 'text-gray-900'}`}>
                    {tiedCapital > 0 ? fmtEur(tiedCapital) : '—'}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 pt-0.5 border-t border-black/[0.06]">
                <div className="min-w-0">
                  <div className="text-[9px] uppercase tracking-wide text-gray-500">
                    {getRecommendationLabel(def.recommendedPolicy)}
                  </div>
                  <div className="text-[11px] font-semibold text-gray-800 truncate">{policyName}</div>
                </div>
                <div className="shrink-0 inline-flex items-center gap-0.5 rounded-md bg-[var(--nts-accent)] px-2.5 py-1.5 text-[10px] font-semibold text-white hover:opacity-90">
                  {getRecommendationActionText(def.recommendedPolicy)}
                  <ChevronRight size={11} />
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AllBucketProductsModal({
  bucket,
  defs,
  assignments,
  onClose,
}: {
  bucket: BucketId;
  defs: ReturnType<typeof useDecisionBuckets>['defs'];
  assignments: BucketAssignment[];
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;
  const totalPages = Math.max(1, Math.ceil(assignments.length / PAGE_SIZE));
  const visibleRows = assignments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const def = defs[bucket];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-6xl rounded-2xl bg-white shadow-2xl overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <div className="text-base font-bold text-gray-900">{def.label}</div>
            <div className="mt-1 text-[12px] text-gray-600">
              Προβάλλονται όλα τα προϊόντα της κατηγορίας, ταξινομημένα κατά προτεραιότητα.
            </div>
            <div className="mt-1.5 text-[11px] text-gray-500">
              {assignments.length.toLocaleString('el-GR')} προϊόντα συνολικά
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            title="Κλείσιμο"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-gray-50">
              <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                <th className="text-left font-semibold px-3 py-2">SKU / Προϊόν</th>
                <th className="text-right font-semibold px-2 py-2">Stock</th>
                <th className="text-right font-semibold px-2 py-2">Πωλ. 30η</th>
                <th className="text-right font-semibold px-2 py-2">Επάρκεια</th>
                <th
                  className="text-right font-semibold px-2 py-2"
                  title="Τιμή πώλησης − κόστος, ως % επί της τιμής πώλησης. Δεν είναι καθαρό κέρδος μετά έξοδα."
                >
                  Μικτό %
                </th>
                <th className="text-right font-semibold px-2 py-2">Κεφάλαια</th>
                <th className="text-right font-semibold px-3 py-2">Last sale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRows.map((a) => (
                <tr key={`${a.productId}-${a.sku}`} className="hover:bg-gray-50 transition-colors align-top">
                  <td className="px-3 py-2.5 max-w-[320px]">
                    <div className="font-mono text-[11px] text-gray-900 truncate">{a.sku}</div>
                    <div className="text-[11px] text-gray-600 truncate">{a.productName}</div>
                    {a.reasons[bucket] && (
                      <div className="mt-1 text-[10px] text-gray-500 italic leading-snug">
                        {a.reasons[bucket]}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-700">{fmtNum(a.meta.stock)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-700">{fmtNum(a.meta.qty30d)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {typeof a.meta.daysOfCover === 'number' ? (
                      <span className={a.meta.daysOfCover < 14 ? 'text-orange-700 font-semibold' : 'text-gray-700'}>
                        {a.meta.daysOfCover}η
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {typeof a.meta.marginPct === 'number' ? (
                      <span className={a.meta.marginPct < 5 ? 'text-rose-700 font-semibold' : a.meta.marginPct >= 20 ? 'text-emerald-700' : 'text-gray-700'}>
                        {a.meta.marginPct.toFixed(0)}%
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-medium text-gray-900">{fmtEur(a.tiedCapital)}</td>
                  <td className="px-3 py-2.5 text-right text-[11px] text-gray-500 whitespace-nowrap">
                    <Clock size={9} className="inline mr-0.5 -mt-0.5" />
                    {fmtRelative(a.meta.lastSaleAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {assignments.length > PAGE_SIZE && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-5 py-3 text-[11px] text-gray-600">
            <span>
              Εμφανίζονται {((page - 1) * PAGE_SIZE) + 1}–{Math.min(page * PAGE_SIZE, assignments.length)} από {assignments.length.toLocaleString('el-GR')} προϊόντα
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 disabled:opacity-50"
              >
                Προηγούμενα
              </button>
              <span>Σελίδα {page} από {totalPages}</span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 disabled:opacity-50"
              >
                Επόμενα
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ExpandedPanelProps {
  bucket: BucketId;
  defs: ReturnType<typeof useDecisionBuckets>['defs'];
  assignments: BucketAssignment[];
  totalCount: number;
  tiedTotal: number;
  unknownBreakdown?: { new_sku: number; no_signals: number; virtual_sku: number };
  onSelectPolicy?: TriageCardProps['onSelectPolicy'];
  onViewAll?: () => void;
}

function ExpandedPanel({
  bucket, defs, assignments, totalCount, tiedTotal,
  unknownBreakdown, onSelectPolicy, onViewAll,
}: ExpandedPanelProps) {
  const def = defs[bucket];
  const showCount = Math.min(10, assignments.length);
  const remaining = totalCount - showCount;
  const recommendedPolicyName = getPolicyName(def.recommendedPolicy);

  return (
    <div className="mt-3 rounded-lg bg-white border border-gray-200 overflow-hidden">
      {/* Panel header — χωρίς επανάληψη τίτλου από την κάρτα πάνω· μόνο περιγραφή + ενέργειες */}
      <div className="px-3.5 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] text-gray-800 leading-relaxed">{def.description}</div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {recommendedPolicyName && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-gray-400">
                {getRecommendationLabel(def.recommendedPolicy)}
              </div>
              <div className="text-[11px] font-semibold text-gray-700">{recommendedPolicyName}</div>
            </div>
          )}
          {def.recommendedPolicy && onSelectPolicy && (
            <button
              onClick={() => {
                const { fromBucket, payload } = buildPolicyPayload(
                  bucket,
                  assignments,
                  def.label,
                  tiedTotal
                );
                onSelectPolicy(
                  def.recommendedPolicy as NonNullable<RecommendedPolicy>,
                  fromBucket,
                  payload
                );
              }}
              className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[var(--nts-accent)] text-white text-[11px] font-semibold hover:opacity-90 transition-opacity"
            >
              {def.cta}
              <ChevronRight size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Special breakdown για new_or_unknown */}
      {bucket === 'new_or_unknown' && unknownBreakdown && (
        <div className="px-3.5 py-2.5 bg-slate-50 border-b border-gray-100 grid grid-cols-3 gap-2">
          <UnknownChip label="Νέα προϊόντα" sub="< 30 ημέρες" count={unknownBreakdown.new_sku} icon={Sparkles} />
          <UnknownChip label="Virtual SKUs" sub="gift cards / υπηρεσίες" count={unknownBreakdown.virtual_sku} icon={Package} />
          <UnknownChip label="Χωρίς σήματα" sub="πωλήσεις / κίνηση / κόστος" count={unknownBreakdown.no_signals} icon={Database} />
        </div>
      )}

      {/* SKU Table */}
      {assignments.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                <th className="text-left font-semibold px-3 py-2">SKU / Προϊόν</th>
                <th className="text-right font-semibold px-2 py-2">Stock</th>
                <th className="text-right font-semibold px-2 py-2">Πωλ. 30η</th>
                <th className="text-right font-semibold px-2 py-2">Επάρκεια</th>
                <th
                  className="text-right font-semibold px-2 py-2"
                  title="Τιμή πώλησης − κόστος, ως % επί της τιμής πώλησης. Δεν είναι καθαρό κέρδος μετά έξοδα."
                >
                  Μικτό %
                </th>
                <th className="text-right font-semibold px-2 py-2">Κεφάλαια</th>
                <th className="text-right font-semibold px-3 py-2">Last sale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assignments.slice(0, 10).map((a) => (
                <tr key={a.productId} className="hover:bg-gray-50 transition-colors align-top">
                  <td className="px-3 py-2.5 max-w-[280px]">
                    <div className="font-mono text-[11px] text-gray-900 truncate">{a.sku}</div>
                    <div className="text-[11px] text-gray-600 truncate">{a.productName}</div>
                    {a.reasons[bucket] && (
                      <div className="mt-1 text-[10px] text-gray-500 italic leading-snug">
                        {a.reasons[bucket]}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-700">{fmtNum(a.meta.stock)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums text-gray-700">{fmtNum(a.meta.qty30d)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {typeof a.meta.daysOfCover === 'number' ? (
                      <span className={a.meta.daysOfCover < 14 ? 'text-orange-700 font-semibold' : 'text-gray-700'}>
                        {a.meta.daysOfCover}η
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {typeof a.meta.marginPct === 'number' ? (
                      <span className={a.meta.marginPct < 5 ? 'text-rose-700 font-semibold' : a.meta.marginPct >= 20 ? 'text-emerald-700' : 'text-gray-700'}>
                        {a.meta.marginPct.toFixed(0)}%
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums font-medium text-gray-900">{fmtEur(a.tiedCapital)}</td>
                  <td className="px-3 py-2.5 text-right text-[11px] text-gray-500 whitespace-nowrap">
                    <Clock size={9} className="inline mr-0.5 -mt-0.5" />
                    {fmtRelative(a.meta.lastSaleAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="px-3.5 py-4 text-[12px] text-gray-500">Δεν υπάρχουν διαθέσιμα SKUs για αυτό το bucket.</div>
      )}

      {/* Footer */}
      <div className="px-3.5 py-2 bg-gray-50 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-600">
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Εμφανίζονται {showCount} από {totalCount.toLocaleString('el-GR')} προϊόντα
            {remaining > 0 && <span className="text-gray-500"> · {remaining.toLocaleString('el-GR')} ακόμη διαθέσιμα</span>}
          </span>
          {totalCount > showCount && onViewAll && (
            <button
              type="button"
              onClick={onViewAll}
              className="text-[11px] font-semibold text-[var(--nts-accent)] hover:underline"
            >
              Προβολή όλων
            </button>
          )}
        </div>
        <span className="text-[10px] text-gray-500">
          {bucket === 'new_or_unknown' && (unknownBreakdown?.no_signals ?? 0) > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Plug size={10} /> Σύνδεση παραγγελιών ή procurement μειώνει αυτή την ομάδα
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function UnknownChip({
  label, sub, count, icon: Icon,
}: {
  label: string; sub: string; count: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="rounded-md bg-white border border-gray-200 px-2.5 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={11} className="text-slate-500 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-gray-800 truncate">{label}</div>
            <div className="text-[10px] text-gray-500 truncate">{sub}</div>
          </div>
        </div>
        <div className="text-sm font-bold text-gray-900 tabular-nums shrink-0">
          {count.toLocaleString('el-GR')}
        </div>
      </div>
    </div>
  );
}

function DataChecklist({
  hasOrders, hasMovement, hasProcurement,
}: { hasOrders: boolean; hasMovement: boolean; hasProcurement: boolean }) {
  const items = [
    {
      ok: hasOrders,
      icon: Plug,
      label: 'Σύνδεση e-shop (Shopify, WooCommerce, Magento, OpenCart)',
      help: 'Παρέχει δεδομένα παραγγελιών σε πραγματικό χρόνο και ενισχύει την αναγνώριση ζήτησης, ελλείψεων και ασθενούς περιθωρίου.',
    },
    {
      ok: hasMovement,
      icon: TrendingDown,
      label: 'Stock movement (καθημερινά snapshots αποθέματος)',
      help: 'Λειτουργεί ως εναλλακτική πηγή για brands χωρίς σύνδεση παραγγελιών, εκτιμώντας την κίνηση από τις μεταβολές αποθέματος.',
    },
    {
      ok: hasProcurement,
      icon: Database,
      label: 'Procurement export (κόστη, lifetime, αξιολόγηση SKU)',
      help: 'Προσθέτει στοιχεία κόστους, δεσμευμένου κεφαλαίου, ιστορικής κίνησης και αξιολόγησης προϊόντων.',
    },
  ];
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
          <div className={`shrink-0 mt-0.5 p-1.5 rounded ${item.ok ? 'bg-emerald-100' : 'bg-gray-200'}`}>
            <item.icon size={12} className={item.ok ? 'text-emerald-700' : 'text-gray-500'} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`text-[12px] font-semibold ${item.ok ? 'text-emerald-700' : 'text-gray-800'}`}>
                {item.ok ? '✓ ' : ''}{item.label}
              </span>
            </div>
            <div className="text-[11px] text-gray-600 mt-0.5 leading-snug">{item.help}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
