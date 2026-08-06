import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  CheckCircle2,
  CircleAlert,
  Lightbulb,
  Plus,
  Search,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Card, CardHeader, Button, PageHeader, Spinner, Badge, ProductThumbnail, Tooltip } from '../common';
import { DateRangePicker } from '../ui/DateRangePicker';
import { useCommercialDecisionMemory } from '../../hooks/useCommercialDecisionMemory';
import { useProductThumbnails } from '../../hooks/useProductThumbnails';
import type {
  CommercialDecisionEventType,
  CommercialDecisionSource,
  CommercialDecisionVerdict,
} from '../../services/commercialDecisionMemory';
import type { DecisionMemoryItem } from '../../hooks/useCommercialDecisionMemory';
import { useDashPeriod } from '../../hooks/useDashPeriod';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { getEventDateRange, intersectEventWithPeriod } from '../../services/policyImpactAnalysis';
import { CommercialScenarioPanels } from './CommercialScenarioPanels';
import { formatCurrency, formatNumber } from '../../utils/format';

const TYPE_LABELS: Record<CommercialDecisionEventType | 'all', string> = {
  all: 'Όλοι οι τύποι',
  pricing: 'Τιμές',
  margin: 'Κόστος',
  discount: 'Εκπτώσεις',
  campaign: 'Καμπάνιες',
  channel: 'Κανάλια',
  assortment: 'Assortment',
  stock: 'Stock',
  strategy: 'Strategy',
  manual: 'Manual',
};

const SOURCE_LABELS: Record<CommercialDecisionSource, string> = {
  manual: 'Manual',
  legacy_action: 'Εμπορική ενέργεια',
  strategy: 'Strategy',
  campaigns: 'Καμπάνια',
  channel_activation: 'Ενεργοποίηση καναλιού',
  product_signals: 'Product signals',
  erp_history: 'ERP history',
};

const VERDICT_LABELS: Record<CommercialDecisionVerdict | 'all', string> = {
  all: 'Όλα τα outcomes',
  winning: 'Winning',
  neutral: 'Review',
  losing: 'Avoid',
  learning: 'Learning',
};

const VERDICT_BADGE: Record<CommercialDecisionVerdict, 'success' | 'warning' | 'danger' | 'info'> = {
  winning: 'success',
  neutral: 'warning',
  losing: 'danger',
  learning: 'info',
};

type SummaryTab = 'all' | 'winning' | 'review' | 'avoid' | 'active';
const SHOW_DECISION_MEMORY = false;

function matchesSummaryTab(item: DecisionMemoryItem, tab: SummaryTab): boolean {
  if (tab === 'all') return true;
  const { event, impact } = item;
  if (tab === 'winning') return impact.verdict === 'winning';
  if (tab === 'review') return impact.verdict === 'neutral' || impact.confidence === 'low';
  if (tab === 'avoid') return impact.verdict === 'losing';
  return event.status === 'active' || event.status === 'planned';
}

