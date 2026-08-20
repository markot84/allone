import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Megaphone, RefreshCw, Tag } from 'lucide-react';
import { Card, CardHeader, Badge, ProductThumbnail, Tooltip } from '../common';
import { useCommercialScenarioImpacts } from '../../hooks/useCommercialScenarioImpacts';
import { useProductThumbnails } from '../../hooks/useProductThumbnails';
import type { ScenarioVerdict, SkuWindowMetrics } from '../../services/commercialScenarioMetrics';
import type { PriceChangeImpactRow } from '../../services/priceChangeImpact';
import type { MarketingSpendImpactRow } from '../../services/marketingSpendImpact';
import { formatCurrency, formatNumber } from '../../utils/format';
type ScenarioTab = 'price' | 'margin' | 'stock' | 'marketing';
type ImpactFilter = 'all' | ScenarioVerdict;
type GetThumbnailUrl = (sku: string, product?: unknown) => { url: string };

const VERDICT_LABEL: Record<ScenarioVerdict, string> = {
  positive: 'Θετική',
  negative: 'Αρνητική',
  neutral: 'Ουδέτερη',
  insufficient: 'Ανεπαρκή δεδομένα',
};

const VERDICT_BADGE: Record<ScenarioVerdict, 'success' | 'danger' | 'warning' | 'default'> = {
  positive: 'success',
  negative: 'danger',
  neutral: 'warning',
  insufficient: 'default',
};

// Marketing: the verdict judges the DECISION (budget change/new/stopped) via before→after.
const VERDICT_LABEL_MARKETING: Record<ScenarioVerdict, string> = {
  positive: 'Επιτυχία',
  negative: 'Αποτυχία',
  neutral: 'Ουδέτερο',
  insufficient: 'Λίγα δεδομένα',
};

const MARKETING_VERDICT_HELP =
  'Αξιολόγηση της απόφασης συγκρίνοντας με το προηγούμενο ισόποσο διάστημα (before→after): π.χ. αύξηση budget που κράτησε το ROAS = Επιτυχία, που το γκρέμισε = Αποτυχία.';

const TABS: { key: ScenarioTab; label: string; icon: ReactNode }[] = [
  { key: 'price', label: 'Τιμές', icon: <Tag size={14} /> },
  { key: 'marketing', label: 'Marketing spend', icon: <Megaphone size={14} /> },
];

