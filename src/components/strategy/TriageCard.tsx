/**
 * TriageCard — «Ποια προϊόντα χρειάζονται προσοχή τώρα»
 *
 * Decision Buckets snapshot με merchant-friendly UI. Ομαδοποιεί τα 8 buckets
 * σε 4 thematic sections (Επείγον / Ευκαιρίες / Παρακολούθηση / Διερεύνηση)
 * και δίνει rich SKU rows με stock, ημέρες επάρκειας, ηλικία, last sale,
 * λόγο ταξινόμησης και προτεινόμενη δράση.
 *
 * Pure UI — όλη η classification logic ζει στο `useDecisionBuckets` /
 * `utils/decisionBuckets`.
 */

import { useMemo, useState } from 'react';
import {
  AlertTriangle, TrendingUp, Zap, Snowflake, XCircle, Package, Sparkles,
  ChevronRight, ChevronDown, HelpCircle, Info, AlertOctagon, TrendingDown,
  Clock, Boxes, Database, Plug,
} from 'lucide-react';
import { useDecisionBuckets } from '../../hooks/useDecisionBuckets';
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

const GROUP_STYLES: Record<BucketGroupId, {
  bg: string; border: string; titleText: string; subtitleText: string; chip: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}> = {
  critical:    { bg: 'bg-rose-50/60',   border: 'border-rose-200',   titleText: 'text-rose-900',   subtitleText: 'text-rose-700/80',   chip: 'bg-rose-100 text-rose-700',   icon: AlertOctagon },
  opportunity: { bg: 'bg-emerald-50/60',border: 'border-emerald-200',titleText: 'text-emerald-900',subtitleText: 'text-emerald-700/80',chip: 'bg-emerald-100 text-emerald-700', icon: TrendingUp },
  watch:       { bg: 'bg-amber-50/60',  border: 'border-amber-200',  titleText: 'text-amber-900',  subtitleText: 'text-amber-700/80',  chip: 'bg-amber-100 text-amber-700', icon: TrendingDown },
  investigate: { bg: 'bg-slate-50',     border: 'border-slate-200',  titleText: 'text-slate-800',  subtitleText: 'text-slate-600',     chip: 'bg-slate-200 text-slate-700', icon: HelpCircle },
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

interface TriageCardProps {
  onSelectPolicy?: (
    policy: NonNullable<RecommendedPolicy>,
    fromBucket: BucketId,
    payload: { skus: string[]; label: string; tiedCapital: number }
  ) => void;
}

export function TriageCard({ onSelectPolicy }: TriageCardProps) {
  const {
    counts, tiedByBucket, totalProducts, isLoading, defs,
    totalTiedCapital, topByBucket, assignments,
  } = useDecisionBuckets();
  const [expanded, setExpanded] = useState<BucketId | null>(null);
  const [showSubtitle, setShowSubtitle] = useState(false);

  // Data availability — για empty state checklist
  const { connectedPlatforms, skuMovement, stockMovementBaselineDate } = useEcommerceSummary();
  const { hasData: hasProcurement } = useProcurement();
  const hasOrders = (connectedPlatforms?.length ?? 0) > 0;
  const hasMovementData = !!stockMovementBaselineDate || Object.keys(skuMovement || {}).length > 0;

  // KPI summary
  const kpis = useMemo(() => {
    const criticalCount = counts.dead_capital + counts.stockout_risk + counts.margin_bleeder;
    const opportunityCount = counts.hot_seller + counts.replenish_now;
    const capitalAtRisk = tiedByBucket.dead_capital + tiedByBucket.slow_mover + tiedByBucket.discontinue;
    return { criticalCount, opportunityCount, capitalAtRisk };
  }, [counts, tiedByBucket]);

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

  // ── LOADING STATE ─────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white p-5 animate-pulse">
        <div className="h-5 w-64 bg-gray-100 rounded mb-4" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-50 rounded-lg" />
          ))}
        </div>
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
            <div className="text-sm font-semibold text-gray-900">Καμία ανάλυση ακόμη</div>
            <div className="text-[12px] text-gray-600 mt-1">
              Ανέβασε κατάλογο προϊόντων για να ξεκινήσει η ταξινόμηση κατά προτεραιότητα.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const visibleGroups = BUCKET_GROUPS
    .map((g) => ({ ...g, activeBuckets: g.buckets.filter((b) => counts[b] > 0) }))
    .filter((g) => g.activeBuckets.length > 0);

  const totalClassified = Object.values(counts).reduce((a, b) => a + b, 0);

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
              {totalProducts.toLocaleString('el-GR')} SKUs αλλά καμία ταξινόμηση
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

  return (
    <div className="rounded-xl border border-[var(--nts-border-gray)] bg-white overflow-hidden">
      {/* HEADER */}
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-gray-900">
                Ποια προϊόντα χρειάζονται προσοχή τώρα
              </h3>
              <button
                onClick={() => setShowSubtitle((s) => !s)}
                className="shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                title="Τι είναι αυτή η ανάλυση;"
              >
                <HelpCircle size={14} />
              </button>
            </div>
            {showSubtitle && (
              <div className="mt-1.5 text-[12px] text-gray-600 max-w-2xl leading-relaxed">
                Η ενότητα αυτή ιεραρχεί τους κωδικούς προϊόντων με βάση την εμπορική τους προτεραιότητα.
                Κάθε ομάδα συνοδεύεται από σαφή ερμηνεία και προτεινόμενη κατεύθυνση ενεργειών.
              </div>
            )}
            <div className="text-[11px] text-gray-500 mt-1">
              {totalProducts.toLocaleString('el-GR')} SKUs αναλύθηκαν
              {' · '}{totalClassified.toLocaleString('el-GR')} ταξινομημένα
              {' · '}σύνολο δεσμευμένων: <strong>{fmtEur(totalTiedCapital)}</strong>
            </div>
          </div>
        </div>

        {/* KPI STRIP */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
          <KpiTile
            label="Άμεση προτεραιότητα"
            value={kpis.criticalCount.toLocaleString('el-GR')}
            tone="rose"
            icon={AlertOctagon}
            sub="αδρανή κεφάλαια, ελλείψεις, χαμηλό περιθώριο"
          />
          <KpiTile
            label="Ευκαιρίες"
            value={kpis.opportunityCount.toLocaleString('el-GR')}
            tone="emerald"
            icon={TrendingUp}
            sub="υψηλή ζήτηση και ανάγκη αναπλήρωσης"
          />
          <KpiTile
            label="Κεφάλαια σε ρίσκο"
            value={fmtEur(kpis.capitalAtRisk)}
            tone="amber"
            icon={AlertTriangle}
            sub="αδρανές, βραδυκίνητο και προς απόσυρση απόθεμα"
          />
          <KpiTile
            label="Ανεπαρκή δεδομένα"
            value={counts.new_or_unknown.toLocaleString('el-GR')}
            tone="slate"
            icon={HelpCircle}
            sub="νέα προϊόντα ή ελλιπή στοιχεία"
          />
        </div>
      </div>

      {/* GROUPED SECTIONS */}
      <div className="p-5 space-y-4">
        {visibleGroups.map((group) => {
          const style = GROUP_STYLES[group.id];
          const GroupIcon = style.icon;
          const groupTied = group.activeBuckets.reduce((s, b) => s + tiedByBucket[b], 0);
          const groupCount = group.activeBuckets.reduce((s, b) => s + counts[b], 0);
          return (
            <section
              key={group.id}
              className={`rounded-lg border ${style.border} ${style.bg} p-3.5`}
            >
              <header className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className={`shrink-0 mt-0.5 p-1.5 rounded ${style.chip}`}>
                    <GroupIcon size={14} />
                  </div>
                  <div className="min-w-0">
                    <div className={`text-[13px] font-bold ${style.titleText}`}>{group.label}</div>
                    <div className={`text-[11px] mt-0.5 ${style.subtitleText}`}>{group.subtitle}</div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-base font-bold ${style.titleText}`}>{groupCount.toLocaleString('el-GR')}</div>
                  {groupTied > 0 && (
                    <div className={`text-[10px] ${style.subtitleText}`}>{fmtEur(groupTied)}</div>
                  )}
                </div>
              </header>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {group.activeBuckets.map((b) => {
                  const def = defs[b];
                  const Icon = ICONS[b];
                  const colors = BUCKET_COLOR[b];
                  const count = counts[b];
                  const tied = tiedByBucket[b];
                  const isOpen = expanded === b;
                  const tiedShare = totalTiedCapital > 0 ? Math.min(100, Math.round((tied / totalTiedCapital) * 100)) : 0;

                  return (
                    <button
                      key={b}
                      onClick={() => setExpanded(isOpen ? null : b)}
                      className={`text-left rounded-lg border bg-white border-gray-200 p-3 transition-all hover:border-gray-300 hover:shadow-sm ${
                        isOpen ? `ring-2 ${colors.ring} border-transparent` : ''
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <div className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded ${colors.bg}`}>
                          <Icon size={12} className={colors.text} />
                          <span className={`text-[10px] font-semibold ${colors.text} uppercase tracking-wide`}>
                            {def.shortLabel}
                          </span>
                        </div>
                        <span className="text-lg font-bold text-gray-900 leading-none">{count}</span>
                      </div>
                      <div className="text-[12px] font-medium text-gray-800 leading-snug">{def.label}</div>
                      {tied > 0 && (
                        <>
                          <div className="text-[11px] text-gray-500 mt-1.5">
                            {fmtEur(tied)} δεσμευμένα · {tiedShare}% του συνόλου
                          </div>
                          <div className="mt-1 h-1 rounded-full bg-gray-100 overflow-hidden">
                            <div
                              className={`h-full ${colors.bg} rounded-full`}
                              style={{ width: `${Math.max(2, tiedShare)}%`, opacity: 0.8 }}
                            />
                          </div>
                        </>
                      )}
                      <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-gray-500">
                        <ChevronDown
                          size={10}
                          className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        />
                        {isOpen ? 'Κλείσιμο' : 'Δες λεπτομέρειες'}
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
                  topAssignments={topByBucket[expanded]}
                  totalCount={counts[expanded]}
                  tiedTotal={tiedByBucket[expanded]}
                  unknownBreakdown={expanded === 'new_or_unknown' ? unknownBreakdown : undefined}
                  onSelectPolicy={onSelectPolicy}
                />
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────

function KpiTile({
  label, value, sub, tone, icon: Icon,
}: {
  label: string; value: string; sub?: string;
  tone: 'rose' | 'emerald' | 'amber' | 'slate';
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  const styles = {
    rose:    { ring: 'border-rose-200',    bg: 'bg-rose-50/40',    text: 'text-rose-700',    iconBg: 'bg-rose-100' },
    emerald: { ring: 'border-emerald-200', bg: 'bg-emerald-50/40', text: 'text-emerald-700', iconBg: 'bg-emerald-100' },
    amber:   { ring: 'border-amber-200',   bg: 'bg-amber-50/40',   text: 'text-amber-700',   iconBg: 'bg-amber-100' },
    slate:   { ring: 'border-slate-200',   bg: 'bg-slate-50',      text: 'text-slate-700',   iconBg: 'bg-slate-200' },
  }[tone];
  return (
    <div className={`rounded-lg border ${styles.ring} ${styles.bg} p-2.5`}>
      <div className="flex items-center gap-2 mb-1">
        <div className={`p-1 rounded ${styles.iconBg}`}>
          <Icon size={11} className={styles.text} />
        </div>
        <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-600">{label}</span>
      </div>
      <div className={`text-lg font-bold ${styles.text} leading-tight`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

interface ExpandedPanelProps {
  bucket: BucketId;
  defs: ReturnType<typeof useDecisionBuckets>['defs'];
  topAssignments: BucketAssignment[];
  totalCount: number;
  tiedTotal: number;
  unknownBreakdown?: { new_sku: number; no_signals: number; virtual_sku: number };
  onSelectPolicy?: TriageCardProps['onSelectPolicy'];
}

function ExpandedPanel({
  bucket, defs, topAssignments, totalCount, tiedTotal,
  unknownBreakdown, onSelectPolicy,
}: ExpandedPanelProps) {
  const def = defs[bucket];
  const showCount = Math.min(10, topAssignments.length);
  const remaining = totalCount - showCount;

  return (
    <div className="mt-3 rounded-lg bg-white border border-gray-200 overflow-hidden">
      {/* Panel header */}
      <div className="px-3.5 py-3 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">{def.label}</div>
          <div className="text-[11px] text-gray-600 mt-0.5 leading-relaxed">{def.description}</div>
          <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-gray-500">
            <Info size={10} />
            <span>Ιεραρχημένα κατά προτεραιότητα, με βάση τη δέσμευση κεφαλαίου ή την ένταση της ζήτησης</span>
          </div>
        </div>
        {def.recommendedPolicy && onSelectPolicy && (
          <button
            onClick={() => {
              const skus = topAssignments
                .map((a) => a.sku)
                .filter((s): s is string => typeof s === 'string' && s.length > 0);
              onSelectPolicy(
                def.recommendedPolicy as NonNullable<RecommendedPolicy>,
                bucket,
                { skus, label: def.label, tiedCapital: tiedTotal }
              );
            }}
            className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-[var(--nts-accent)] text-white text-[11px] font-semibold hover:opacity-90 transition-opacity"
          >
            {def.cta}
            <ChevronRight size={12} />
          </button>
        )}
      </div>

      {/* Special breakdown για new_or_unknown */}
      {bucket === 'new_or_unknown' && unknownBreakdown && (
        <div className="px-3.5 py-2.5 bg-slate-50 border-b border-gray-100 grid grid-cols-3 gap-2">
          <UnknownChip label="Νέα προϊόντα" sub="< 30 ημέρες" count={unknownBreakdown.new_sku} icon={Sparkles} />
          <UnknownChip label="Virtual SKUs" sub="gift cards / υπηρεσίες" count={unknownBreakdown.virtual_sku} icon={Package} />
          <UnknownChip label="Λείπουν δεδομένα" sub="κίνησης ή κόστους" count={unknownBreakdown.no_signals} icon={Database} />
        </div>
      )}

      {/* SKU Table */}
      {topAssignments.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                <th className="text-left font-semibold px-3 py-2">SKU / Προϊόν</th>
                <th className="text-right font-semibold px-2 py-2">Stock</th>
                <th className="text-right font-semibold px-2 py-2">Πωλ. 30η</th>
                <th className="text-right font-semibold px-2 py-2">Επάρκεια</th>
                <th className="text-right font-semibold px-2 py-2">Margin</th>
                <th className="text-right font-semibold px-2 py-2">Κεφάλαια</th>
                <th className="text-right font-semibold px-3 py-2">Last sale</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {topAssignments.slice(0, 10).map((a) => (
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
      <div className="px-3.5 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-600">
        <span>
          Εμφανίζονται {showCount} από {totalCount.toLocaleString('el-GR')} SKUs
          {remaining > 0 && <span className="text-gray-500"> · {remaining.toLocaleString('el-GR')} ακόμα κρυμμένα</span>}
        </span>
        <span className="text-[10px] text-gray-500">
          {bucket === 'new_or_unknown' && (unknownBreakdown?.no_signals ?? 0) > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Plug size={10} /> Ενεργοποίησε integrations για περισσότερα signals
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
      label: 'Procurement export (κόστη, lifetime, ταξινόμηση)',
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