function formatPeriodLabel(from: string, to: string): string {
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split('-');
    return `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}`;
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

export function PolicyImpactPage({ onSectionChange }: { onSectionChange?: (s: string) => void } = {}) {
  const { period: dashPeriod, setPeriod: setDashPeriod, periodDates } = useDashPeriod();
  const { customFrom, customTo, setCustomRange } = useGlobalDate();
  const { getThumbnailUrl } = useProductThumbnails();
  const { items, summary, saveDecisionEvent, isSaving, isLoading, isRefreshing, dataCoverage, period } = useCommercialDecisionMemory(
    periodDates
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<CommercialDecisionEventType | 'all'>('all');
  const [verdictFilter, setVerdictFilter] = useState<CommercialDecisionVerdict | 'all'>('all');
  const [summaryTab, setSummaryTab] = useState<SummaryTab>('all');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    title: '',
    eventType: 'manual' as CommercialDecisionEventType,
    startDate: '',
    endDate: '',
    hypothesis: '',
  });

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const { event, impact } = item;
      if (!matchesSummaryTab(item, summaryTab)) return false;
      if (typeFilter !== 'all' && event.eventType !== typeFilter) return false;
      if (verdictFilter !== 'all' && impact.verdict !== verdictFilter) return false;
      if (!needle) return true;
      return [
        event.title,
        event.description,
        event.hypothesis,
        event.source,
        event.scope?.description,
        ...(event.tags ?? []),
        ...(event.scope?.channels ?? []),
        ...(event.scope?.categories ?? []),
        ...(event.scope?.skus ?? []),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [items, query, typeFilter, verdictFilter, summaryTab]);

  const handleSummaryTab = (tab: Exclude<SummaryTab, 'all'>) => {
    setSummaryTab(tab);
    setSelectedId(null);
  };

  useEffect(() => {
    setSelectedId(null);
    setSummaryTab('all');
  }, [periodDates.fromDate, periodDates.toDate]);

  const selected = useMemo(
    () => filteredItems.find((item) => item.event.id === selectedId) ?? filteredItems[0] ?? null,
    [filteredItems, selectedId]
  );

  const playbooks = useMemo(
    () =>
      filteredItems
        .filter((item) => item.impact.verdict === 'winning' || item.impact.verdict === 'losing')
        .slice(0, 4),
    [filteredItems]
  );

  const periodLabel = period ? formatPeriodLabel(period.fromDate, period.toDate) : null;

  const handleCreate = async () => {
    if (!form.title.trim() || !form.startDate) return;
    const saved = await saveDecisionEvent({
      title: form.title.trim(),
      eventType: form.eventType,
      source: 'manual',
      decisionDate: form.startDate,
      startDate: form.startDate,
      endDate: form.endDate || form.startDate,
      status: form.endDate && form.endDate < new Date().toISOString().slice(0, 10) ? 'completed' : 'active',
      hypothesis: form.hypothesis.trim() || undefined,
      tags: ['manual', form.eventType],
      changes: [],
    });
    setSelectedId(saved.id);
    setShowForm(false);
    setForm({ title: '', eventType: 'manual', startDate: '', endDate: '', hypothesis: '' });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[var(--text-heading)] sm:text-2xl">Policy Impact</h2>}
        description={null}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => onSectionChange?.('strategy')}>
              Strategy
            </Button>
            {SHOW_DECISION_MEMORY && (
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>
                Add missing decision
              </Button>
            )}
          </div>
        }
      />

      <Card padding="md">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">
              <Tooltip content="Εμπορικές αποφάσεις που αφορούν την επιλεγμένη περίοδο. Αν μια απόφαση ξεκινά πριν ή τελειώνει μετά, μετράει μόνο το τμήμα που πέφτει εντός.">
                Περίοδος ανάλυσης
              </Tooltip>
            </p>
            {periodLabel && (
              <p className="mt-1 text-sm font-medium text-[var(--text-secondary)]">{periodLabel}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-1 gap-0.5 rounded-lg bg-[var(--surface-2)] p-0.5 sm:flex-initial">
              {GLOBAL_PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setDashPeriod(opt.key)}
                  className={`min-h-[32px] flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all sm:flex-initial sm:px-3 ${
                    dashPeriod === opt.key
                      ? 'bg-white font-semibold text-[var(--nts-orange)] shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {dashPeriod === 'custom' && (
              <DateRangePicker
                from={customFrom}
                to={customTo}
                onChange={(f, t) => setCustomRange(f, t)}
                onClear={() => setDashPeriod('current_month')}
              />
            )}
          </div>
        </div>
      </Card>

      {SHOW_DECISION_MEMORY && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="tablist" aria-label="Filter decisions by outcome">
          <SummaryCard
            icon={<CheckCircle2 size={18} />}
            label="Winning scenarios"
            value={summary.winning}
            tone="success"
            selected={summaryTab === 'winning'}
            onClick={() => handleSummaryTab('winning')}
          />
          <SummaryCard
            icon={<CircleAlert size={18} />}
            label="Needs review"
            value={summary.review}
            tone="warning"
            selected={summaryTab === 'review'}
            onClick={() => handleSummaryTab('review')}
          />
          <SummaryCard
            icon={<TrendingDown size={18} />}
            label="Avoid repeating"
            value={summary.avoid}
            tone="danger"
            selected={summaryTab === 'avoid'}
            onClick={() => handleSummaryTab('avoid')}
          />
          <SummaryCard
            icon={<Lightbulb size={18} />}
            label="Active experiments"
            value={summary.active}
            tone="info"
            selected={summaryTab === 'active'}
            onClick={() => handleSummaryTab('active')}
          />
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-orange-100 bg-orange-50/35 p-4 sm:p-5">
        <SectionIntro
          title="Εμπορικές αποφάσεις & αποτελέσματα"
          tooltip="Για κάθε προϊόν που είδε αλλαγή τιμής, κόστους, διαθεσιμότητας ή marketing spend, δες αν αυτή η αλλαγή βελτίωσε ή χειροτέρεψε τον τζίρο της περιόδου."
          icon={<BarChart3 size={18} />}
        />
        <CommercialScenarioPanels period={periodDates} periodLabel={periodLabel} />
      </section>

      {SHOW_DECISION_MEMORY && isRefreshing && !isLoading && (
        <Card padding="md" className="border border-[var(--nts-accent)]/25 bg-[var(--nts-accent)]/5">
          <div className="flex items-center gap-3">
            <Spinner />
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">Ανανεώνεται το Decision Memory για τη νέα περίοδο.</p>
              <p className="text-xs text-[var(--text-muted)]">Ελέγχουμε πραγματικές αποφάσεις, campaigns και εμπορικές ενέργειες χωρίς να διπλασιάζουμε τα ERP scenarios.</p>
            </div>
          </div>
        </Card>
      )}

      {SHOW_DECISION_MEMORY && showForm && (
        <Card padding="lg" className="border border-[var(--nts-accent)]/30">
          <CardHeader
            title="Add missing decision"
            subtitle="Για αποφάσεις που δεν ανιχνεύονται αυτόματα από connectors, Strategy ή campaign imports."
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <input
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm xl:col-span-2"
              placeholder="Τίτλος απόφασης"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            />
            <select
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              value={form.eventType}
              onChange={(e) => setForm((prev) => ({ ...prev, eventType: e.target.value as CommercialDecisionEventType }))}
            >
              {Object.entries(TYPE_LABELS)
                .filter(([key]) => key !== 'all')
                .map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
            </select>
            <input
              type="date"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              value={form.startDate}
              onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
            />
            <input
              type="date"
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
              value={form.endDate}
              onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
            />
          </div>
          <textarea
            className="mt-3 min-h-20 w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            placeholder="Εμπορική υπόθεση / γιατί πήραμε αυτή την απόφαση;"
            value={form.hypothesis}
            onChange={(e) => setForm((prev) => ({ ...prev, hypothesis: e.target.value }))}
          />
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={() => void handleCreate()} disabled={isSaving || !form.title || !form.startDate}>
              Αποθήκευση
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Ακύρωση
            </Button>
          </div>
        </Card>
      )}

      {SHOW_DECISION_MEMORY && (
      <section className="space-y-5 rounded-2xl border border-sky-100 bg-sky-50/40 p-4 sm:p-5">
        <SectionIntro
          title="Decision Memory"
          tooltip="Καταγραφή αποφάσεων, campaigns και εμπορικών ενεργειών με outcome scoring. Χρησιμοποιείται για να επαναλάβουμε ό,τι δούλεψε και να αποφύγουμε ό,τι δεν απέδωσε."
          icon={<BookOpenCheck size={18} />}
        />

        <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
          <div className="space-y-5">
            <Card padding="lg">
              <CardHeader
                title="Λίστα αποφάσεων"
                subtitle="Φιλτράρετε ανά τύπο ή outcome και ανοίξτε την απόφαση που θέλετε να ελέγξετε αναλυτικά."
                icon={<BookOpenCheck size={18} className="text-[var(--nts-accent-text)]" />}
              />
              <div className="space-y-3">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                  <input
                    className="w-full rounded-lg border border-[var(--border)] py-2 pl-9 pr-3 text-sm"
                    placeholder="Αναζήτηση απόφασης, campaign, κανάλι..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <FilterSelect
                    value={typeFilter}
                    onChange={(value) => setTypeFilter(value as CommercialDecisionEventType | 'all')}
                    options={TYPE_LABELS}
                  />
                  <FilterSelect
                    value={verdictFilter}
                    onChange={(value) => {
                      setVerdictFilter(value as CommercialDecisionVerdict | 'all');
                      setSummaryTab('all');
                    }}
                    options={VERDICT_LABELS}
                  />
                </div>
              </div>
            </Card>

            <Card padding="none">
              {isRefreshing && !isLoading && (
                <div className="border-b border-[var(--border)] px-4 py-3 text-xs text-[var(--text-muted)]">
                  Ανανεώνονται οι αποφάσεις και τα outcomes για τη νέα περίοδο...
                </div>
              )}
              {isLoading ? (
                <div className="p-5">
                  <Spinner />
                </div>
              ) : filteredItems.length === 0 ? (
                <EmptyState
                  coverage={dataCoverage}
                  periodLabel={periodLabel}
                  totalInPeriod={items.length}
                  hasActiveFilters={summaryTab !== 'all' || typeFilter !== 'all' || verdictFilter !== 'all' || query.trim().length > 0}
                />
              ) : (
                <ul className="max-h-[640px] divide-y divide-[var(--border)] overflow-y-auto">
                  {filteredItems.map((item) => (
                    <DecisionListItem
                      key={item.event.id}
                      item={item}
                      selected={selected?.event.id === item.event.id}
                      getThumbnailUrl={getThumbnailUrl}
                      onSelect={() => setSelectedId(item.event.id)}
                    />
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div className="space-y-5">
            {selected ? (
              <>
                <DecisionDetail item={selected} analysisPeriod={period} getThumbnailUrl={getThumbnailUrl} />
                {playbooks.length > 0 && <PlaybookPanel items={playbooks} onSelect={(id) => setSelectedId(id)} />}
              </>
            ) : (
              <Card padding="lg">
                <p className="text-sm text-[var(--text-muted)]">Επιλέξτε decision για ανάλυση.</p>
              </Card>
            )}
          </div>
        </div>
      </section>
      )}
    </div>
  );
}

function SectionIntro({
  title,
  tooltip,
  icon,
}: {
  title: string;
  tooltip?: string;
  icon: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="rounded-xl bg-[var(--nts-accent)]/10 p-2 text-[var(--nts-accent-text)]">{icon}</span>
      <h3 className="text-lg font-bold text-[var(--text-primary)]">
        {tooltip ? (
          <Tooltip content={tooltip}>{title}</Tooltip>
        ) : (
          title
        )}
      </h3>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
  selected,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: 'success' | 'warning' | 'danger' | 'info';
  selected?: boolean;
  onClick?: () => void;
}) {
  const toneClass = {
    success: 'text-emerald-600 bg-emerald-50',
    warning: 'text-amber-600 bg-amber-50',
    danger: 'text-rose-600 bg-rose-50',
    info: 'text-sky-600 bg-sky-50',
  }[tone];
  const ringClass = {
    success: 'border-emerald-400 ring-2 ring-emerald-500/35 bg-emerald-50/40',
    warning: 'border-amber-400 ring-2 ring-amber-500/35 bg-amber-50/40',
    danger: 'border-rose-400 ring-2 ring-rose-500/35 bg-rose-50/40',
    info: 'border-sky-400 ring-2 ring-sky-500/35 bg-sky-50/40',
  }[tone];
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={`w-full rounded-xl border text-left transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--nts-accent)] ${
        selected ? ringClass : 'border-transparent hover:border-[var(--border-strong)] hover:ring-1 hover:ring-[var(--border)]'
      }`}
    >
      <Card padding="md" className={selected ? 'border-transparent bg-transparent shadow-sm' : undefined}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">{label}</p>
            <p className="mt-1 font-mono text-2xl font-bold text-[var(--text-primary)]">{formatNumber(value)}</p>
          </div>
          <span className={`rounded-xl p-2 ${toneClass}`}>{icon}</span>
        </div>
      </Card>
    </button>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Record<string, string>;
}) {
  return (
    <select
      className="w-full rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {Object.entries(options).map(([key, label]) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

function DecisionListItem({
  item,
  selected,
  getThumbnailUrl,
  onSelect,
}: {
  item: DecisionMemoryItem;
  selected: boolean;
  getThumbnailUrl: (sku: string, product?: unknown) => { url: string };
  onSelect: () => void;
}) {
  const { event, impact } = item;
  const sku = event.scope?.skus?.[0] ?? '';
  const thumb = sku ? getThumbnailUrl(sku).url : '';
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full px-4 py-4 text-left transition-colors ${
          selected ? 'bg-[var(--nts-accent)]/10' : 'hover:bg-[var(--surface-1)]'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <ProductThumbnail src={thumb || undefined} alt={sku || event.title} size="sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{event.title}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {TYPE_LABELS[event.eventType]} · {event.decisionDate} · {SOURCE_LABELS[event.source] ?? event.source}
              </p>
            </div>
          </div>
          <Badge variant={VERDICT_BADGE[impact.verdict]} size="sm">
            {VERDICT_LABELS[impact.verdict]}
          </Badge>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span className="font-mono">{impact.score}/100</span>
          <span>Βεβαιότητα: {impact.confidence}</span>
        </div>
      </button>
    </li>
  );
}

function DecisionDetail({
  item,
  analysisPeriod,
  getThumbnailUrl,
}: {
  item: DecisionMemoryItem;
  analysisPeriod: { fromDate: string; toDate: string } | null;
  getThumbnailUrl: (sku: string, product?: unknown) => { url: string };
}) {
  const { event, impact } = item;
  const skuPerformance = event.source === 'erp_history' ? event.performance : undefined;
  const primarySku = event.scope?.skus?.[0] ?? '';
  const thumb = primarySku ? getThumbnailUrl(primarySku).url : '';
  const eventRange = getEventDateRange(event);
  const intersection =
    analysisPeriod && intersectEventWithPeriod(event, analysisPeriod.fromDate, analysisPeriod.toDate);
  const scoredRange = intersection
    ? `${intersection.startDate}${intersection.endDate !== intersection.startDate ? ` έως ${intersection.endDate}` : ''}`
    : `${eventRange.startDate}${eventRange.endDate !== eventRange.startDate ? ` έως ${eventRange.endDate}` : ''}`;
  return (
    <Card padding="lg">
      <CardHeader
        title={
          <div className="flex min-w-0 items-center gap-3">
            <ProductThumbnail src={thumb || undefined} alt={primarySku || event.title} size="md" />
            <span className="min-w-0 truncate">{event.title}</span>
          </div>
        }
        subtitle={`${TYPE_LABELS[event.eventType]} · Ανάλυση ${scoredRange}`}
        icon={<BarChart3 size={18} className="text-[var(--nts-accent-text)]" />}
        action={
          <div className="flex items-center gap-2">
            <Badge variant={VERDICT_BADGE[impact.verdict]}>{VERDICT_LABELS[impact.verdict]}</Badge>
            <Badge variant={event.source === 'erp_history' ? 'info' : 'default'}>
              {SOURCE_LABELS[event.source] ?? event.source}
            </Badge>
            <Badge variant="default">Βεβαιότητα {impact.confidence}</Badge>
          </div>
        }
      />

      {event.hypothesis && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3">
          <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">Εμπορική υπόθεση</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{event.hypothesis}</p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile
          label="Outcome score"
          value={`${impact.score}/100`}
          sub={VERDICT_LABELS[impact.verdict]}
          positive={impact.verdict === 'winning'}
        />
        <MetricTile
          label={skuPerformance ? 'Τζίρος SKU' : 'Τζίρος περιόδου'}
          value={formatCurrency(impact.periodRevenue, 0)}
          sub={
            impact.revenueChangePct != null
              ? `${skuPerformance ? 'vs προηγ. 30ημ.' : 'YoY'} ${impact.revenueChangePct >= 0 ? '+' : ''}${impact.revenueChangePct}%`
              : skuPerformance
                ? `πριν ${formatCurrency(skuPerformance.baselineRevenue, 0)}`
                : 'Χωρίς YoY'
          }
          positive={impact.revenueChangePct != null && impact.revenueChangePct >= 0}
        />
        <MetricTile
          label={skuPerformance ? 'Μονάδες SKU' : 'Παραγγελίες'}
          value={formatNumber(impact.periodOrders)}
          sub={
            impact.ordersChangePct != null
              ? `${skuPerformance ? 'vs προηγ. 30ημ.' : 'YoY'} ${impact.ordersChangePct >= 0 ? '+' : ''}${impact.ordersChangePct}%`
              : skuPerformance
                ? `πριν ${formatNumber(skuPerformance.baselineOrders)}`
                : 'Χωρίς YoY'
          }
          positive={impact.ordersChangePct != null && impact.ordersChangePct >= 0}
        />
        {!skuPerformance && (
          <MetricTile
            label="Store ROAS"
            value={impact.periodRoas != null ? `${impact.periodRoas.toFixed(2)}x` : '—'}
            sub={`Spend ${formatCurrency(impact.campaignSpend, 0)}`}
            positive={impact.periodRoas != null && impact.periodRoas >= 3}
          />
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <InsightList title="Τι λειτούργησε" items={impact.highlights} empty="Δεν υπάρχει ακόμη θετικό signal." tone="success" />
        <InsightList title="Ρίσκα / τι αποφεύγουμε" items={impact.risks} empty="Δεν εντοπίστηκαν σημαντικά risks." tone="danger" />
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border border-[var(--border)] p-3 text-sm sm:grid-cols-3">
        <ScopeLine label="Κανάλια" values={event.scope?.channels} />
        <ScopeLine label="Κατηγορίες" values={event.scope?.categories} />
        <ScopeLine label="SKUs" values={event.scope?.skus} />
      </div>

      {event.changes && event.changes.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">Μεταβολές</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {event.changes.slice(0, 6).map((change) => (
              <div key={`${change.label}-${change.after}`} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">
                <span className="font-semibold text-[var(--text-secondary)]">{change.label}</span>
                <span className="ml-2 text-[var(--text-muted)]">{change.after ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function MetricTile({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-3">
      <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-[var(--text-primary)]">{value}</p>
      {sub && (
        <p className={`mt-1 flex items-center gap-1 text-xs ${positive ? 'text-emerald-600' : 'text-rose-600'}`}>
          {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {sub}
        </p>
      )}
    </div>
  );
}

function InsightList({
  title,
  items,
  empty,
  tone,
}: {
  title: string;
  items: string[];
  empty: string;
  tone: 'success' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] p-3">
      <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {items.slice(0, 5).map((item) => (
            <li key={item} className={`text-sm ${tone === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScopeLine({ label, values }: { label: string; values?: string[] }) {
  const display = values?.slice(0, 4).join(', ');
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 truncate text-[var(--text-secondary)]">{display || '—'}</p>
    </div>
  );
}

function PlaybookPanel({ items, onSelect }: { items: DecisionMemoryItem[]; onSelect: (id: string) => void }) {
  return (
    <Card padding="lg">
      <CardHeader title="Scenario playbooks" subtitle="Επιτυχημένα σενάρια για επανάχρηση και αποτυχημένα για αποφυγή." />
      <div className="grid gap-3 lg:grid-cols-2">
        {items.map(({ event, impact }) => (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelect(event.id)}
            className="rounded-xl border border-[var(--border)] p-3 text-left transition-colors hover:bg-[var(--surface-1)]"
          >
            <div className="flex items-center justify-between gap-2">
              <Badge variant={VERDICT_BADGE[impact.verdict]}>{VERDICT_LABELS[impact.verdict]}</Badge>
              <span className="font-mono text-xs text-[var(--text-muted)]">{impact.score}/100</span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-semibold text-[var(--text-primary)]">{event.title}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {impact.verdict === 'winning' ? 'Χρήση ως playbook' : 'Αποφυγή επανάληψης χωρίς αλλαγές'}
            </p>
          </button>
        ))}
      </div>
    </Card>
  );
}