export function CommercialScenarioPanels({
  period,
  periodLabel,
}: {
  period: { fromDate: string; toDate: string };
  periodLabel: string | null;
}) {
  const [tab, setTab] = useState<ScenarioTab>('price');
  const [filter, setFilter] = useState<ImpactFilter>('all');
  const [showDetails, setShowDetails] = useState(false);
  const data = useCommercialScenarioImpacts(period);
  const { getThumbnailUrl } = useProductThumbnails();

  const cachedAtLabel = data.cachedAt
    ? new Date(data.cachedAt).toLocaleString('el-GR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;

  // Both tabs are always shown; empty content is handled by the per-tab empty-state.
  // (Hiding a tab when rows=0 made the price tab "disappear" when no price changes were detected.)
  const visibleTabs = TABS;
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : (visibleTabs[0]?.key ?? tab);

  // A single filtered set feeds BOTH the count AND the table — avoids mismatches
  // (e.g. showing "successes" while "failures" is selected).
  const filteredPriceRows = useMemo(() => filterScenarioRows(data.price?.rows ?? [], filter), [data.price, filter]);
  const filteredMarketingRows = useMemo(() => filterScenarioRows(data.marketing?.rows ?? [], filter), [data.marketing, filter]);
  const filteredRows = activeTab === 'price' ? filteredPriceRows : filteredMarketingRows;
  const filteredCount = filteredRows.length;

  return (
    <Card padding="lg" className="relative overflow-hidden">
      <CardHeader
        title="Σύνοψη επίδρασης"
        subtitle={periodLabel ?? undefined}
        icon={<Tag size={18} className="text-[var(--nts-accent-text)]" />}
        action={
          <div className="flex items-center gap-2">
            {cachedAtLabel && !data.isRefreshing && (
              <span className="text-xs text-[#9CA3AF]">Τελ. ανανέωση: {cachedAtLabel}</span>
            )}
            <button
              type="button"
              onClick={() => data.refresh()}
              disabled={data.isLoading || data.isRefreshing}
              title="Ανανέωση δεδομένων"
              className="flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 text-xs font-medium text-[#374151] transition-colors hover:border-[var(--nts-accent)]/40 hover:bg-[var(--nts-accent)]/5 disabled:opacity-50"
            >
              <RefreshCw size={12} className={data.isRefreshing ? 'animate-spin' : ''} />
              {data.isRefreshing ? 'Φορτώνει…' : 'Ανανέωση'}
            </button>
          </div>
        }
      />

      {data.isRefreshing && !data.isLoading && (
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-white/75 px-4 pt-20 backdrop-blur-[1px]">
          <div className="w-full max-w-md rounded-xl border border-[var(--nts-accent)]/20 bg-white p-4 shadow-lg">
            <p className="text-sm font-semibold text-[#1A1A1A]">Φορτώνουμε αποτελέσματα για τη νέα περίοδο…</p>
            <p className="mb-3 text-xs text-[#6B7280]">Ελέγχουμε πώς οι αλλαγές τιμών και το budget των καμπανιών επηρέασαν τον τζίρο.</p>
            <ProgressBar progress={data.progress} />
          </div>
        </div>
      )}

      {visibleTabs.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-[#F3F4F6] p-1" aria-busy={data.isLoading || data.isRefreshing}>
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTab(t.key);
                setFilter('all');
                setShowDetails(false);
              }}
              className={`flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium sm:flex-initial sm:px-3 ${
                activeTab === t.key ? 'bg-white text-[var(--nts-orange)] shadow-sm' : 'text-[#6B7280] hover:text-[#374151]'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}

      {data.analysisScope?.isQuickSample && !data.isLoading && !data.isRefreshing && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Γρήγορη προβολή για να μη βαραίνει η σελίδα: αναλύονται οι πρόσφατες παραγγελίες από{' '}
          <strong>{formatShortDate(data.analysisScope.fromDate)}</strong> έως{' '}
          <strong>{formatShortDate(data.analysisScope.toDate)}</strong>. Για πλήρη υπολογισμό όλης της περιόδου, πάτησε{' '}
          <strong>Ανανέωση</strong>.
        </div>
      )}

      {activeTab === 'price' && data.price && <ScenarioKpis summary={data.price.summary} filter={filter} onFilterChange={setFilter} />}
      {activeTab === 'marketing' && data.marketing && <MarketingKpis summary={data.marketing.summary} filter={filter} onFilterChange={setFilter} />}

      <FilterChips filter={filter} onChange={setFilter} tab={activeTab} />

      {data.isLoading ? (
        <LoadingProgress progress={data.progress} />
      ) : visibleTabs.length === 0 ? (
        <p className="text-sm text-[#6B7280]">
          Δεν υπάρχουν δεδομένα για αποφάσεις στην επιλεγμένη περίοδο.
        </p>
      ) : activeTab !== 'marketing' && !data.hasOrderLines ? (
        <EmptyHint hasCost={data.hasCostData} type="orders" />
      ) : activeTab === 'marketing' && (data.marketing?.rows.length ?? 0) === 0 ? (
        <p className="text-sm text-[#6B7280]">Δεν βρέθηκαν καμπάνιες με σημαντικό spend στην περίοδο.</p>
      ) : activeTab === 'price' && (data.price?.rows.length ?? 0) === 0 ? (
        <p className="text-sm text-[#6B7280]">Δεν εντοπίστηκαν αλλαγές τιμών με μετρήσιμη επίδραση στην επιλεγμένη περίοδο. Δοκιμάστε ευρύτερο εύρος ημερομηνιών.</p>
      ) : filteredCount === 0 ? (
        <p className="text-sm text-[#6B7280]">Δεν εντοπίστηκαν σενάρια με τα τρέχοντα κριτήρια.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-[#6B7280]">
              {showDetails
                ? `Εμφανίζονται όλες οι ${formatNumber(filteredCount)} γραμμές.`
                : `Προεπισκόπηση των 5 πρώτων από ${formatNumber(filteredCount)} διαθέσιμες γραμμές.`}
            </p>
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-semibold text-[#374151] transition-colors hover:border-[var(--nts-accent)]/40 hover:bg-[var(--nts-accent)]/5"
            >
              {showDetails ? 'Εμφάνιση μόνο 5 πρώτων' : 'Άνοιγμα πλήρους πίνακα'}
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
            {activeTab === 'price' && data.price && (
              <PriceTable rows={filteredPriceRows} limit={showDetails ? undefined : 5} getThumbnailUrl={getThumbnailUrl} stockBySku={data.stockBySku} />
            )}
            {activeTab === 'marketing' && data.marketing && (
              <MarketingTable rows={filteredMarketingRows} limit={showDetails ? undefined : 5} />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function progressPct(progress: { loaded: number; total: number } | null | undefined): number | null {
  if (!progress || progress.total <= 0) return null;
  // Leave some headroom (cap at 98%) until the post-fetch analysis also completes.
  return Math.min(98, Math.round((progress.loaded / progress.total) * 100));
}

function formatShortDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return ymd;
  return `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}`;
}

function ProgressBar({ progress }: { progress?: { loaded: number; total: number } | null }) {
  const pct = progressPct(progress);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-[#6B7280]">
        <span>{pct == null ? 'Προετοιμασία…' : 'Φόρτωση παραγγελιών…'}</span>
        <span className="font-mono font-semibold text-[var(--nts-accent-text)]">{pct == null ? '' : `${pct}%`}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
        <div
          className={`h-full rounded-full bg-[var(--nts-accent)] transition-all duration-300 ${pct == null ? 'animate-pulse' : ''}`}
          style={{ width: pct == null ? '35%' : `${Math.max(pct, 4)}%` }}
        />
      </div>
      {progress && progress.total > 0 && (
        <p className="mt-1 text-[10px] text-[#9CA3AF]">
          {formatNumber(progress.loaded)} / {formatNumber(progress.total)} παραγγελίες
        </p>
      )}
    </div>
  );
}

function LoadingProgress({ progress }: { progress?: { loaded: number; total: number } | null }) {
  return (
    <div className="flex justify-center py-10">
      <div className="w-full max-w-sm">
        <ProgressBar progress={progress} />
      </div>
    </div>
  );
}

function filterScenarioRows<T extends { verdict: ScenarioVerdict; confidence?: string }>(
  rows: T[],
  filter: ImpactFilter
): T[] {
  if (filter === 'all') return rows.filter(isActionableRow);
  if (filter === 'positive' || filter === 'negative') {
    return rows.filter((r) => r.verdict === filter && isActionableRow(r));
  }
  // neutral / insufficient: exact verdict (no actionable filter).
  return rows.filter((r) => r.verdict === filter);
}

function isActionableRow<T extends { verdict: ScenarioVerdict; confidence?: string }>(row: T): boolean {
  if (row.verdict !== 'positive' && row.verdict !== 'negative') return false;
  return row.confidence == null || row.confidence !== 'low';
}

function FilterChips({ filter, onChange, tab }: { filter: ImpactFilter; onChange: (f: ImpactFilter) => void; tab: ScenarioTab }) {
  const chips: ReadonlyArray<readonly [ImpactFilter, string]> =
    tab === 'marketing'
      ? [
          ['all', 'Όλες αποφάσεις'],
          ['positive', 'Επιτυχίες'],
          ['negative', 'Αποτυχίες'],
          ['neutral', 'Ουδέτερα'],
        ]
      : [
          ['all', 'Με ουσιαστική μεταβολή'],
          ['positive', 'Θετικά'],
          ['negative', 'Αρνητικά'],
          ['neutral', 'Ουδέτερα'],
        ];
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {chips.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            filter === key ? 'bg-[var(--nts-accent)]/15 text-[var(--nts-accent-text)]' : 'bg-[#F3F4F6] text-[#6B7280]'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ScenarioKpis({
  summary,
  filter,
  onFilterChange,
}: {
  summary: {
    detected: number;
    positive: number;
    negative: number;
    neutral: number;
    totalRevenueBefore: number;
    totalRevenueAfter: number;
    netRevenueDelta: number;
    positiveRevenueDelta: number;
    negativeRevenueDelta: number;
    totalMarginBefore: number | null;
    totalMarginAfter: number | null;
    marginSkuCount?: number;
    hasMarginCoverage?: boolean;
  };
  filter: ImpactFilter;
  onFilterChange: (filter: ImpactFilter) => void;
}) {
  const netTone = summary.netRevenueDelta > 0 ? 'success' : summary.netRevenueDelta < 0 ? 'danger' : undefined;
  return (
    <div className="mb-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MiniKpi
          label="Findings"
          value={formatSkuCount(summary.detected)}
          sub="SKU με εμπορική επίδραση"
          selected={filter === 'all'}
          onClick={() => onFilterChange('all')}
        />
        <MiniKpi
          label="Θετικά"
          value={formatSkuCount(summary.positive)}
          sub={formatSignedCurrency(summary.positiveRevenueDelta)}
          tone="success"
          selected={filter === 'positive'}
          onClick={() => onFilterChange('positive')}
        />
        <MiniKpi
          label="Αρνητικά"
          value={formatSkuCount(summary.negative)}
          sub={formatSignedCurrency(summary.negativeRevenueDelta)}
          tone="danger"
          selected={filter === 'negative'}
          onClick={() => onFilterChange('negative')}
        />
        <MiniKpi
          label="Ουδέτερα"
          value={formatSkuCount(summary.neutral)}
          sub="SKU χωρίς καθαρή επίδραση"
          selected={filter === 'neutral'}
          onClick={() => onFilterChange('neutral')}
        />
        <MiniKpi
          label="Καθαρή επίδραση Revenue"
          tooltip="Το τελικό αποτέλεσμα: πόσα € κερδίθηκαν ή χάθηκαν συνολικά από όλες τις αλλαγές. Υπολογίζεται ως: τζίρος μετά την αλλαγή μείον τζίρος πριν."
          value={formatSignedCurrency(summary.netRevenueDelta)}
          sub={`${formatEuro(summary.totalRevenueBefore)} → ${formatEuro(summary.totalRevenueAfter)}`}
          tone={netTone}
        />
      </div>
    </div>
  );
}

function formatSkuCount(value: number): string {
  return `${formatNumber(value)} SKU`;
}

function formatEuro(value: number): string {
  return `${formatCurrency(value, 0)} €`;
}

function formatSignedCurrency(value: number): string {
  const abs = formatEuro(Math.abs(value));
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
}

function MarketingKpis({
  summary,
  filter,
  onFilterChange,
}: {
  summary: {
    detected: number;
    positive: number;
    negative: number;
    totalSpend: number;
    totalRevenue: number;
    totalNetProfit: number | null;
    blendedRoas: number | null;
  };
  filter: ImpactFilter;
  onFilterChange: (filter: ImpactFilter) => void;
}) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MiniKpi
        label="Αποφάσεις"
        tooltip="Αλλαγές budget, νέες ή διακοπές καμπανιών που εντοπίστηκαν σε σχέση με το προηγούμενο ισόποσο διάστημα."
        value={summary.detected}
      />
      <MiniKpi
        label="Επιτυχίες"
        value={summary.positive}
        tone="success"
        selected={filter === 'positive'}
        onClick={() => onFilterChange('positive')}
      />
      <MiniKpi
        label="Αποτυχίες"
        value={summary.negative}
        tone="danger"
        selected={filter === 'negative'}
        onClick={() => onFilterChange('negative')}
      />
      <MiniKpi
        label="Blended ROAS"
        tooltip="Συνολικός αποδιδόμενος τζίρος ÷ συνολικό ad spend. ≥3x θεωρείται καλό."
        value={summary.blendedRoas != null ? `${summary.blendedRoas}x` : '—'}
        tone={summary.blendedRoas != null && summary.blendedRoas >= 3 ? 'success' : summary.blendedRoas != null && summary.blendedRoas < 1.5 ? 'danger' : undefined}
      />
      <MiniKpi
        label="Καθαρό κέρδος"
        tooltip="Εκτίμηση: αποδιδόμενος τζίρος × μικτό περιθώριο store − ad spend. Χρειάζεται κόστος ανά SKU (ERP/procurement)."
        value={summary.totalNetProfit != null ? formatCurrency(summary.totalNetProfit, 0) : '—'}
        tone={summary.totalNetProfit != null ? (summary.totalNetProfit >= 0 ? 'success' : 'danger') : undefined}
      />
    </div>
  );
}

function MiniKpi({
  label,
  tooltip,
  value,
  sub,
  tone,
  selected,
  onClick,
}: {
  label: string;
  tooltip?: string;
  value: string | number;
  sub?: string;
  tone?: 'success' | 'danger' | 'info';
  selected?: boolean;
  onClick?: () => void;
}) {
  const toneClass =
    tone === 'success' ? 'text-emerald-600' : tone === 'danger' ? 'text-rose-600' : tone === 'info' ? 'text-violet-600' : 'text-[#1A1A1A]';
  const className = `rounded-xl border p-3 text-left transition-all ${
    selected
      ? 'border-[var(--nts-accent)]/40 bg-[var(--nts-accent)]/5 ring-2 ring-[var(--nts-accent)]/15'
      : 'border-[#E5E7EB] bg-[#FAFAFA]'
  } ${onClick ? 'cursor-pointer hover:border-[var(--nts-accent)]/40 hover:bg-white' : ''}`;
  const content = (
    <>
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">
        {tooltip ? <Tooltip content={tooltip}>{label}</Tooltip> : label}
      </p>
      <p className={`mt-1 font-mono text-lg font-bold ${toneClass}`}>{typeof value === 'number' ? formatNumber(value) : value}</p>
      {sub && <p className="mt-0.5 text-xs text-[#6B7280]">{sub}</p>}
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-pressed={selected}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

function hasCostCoverage(before: SkuWindowMetrics, after: SkuWindowMetrics): boolean {
  return before.unitCost > 0 || after.unitCost > 0;
}

function RevenueMarginCells({
  before,
  after,
  showMargin,
}: {
  before: SkuWindowMetrics;
  after: SkuWindowMetrics;
  showMargin: boolean;
}) {
  const rowHasCost = hasCostCoverage(before, after);
  return (
    <>
      <td className="px-3 py-2 text-right">
        <MetricPair
          before={formatEuro(before.revenue)}
          after={formatEuro(after.revenue)}
          changePct={pct(before.revenue, after.revenue)}
        />
      </td>
      {showMargin && (
        <td className="px-3 py-2 text-right">
          {rowHasCost ? (
            <MetricPair
              before={formatEuro(before.margin)}
              after={formatEuro(after.margin)}
              changePct={pct(before.margin, after.margin)}
              sub={`${before.marginPct ?? '—'}% → ${after.marginPct ?? '—'}%`}
            />
          ) : (
            <MetricUnavailable label="Margin" reason="χωρίς κόστος SKU" />
          )}
        </td>
      )}
    </>
  );
}

function MetricUnavailable({ label, reason }: { label: string; reason: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">{label}</p>
      <p className="font-mono text-xs text-[#9CA3AF]">—</p>
      <p className="text-[10px] text-[#9CA3AF]">{reason}</p>
    </div>
  );
}

function MetricPair({
  before,
  after,
  changePct,
  sub,
}: {
  before: string;
  after: string;
  changePct: number | null;
  sub?: string;
}) {
  return (
    <div className="whitespace-nowrap">
      <p className="font-mono text-xs text-[#374151]">
        {before} → {after}
      </p>
      {changePct != null && (
        <p className={`text-xs ${changePct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
          {changePct >= 0 ? '+' : ''}
          {changePct}%
        </p>
      )}
      {sub && <p className="text-[10px] text-[#9CA3AF]">{sub}</p>}
    </div>
  );
}

