import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Megaphone, Package, Percent, Tag } from 'lucide-react';
import { Card, CardHeader, Spinner, Badge, ProductThumbnail } from '../common';
import { useCommercialScenarioImpacts } from '../../hooks/useCommercialScenarioImpacts';
import { useProductThumbnails } from '../../hooks/useProductThumbnails';
import type { ScenarioVerdict, SkuWindowMetrics } from '../../services/commercialScenarioMetrics';
import type { PriceChangeImpactRow } from '../../services/priceChangeImpact';
import type { MarginCostImpactRow } from '../../services/marginCostImpact';
import type { StockoutImpactRow } from '../../services/stockoutImpact';
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

const TABS: { key: ScenarioTab; label: string; icon: ReactNode }[] = [
  { key: 'price', label: 'Τιμές', icon: <Tag size={14} /> },
  { key: 'margin', label: 'Margin / κόστος', icon: <Percent size={14} /> },
  { key: 'stock', label: 'Απόθεμα risk', icon: <Package size={14} /> },
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

  const active = useMemo(() => {
    if (tab === 'price') return data.price;
    if (tab === 'margin') return data.margin;
    if (tab === 'stock') return data.stockout;
    return data.marketing;
  }, [tab, data.price, data.margin, data.stockout, data.marketing]);

  const filteredCount = useMemo(() => {
    if (!active) return 0;
    if (filter === 'all') return active.rows.filter(isActionableRow).length;
    if (filter === 'positive' || filter === 'negative') {
      return active.rows.filter((r) => r.verdict === filter && isActionableRow(r)).length;
    }
    return active.rows.filter((r) => r.verdict === filter).length;
  }, [active, filter]);

  return (
    <Card padding="lg" className="relative overflow-hidden">
      <CardHeader
        title="Σύνοψη επίδρασης"
        subtitle={
          periodLabel
            ? `${periodLabel} — σύνοψη ERP σημάτων που επηρέασαν τζίρο, margin, απόθεμα και καμπάνιες.`
            : 'Επιλέξτε περίοδο για εμπορική σύνοψη από ERP signals.'
        }
        icon={<Tag size={18} className="text-[var(--nts-accent)]" />}
      />

      {data.isRefreshing && !data.isLoading && (
        <div className="absolute inset-0 z-10 flex items-start justify-center bg-white/75 px-4 pt-20 backdrop-blur-[1px]">
          <div className="flex max-w-md items-center gap-3 rounded-xl border border-[var(--nts-accent)]/20 bg-white p-4 shadow-lg">
            <Spinner />
            <div>
              <p className="text-sm font-semibold text-[#1A1A1A]">Ανανεώνεται η εμπορική εικόνα ERP.</p>
              <p className="text-xs text-[#6B7280]">Υπολογίζουμε ξανά τζίρο, margin, stock risk και campaign impact για τη νέα περίοδο.</p>
            </div>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-[#F3F4F6] p-1" aria-busy={data.isLoading || data.isRefreshing}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setFilter('all');
              setShowDetails(false);
            }}
            className={`flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-xs font-medium sm:flex-initial sm:px-3 ${
              tab === t.key ? 'bg-white text-[var(--nts-orange)] shadow-sm' : 'text-[#6B7280] hover:text-[#374151]'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'price' && data.price && <ScenarioKpis summary={data.price.summary} />}
      {tab === 'margin' && data.margin && <ScenarioKpis summary={data.margin.summary} />}
      {tab === 'stock' && data.stockout && <ScenarioKpis summary={data.stockout.summary} />}
      {tab === 'marketing' && data.marketing && <MarketingKpis summary={data.marketing.summary} />}

      <FilterChips filter={filter} onChange={setFilter} />

      {data.isLoading ? (
        <div className="py-8">
          <Spinner />
        </div>
      ) : tab !== 'marketing' && !data.hasOrderLines ? (
        <EmptyHint hasCost={data.hasCostData} type="orders" />
      ) : tab === 'margin' && !data.hasCostData ? (
        <EmptyHint hasCost={false} type="cost" />
      ) : tab === 'stock' && !data.hasStockSignals ? (
        <EmptyHint hasCost={data.hasCostData} type="stock" />
      ) : tab === 'marketing' && (data.marketing?.rows.length ?? 0) === 0 ? (
        <p className="text-sm text-[#6B7280]">Δεν βρέθηκαν καμπάνιες με σημαντικό spend στην περίοδο.</p>
      ) : filteredCount === 0 ? (
        <p className="text-sm text-[#6B7280]">Δεν εντοπίστηκαν σενάρια με τα τρέχοντα κριτήρια.</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span />
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-xs font-semibold text-[#374151] transition-colors hover:border-[var(--nts-accent)]/40 hover:bg-[var(--nts-accent)]/5"
            >
              {showDetails ? 'Σύμπτυξη πίνακα' : 'Προβολή αναλυτικού πίνακα'}
            </button>
          </div>
          {showDetails && (
            <div className="overflow-x-auto rounded-xl border border-[#E5E7EB]">
              {tab === 'price' && data.price && (
                <PriceTable rows={filterRows(data.price.rows, filter)} getThumbnailUrl={getThumbnailUrl} />
              )}
              {tab === 'margin' && data.margin && (
                <MarginTable rows={filterRows(data.margin.rows, filter)} getThumbnailUrl={getThumbnailUrl} />
              )}
              {tab === 'stock' && data.stockout && (
                <StockTable rows={filterRows(data.stockout.rows, filter)} getThumbnailUrl={getThumbnailUrl} />
              )}
              {tab === 'marketing' && data.marketing && (
                <MarketingTable rows={filterRows(data.marketing.rows, filter)} />
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function filterRows<T extends { verdict: ScenarioVerdict }>(rows: T[], filter: ImpactFilter): T[] {
  const list =
    filter === 'all'
      ? rows.filter(isActionableRow)
      : filter === 'positive' || filter === 'negative'
        ? rows.filter((r) => r.verdict === filter && isActionableRow(r))
        : rows.filter((r) => r.verdict === filter);
  return list.slice(0, 50);
}

function isActionableRow<T extends { verdict: ScenarioVerdict; confidence?: string }>(row: T): boolean {
  if (row.verdict !== 'positive' && row.verdict !== 'negative') return false;
  return row.confidence == null || row.confidence !== 'low';
}

function FilterChips({ filter, onChange }: { filter: ImpactFilter; onChange: (f: ImpactFilter) => void }) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {(
        [
          ['all', 'Με ουσιαστική μεταβολή'],
          ['positive', 'Θετικά'],
          ['negative', 'Αρνητικά'],
          ['neutral', 'Ουδέτερα'],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
            filter === key ? 'bg-[var(--nts-accent)]/15 text-[var(--nts-accent)]' : 'bg-[#F3F4F6] text-[#6B7280]'
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
}) {
  const netTone = summary.netRevenueDelta > 0 ? 'success' : summary.netRevenueDelta < 0 ? 'danger' : undefined;
  return (
    <div className="mb-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MiniKpi label="Findings" value={summary.detected} sub="πλήθος μεταβολών" />
        <MiniKpi label="Θετικά" value={summary.positive} tone="success" />
        <MiniKpi label="Αρνητικά" value={summary.negative} tone="danger" />
        <MiniKpi label="Ουδέτερα" value={summary.neutral} />
        <MiniKpi
          label="Καθαρή επίδραση τζίρου"
          value={formatSignedCurrency(summary.netRevenueDelta)}
          sub={`${formatCurrency(summary.totalRevenueBefore, 0)} → ${formatCurrency(summary.totalRevenueAfter, 0)}`}
          tone={netTone}
        />
        <MiniKpi
          label="Θετική / αρνητική αξία"
          value={formatSignedCurrency(summary.positiveRevenueDelta)}
          sub={`αρνητικά ${formatSignedCurrency(summary.negativeRevenueDelta)}`}
        />
      </div>
      <p className="text-xs leading-relaxed text-[#6B7280]">
        Τα θετικά/αρνητικά είναι πλήθος findings. Η καθαρή επίδραση δείχνει την αξία τζίρου μετά την αφαίρεση των αρνητικών μεταβολών.
      </p>
    </div>
  );
}

function formatSignedCurrency(value: number): string {
  const abs = formatCurrency(Math.abs(value), 0);
  if (value > 0) return `+${abs}`;
  if (value < 0) return `-${abs}`;
  return abs;
}

function MarketingKpis({
  summary,
}: {
  summary: {
    detected: number;
    positive: number;
    negative: number;
    totalSpend: number;
    totalRevenue: number;
    totalMargin: number;
    blendedRoas: number | null;
  };
}) {
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <MiniKpi label="Καμπάνιες" value={summary.detected} />
      <MiniKpi label="Θετικές" value={summary.positive} tone="success" />
      <MiniKpi label="Αρνητικές" value={summary.negative} tone="danger" />
      <MiniKpi label="Ad spend" value={formatCurrency(summary.totalSpend, 0)} />
      <MiniKpi
        label="Store τζίρος / margin"
        value={formatCurrency(summary.totalRevenue, 0)}
        sub={`margin ${formatCurrency(summary.totalMargin, 0)} · ROAS ${summary.blendedRoas != null ? `${summary.blendedRoas}x` : '—'}`}
      />
    </div>
  );
}

function MiniKpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'success' | 'danger' | 'info';
}) {
  const toneClass =
    tone === 'success' ? 'text-emerald-600' : tone === 'danger' ? 'text-rose-600' : tone === 'info' ? 'text-violet-600' : 'text-[#1A1A1A]';
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-3">
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">{label}</p>
      <p className={`mt-1 font-mono text-lg font-bold ${toneClass}`}>{typeof value === 'number' ? formatNumber(value) : value}</p>
      {sub && <p className="mt-0.5 text-xs text-[#6B7280]">{sub}</p>}
    </div>
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
      <td className="px-3 py-2">
        <MetricPair
          label="Τζίρος"
          before={formatCurrency(before.revenue, 0)}
          after={formatCurrency(after.revenue, 0)}
          changePct={pct(before.revenue, after.revenue)}
        />
      </td>
      {showMargin && (
        <td className="px-3 py-2">
          {rowHasCost ? (
            <MetricPair
              label="Margin"
              before={formatCurrency(before.margin, 0)}
              after={formatCurrency(after.margin, 0)}
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
  label,
  before,
  after,
  changePct,
  sub,
}: {
  label: string;
  before: string;
  after: string;
  changePct: number | null;
  sub?: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">{label}</p>
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

function VerdictCell({ verdict, confidence }: { verdict: ScenarioVerdict; confidence?: string }) {
  return (
    <td className="px-3 py-2">
      <Badge variant={VERDICT_BADGE[verdict]} size="sm">
        {VERDICT_LABEL[verdict]}
      </Badge>
      {confidence && <p className="mt-0.5 text-[10px] text-[#9CA3AF]">{confidence}</p>}
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

function PriceTable({ rows, getThumbnailUrl }: { rows: PriceChangeImpactRow[]; getThumbnailUrl: GetThumbnailUrl }) {
  const showMargin = rows.some((row) => hasCostCoverage(row.before, row.after));
  return (
    <table className="min-w-full text-left text-sm">
      <thead className="bg-[#FAFAFA] text-xs uppercase text-[#9CA3AF]">
        <tr>
          <th className="px-3 py-2">SKU</th>
          <th className="px-3 py-2">Τιμή</th>
          <th className="px-3 py-2">Πωλήσεις τεμ.</th>
          <th className="px-3 py-2">Τζίρος</th>
          {showMargin && <th className="px-3 py-2">Margin</th>}
          <th className="px-3 py-2">Επίδραση</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#E5E7EB]">
        {rows.map((row) => (
          <tr key={row.sku} className="hover:bg-[#FAFAFA]">
            <td className="px-3 py-2">
              <SkuCell sku={row.sku} productName={row.productName} getThumbnailUrl={getThumbnailUrl} />
            </td>
            <td className="px-3 py-2 font-mono text-xs">
              {row.direction === 'increase' ? (
                <ArrowUpRight size={12} className="inline text-rose-600" />
              ) : (
                <ArrowDownRight size={12} className="inline text-emerald-600" />
              )}{' '}
              {formatCurrency(row.priceBefore, 2)} → {formatCurrency(row.priceAfter, 2)}
              <span className="ml-1 text-rose-600">{row.changePct >= 0 ? '+' : ''}{row.changePct}%</span>
            </td>
            <td className="px-3 py-2 font-mono text-xs">
              {formatNumber(row.before.qty)} → {formatNumber(row.after.qty)}
              <p className="font-sans text-[10px] text-[#9CA3AF]">πωληθείσες μονάδες περιόδου</p>
            </td>
            <RevenueMarginCells before={row.before} after={row.after} showMargin={showMargin} />
            <VerdictCell verdict={row.verdict} confidence={row.confidence} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MarginTable({ rows, getThumbnailUrl }: { rows: MarginCostImpactRow[]; getThumbnailUrl: GetThumbnailUrl }) {
  const showMargin = rows.some((row) => hasCostCoverage(row.before, row.after));
  return (
    <table className="min-w-full text-left text-sm">
      <thead className="bg-[#FAFAFA] text-xs uppercase text-[#9CA3AF]">
        <tr>
          <th className="px-3 py-2">SKU</th>
          <th className="px-3 py-2">Σήμα</th>
          <th className="px-3 py-2">Τζίρος</th>
          {showMargin && <th className="px-3 py-2">Margin</th>}
          <th className="px-3 py-2">Επίδραση</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#E5E7EB]">
        {rows.map((row) => (
          <tr key={row.sku} className="hover:bg-[#FAFAFA]">
            <td className="px-3 py-2">
              <SkuCell
                sku={row.sku}
                productName={row.productName}
                getThumbnailUrl={getThumbnailUrl}
                meta={row.unitCost > 0 ? <p className="text-[10px] text-[#9CA3AF]">κόστος {formatCurrency(row.unitCost, 2)}</p> : undefined}
              />
            </td>
            <td className="px-3 py-2 text-xs">
              {row.signal === 'cost_pressure' ? 'Πίεση κόστους' : row.signal === 'margin_gain' ? 'Κέρδος margin' : 'Πτώση margin'}
              <p className="font-mono">{row.marginPctBefore}% → {row.marginPctAfter}%</p>
            </td>
            <RevenueMarginCells before={row.before} after={row.after} showMargin={showMargin} />
            <VerdictCell verdict={row.verdict} confidence={row.confidence} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StockTable({ rows, getThumbnailUrl }: { rows: StockoutImpactRow[]; getThumbnailUrl: GetThumbnailUrl }) {
  const showMargin = rows.some((row) => hasCostCoverage(row.before, row.after));
  return (
    <table className="min-w-full text-left text-sm">
      <thead className="bg-[#FAFAFA] text-xs uppercase text-[#9CA3AF]">
        <tr>
          <th className="px-3 py-2">SKU</th>
          <th className="px-3 py-2">Απόθεμα</th>
          <th className="px-3 py-2">Τζίρος</th>
          {showMargin && <th className="px-3 py-2">Margin</th>}
          <th className="px-3 py-2">Επίδραση</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#E5E7EB]">
        {rows.map((row) => (
          <tr key={row.sku} className="hover:bg-[#FAFAFA]">
            <td className="px-3 py-2">
              <SkuCell sku={row.sku} productName={row.productName} getThumbnailUrl={getThumbnailUrl} />
            </td>
            <td className="px-3 py-2 text-xs">
              {row.daysOfCover != null && <p>Ημέρες κάλυψης: {row.daysOfCover}</p>}
              {row.availableStock != null && <p>Διαθέσιμο: {formatNumber(row.availableStock)}</p>}
            </td>
            <RevenueMarginCells before={row.before} after={row.after} showMargin={showMargin} />
            <VerdictCell verdict={row.verdict} confidence={row.confidence} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MarketingTable({ rows }: { rows: MarketingSpendImpactRow[] }) {
  return (
    <table className="min-w-full text-left text-sm">
      <thead className="bg-[#FAFAFA] text-xs uppercase text-[#9CA3AF]">
        <tr>
          <th className="px-3 py-2">Καμπάνια</th>
          <th className="px-3 py-2">Spend</th>
          <th className="px-3 py-2">Τζίρος store</th>
          <th className="px-3 py-2">Margin store</th>
          <th className="px-3 py-2">ROAS</th>
          <th className="px-3 py-2">Επίδραση</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#E5E7EB]">
        {rows.map((row) => (
          <tr key={row.id} className="hover:bg-[#FAFAFA]">
            <td className="px-3 py-2">
              <p className="font-semibold">{row.title}</p>
              <p className="text-xs text-[#6B7280]">{row.channel}</p>
            </td>
            <td className="px-3 py-2 font-mono text-xs">
              {formatCurrency(row.spend, 0)}
              {row.spendVsLookbackPct != null && (
                <p className={row.spendVsLookbackPct >= 0 ? 'text-amber-600' : 'text-emerald-600'}>
                  vs lookback {row.spendVsLookbackPct >= 0 ? '+' : ''}
                  {row.spendVsLookbackPct}%
                </p>
              )}
            </td>
            <td className="px-3 py-2 font-mono text-xs">
              {formatCurrency(row.revenue, 0)}
              {row.revenueChangePct != null && (
                <p className="text-[10px] text-[#9CA3AF]">περίοδος {row.revenueChangePct >= 0 ? '+' : ''}{row.revenueChangePct}%</p>
              )}
            </td>
            <td className="px-3 py-2 font-mono text-xs">
              {formatCurrency(row.margin, 0)}
              <p className="text-[10px] text-[#9CA3AF]">{row.marginPct != null ? `${row.marginPct}%` : '—'}</p>
              {row.marginChangePct != null && (
                <p className={row.marginChangePct >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                  {row.marginChangePct >= 0 ? '+' : ''}
                  {row.marginChangePct}%
                </p>
              )}
            </td>
            <td className="px-3 py-2 font-mono text-xs">{row.roas != null ? `${row.roas}x` : '—'}</td>
            <VerdictCell verdict={row.verdict} />
          </tr>
        ))}
      </tbody>
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