function EmptyState({
  coverage,
  periodLabel,
  totalInPeriod,
  hasActiveFilters,
}: {
  coverage: {
    hasRevenue: boolean;
    campaigns: number;
    products: number;
    productSignals: number;
    connectedPlatforms: string[];
  };
  periodLabel: string | null;
  totalInPeriod: number;
  hasActiveFilters: boolean;
}) {
  const noDecisionsInPeriod = periodLabel && totalInPeriod === 0;
  return (
    <div className="p-5">
      <p className="text-sm font-semibold text-[var(--text-primary)]">
        {hasActiveFilters && totalInPeriod > 0
          ? 'Κανένα αποτέλεσμα με τα τρέχοντα φίλτρα.'
          : noDecisionsInPeriod
            ? `Καμία απόφαση στην περίοδο ${periodLabel}.`
            : 'Δεν υπάρχουν ακόμη decision events.'}
      </p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        {hasActiveFilters && totalInPeriod > 0
          ? 'Αλλάξτε tab, τύπο ή αναζήτηση για να δείτε άλλες αποφάσεις της περιόδου.'
          : noDecisionsInPeriod
            ? 'Δοκιμάστε ευρύτερο εύρος ημερολογίου ή προσθέστε manual decision για την περίοδο.'
            : 'Για υψηλότερο confidence συνδέστε e-shop, campaign connectors και product/procurement data.'}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant={coverage.hasRevenue ? 'success' : 'warning'}>Revenue data</Badge>
        <Badge variant={coverage.campaigns > 0 ? 'success' : 'warning'}>Campaigns {coverage.campaigns}</Badge>
        <Badge variant={coverage.products > 0 ? 'success' : 'warning'}>Products {coverage.products}</Badge>
        <Badge variant={coverage.productSignals > 0 ? 'success' : 'warning'}>Signals {coverage.productSignals}</Badge>
      </div>
    </div>
  );
}