function pct(before: number, after: number): number | null {
  if (before <= 0) return after > 0 ? 100 : null;
  return Math.round(((after - before) / before) * 1000) / 10;
}

function TotDelta({ value, currency }: { value: number; currency?: boolean }) {
  if (value === 0) return null;
  const formatted = currency ? formatSignedCurrency(value) : `${value > 0 ? '+' : ''}${formatNumber(value)}`;
  return (
    <p className={`text-xs ${value > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{formatted}</p>
  );
}

function VerdictCell({ verdict, tab }: { verdict: ScenarioVerdict; confidence?: string; tab?: ScenarioTab }) {
  const label = tab === 'marketing' ? VERDICT_LABEL_MARKETING[verdict] : VERDICT_LABEL[verdict];
  return (
    <td className="px-3 py-2 text-center">
      <Badge variant={VERDICT_BADGE[verdict]} size="sm">
        {label}
      </Badge>
    </td>
  );
}

function SkuCell({
  sku,
  productName,
  getThumbnailUrl,
  meta,
}: {
  sku: string;
  productName: string;
  getThumbnailUrl: GetThumbnailUrl;
  meta?: ReactNode;
}) {
  const thumb = getThumbnailUrl(sku).url;
  return (
    <div className="flex min-w-[180px] items-start gap-2">
      <ProductThumbnail src={thumb || undefined} alt={productName || sku} size="sm" />
      <div className="min-w-0">
        <p className="truncate font-semibold">{sku}</p>
        <p className="line-clamp-1 text-xs text-[#6B7280]">{productName}</p>
        {meta}
      </div>
    </div>
  );
}

function PriceTable({ rows, limit, getThumbnailUrl, stockBySku }: { rows: PriceChangeImpactRow[]; limit?: number; getThumbnailUrl: GetThumbnailUrl; stockBySku?: Map<string, number> }) {
  // Totals are always computed from ALL rows; `limit` only restricts the visible ones.
  const visibleRows = limit != null ? rows.slice(0, limit) : rows;
  const showMargin = rows.some((row) => hasCostCoverage(row.before, row.after));
  const totRevB = rows.reduce((s, r) => s + r.before.revenue, 0);
  const totRevA = rows.reduce((s, r) => s + r.after.revenue, 0);
  const totQtyB = rows.reduce((s, r) => s + r.before.qty, 0);
  const totQtyA = rows.reduce((s, r) => s + r.after.qty, 0);
  const totMarB = rows.reduce((s, r) => s + r.before.margin, 0);
  const totMarA = rows.reduce((s, r) => s + r.after.margin, 0);
  return (
    <table className="min-w-full text-left text-sm">
      <colgroup>
        <col className="w-[35%]" />
        <col className="w-[18%]" />
        <col className="w-[12%]" />
        <col className="w-[18%]" />
        {showMargin && <col className="w-[12%]" />}
        <col className="w-[10%]" />
      </colgroup>
      <thead className="bg-[#FAFAFA] text-xs uppercase text-[#9CA3AF]">
        <tr>
          <th className="px-3 py-2 text-left">SKU</th>
          <th className="px-3 py-2 text-left">Τιμή</th>
          <th className="px-3 py-2 text-right">
            <Tooltip content="Τεμάχια πριν → μετά την αλλαγή. Η ένδειξη «απόθ.» δείχνει το διαθέσιμο απόθεμα όπου υπάρχει στοιχείο (e-shop products ή ERP/Megaventory). «απόθ. —» = δεν υπάρχει καταγραφή αποθέματος, δεν σημαίνει ότι υπάρχει στοκ.">
              Πωληθέντα Τεμ.
            </Tooltip>
          </th>
          <th className="px-3 py-2 text-right">Revenue</th>
          {showMargin && <th className="px-3 py-2 text-right">Margin</th>}
          <th className="px-3 py-2 text-center">Επίδραση</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#E5E7EB]">
        {visibleRows.map((row, idx) => (
          // The same SKU can appear across multiple month-windows → unique key (otherwise duplicate
          // keys make React reuse stale rows when the filter changes).
          <tr key={`${row.sku}__${row.changeDate}__${idx}`} className="hover:bg-[#FAFAFA]">
            <td className="px-3 py-2">
              <SkuCell sku={row.sku} productName={row.productName} getThumbnailUrl={getThumbnailUrl} />
            </td>
            <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
              {row.direction === 'increase' ? (
                <ArrowUpRight size={12} className="inline text-rose-600" />
              ) : (
                <ArrowDownRight size={12} className="inline text-emerald-600" />
              )}{' '}
              {formatCurrency(row.priceBefore, 2)} → {formatCurrency(row.priceAfter, 2)}
              <span className={`ml-1 ${row.direction === 'increase' ? 'text-rose-600' : 'text-emerald-600'}`}>
                {row.changePct >= 0 ? '+' : ''}{row.changePct}%
              </span>
            </td>
            <td className="px-3 py-2 font-mono text-xs text-right whitespace-nowrap">
              {formatNumber(row.before.qty)} → {formatNumber(row.after.qty)}
              {stockBySku && (() => {
                const stock = stockBySku.get(row.sku.toUpperCase());
                // null = no stock record → "—" (showing nothing would be ambiguous).
                if (stock == null) {
                  return <p className="text-[10px] text-[#D1D5DB]">απόθ. —</p>;
                }
                const color = stock === 0 ? 'text-rose-500' : stock < 5 ? 'text-amber-500' : 'text-[#9CA3AF]';
                return <p className={`text-[10px] ${color}`}>απόθ. {formatNumber(stock)}</p>;
              })()}
            </td>
            <RevenueMarginCells before={row.before} after={row.after} showMargin={showMargin} />
            <VerdictCell verdict={row.verdict} confidence={row.confidence} />
          </tr>
        ))}
      </tbody>
      <tfoot className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB] text-xs font-semibold text-[#374151]">
        <tr>
          <td className="px-3 py-2" colSpan={2}>Σύνολο — {rows.length} SKU</td>
          <td className="px-3 py-2 font-mono text-right whitespace-nowrap">
            {formatNumber(totQtyB)} → {formatNumber(totQtyA)}
            <TotDelta value={totQtyA - totQtyB} />
          </td>
          <td className="px-3 py-2 font-mono text-right whitespace-nowrap">
            {formatEuro(totRevB)} → {formatEuro(totRevA)}
            <TotDelta value={totRevA - totRevB} currency />
          </td>
          {showMargin && (
            <td className="px-3 py-2 font-mono text-right whitespace-nowrap">
              {formatEuro(totMarB)} → {formatEuro(totMarA)}
              <TotDelta value={totMarA - totMarB} currency />
            </td>
          )}
          <td />
        </tr>
      </tfoot>
    </table>
  );
}


function DecisionBadge({ row }: { row: MarketingSpendImpactRow }) {
  const icon =
    row.decisionType === 'scale_up' ? (
      <ArrowUpRight size={11} className="inline" />
    ) : row.decisionType === 'scale_down' ? (
      <ArrowDownRight size={11} className="inline" />
    ) : null;
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md bg-[#F3F4F6] px-1.5 py-0.5 text-[11px] font-semibold text-[#374151]">
      {icon}
      {row.decisionLabel}
    </span>
  );
}

// Color by the decision's OUTCOME (verdict), so a "failure" does not show
// green numbers (e.g. high ROAS on a cancelled campaign) and look like a success.
function verdictTextTone(v: ScenarioVerdict): string {
  if (v === 'positive') return 'text-emerald-600';
  if (v === 'negative') return 'text-rose-600';
  return 'text-[#374151]';
}

function verdictAccent(v: ScenarioVerdict): string {
  if (v === 'positive') return 'border-l-2 border-emerald-400';
  if (v === 'negative') return 'border-l-2 border-rose-400';
  return 'border-l-2 border-transparent';
}

function MarketingTable({ rows, limit }: { rows: MarketingSpendImpactRow[]; limit?: number }) {
  // Totals are always computed from ALL rows; `limit` only restricts the visible ones.
  const visibleRows = limit != null ? rows.slice(0, limit) : rows;
  const totSpend = rows.reduce((s, r) => s + r.spend, 0);
  const totRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totConv = rows.reduce((s, r) => s + r.conversions, 0);
  const totRoas = totSpend > 0 ? Math.round((totRevenue / totSpend) * 100) / 100 : null;
  return (
    <table className="min-w-full text-left text-sm">
      <thead className="bg-[#FAFAFA] text-xs uppercase text-[#9CA3AF]">
        <tr>
          <th className="px-3 py-2">Καμπάνια</th>
          <th className="px-3 py-2">
            <Tooltip content="Τι αλλάξαμε σε σχέση με το προηγούμενο ισόποσο διάστημα (ad spend πριν → μετά).">Απόφαση</Tooltip>
          </th>
          <th className="px-3 py-2 text-right">
            <Tooltip content="Αποδιδόμενο ROAS πριν → μετά. ≥3x καλό, &lt;1.5x αδύναμο.">ROAS πριν→μετά</Tooltip>
          </th>
          <th className="px-3 py-2 text-right">
            <Tooltip content="Αποδιδόμενος τζίρος (conversion value Google/Meta) πριν → μετά.">Αποδ. τζίρος</Tooltip>
          </th>
          <th className="px-3 py-2 text-center">
            <Tooltip content={MARKETING_VERDICT_HELP}>Αξιολόγηση</Tooltip>
          </th>
          <th className="px-3 py-2">Ιδέα / Σύσταση</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#E5E7EB]">
        {visibleRows.map((row, idx) => (
          <tr key={`${row.id}__${idx}`} className="hover:bg-[#FAFAFA] align-top">
            <td className={`px-3 py-2 ${verdictAccent(row.verdict)}`}>
              <p className="font-semibold">{row.title}</p>
              <p className="text-xs text-[#6B7280]">{row.channel}</p>
            </td>
            <td className="px-3 py-2 whitespace-nowrap">
              <DecisionBadge row={row} />
              <p className="mt-1 font-mono text-[11px] text-[#6B7280]">
                {formatEuro(row.spendBefore)} → {formatEuro(row.spend)}
              </p>
            </td>
            <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
              <span className="text-[#9CA3AF]">{row.roasBefore != null ? `${row.roasBefore}x` : '—'}</span>
              <span className="text-[#9CA3AF]"> → </span>
              <span className={`font-semibold ${verdictTextTone(row.verdict)}`}>{row.roas != null ? `${row.roas}x` : '—'}</span>
            </td>
            <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">
              <span className="text-[#9CA3AF]">{formatEuro(row.revenueBefore)}</span>
              <span className="text-[#9CA3AF]"> → </span>
              <span className={`font-semibold ${verdictTextTone(row.verdict)}`}>{formatEuro(row.revenue)}</span>
            </td>
            <VerdictCell verdict={row.verdict} tab="marketing" />
            <td className="px-3 py-2 text-xs leading-relaxed text-[#374151] min-w-[220px] max-w-[340px]">{row.idea}</td>
          </tr>
        ))}
      </tbody>
      <tfoot className="border-t-2 border-[#E5E7EB] bg-[#F9FAFB] text-xs font-semibold text-[#374151]">
        <tr>
          <td className="px-3 py-2">Σύνολο — {rows.length} αποφάσεις</td>
          <td className="px-3 py-2 font-mono">{formatEuro(totSpend)}</td>
          <td className="px-3 py-2 font-mono text-right">{totRoas != null ? `${totRoas}x` : '—'}</td>
          <td className="px-3 py-2 font-mono text-right">{formatEuro(totRevenue)}</td>
          <td className="px-3 py-2 text-right">{formatNumber(totConv)} conv.</td>
          <td />
        </tr>
      </tfoot>
    </table>
  );
}

function EmptyHint({ type, hasCost }: { type: 'orders' | 'cost' | 'stock'; hasCost: boolean }) {
  const msg =
    type === 'orders'
      ? 'Χρειάζονται ERP τιμολόγια ή παραγγελίες με SKU, τιμές και τεμάχια για εμπορική αξιολόγηση.'
      : type === 'cost'
        ? 'Συγχρονίστε ERP/procurement pricing για υπολογισμό margin και κόστους ανά SKU.'
        : 'Συγχρονίστε ERP/procurement στοιχεία για days of cover και διαθέσιμο απόθεμα.';
  return (
    <p className="text-sm text-[#6B7280]">
      {msg}
      {type === 'orders' && !hasCost && ' Το margin θα είναι περιορισμένο χωρίς κόστος ανά SKU.'}
    </p>
  );
}
