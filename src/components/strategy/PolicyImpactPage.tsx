import { useMemo, useState } from 'react';
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
import { Card, CardHeader, Button, PageHeader, Spinner, Badge } from '../common';
import { useCommercialDecisionMemory } from '../../hooks/useCommercialDecisionMemory';
import type { CommercialDecisionEventType, CommercialDecisionVerdict } from '../../services/commercialDecisionMemory';
import type { DecisionMemoryItem } from '../../hooks/useCommercialDecisionMemory';
import { formatCurrency, formatNumber } from '../../utils/format';

const TYPE_LABELS: Record<CommercialDecisionEventType | 'all', string> = {
  all: 'Όλοι οι τύποι',
  pricing: 'Τιμές',
  discount: 'Εκπτώσεις',
  campaign: 'Καμπάνιες',
  channel: 'Κανάλια',
  assortment: 'Assortment',
  stock: 'Stock',
  strategy: 'Strategy',
  manual: 'Manual',
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

export function PolicyImpactPage({ onSectionChange }: { onSectionChange?: (s: string) => void } = {}) {
  const { items, summary, saveDecisionEvent, isSaving, isLoading, dataCoverage } = useCommercialDecisionMemory();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<CommercialDecisionEventType | 'all'>('all');
  const [verdictFilter, setVerdictFilter] = useState<CommercialDecisionVerdict | 'all'>('all');
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
    return items.filter(({ event, impact }) => {
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
  }, [items, query, typeFilter, verdictFilter]);

  const selected = useMemo(
    () => filteredItems.find((item) => item.event.id === selectedId) ?? filteredItems[0] ?? null,
    [filteredItems, selectedId]
  );

  const playbooks = useMemo(
    () => items.filter((item) => item.impact.verdict === 'winning' || item.impact.verdict === 'losing').slice(0, 4),
    [items]
  );

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
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Commercial Decision Memory</h2>}
        description={
          <p className="text-sm text-[#4A4A4A]">
            Αυτόματο ιστορικό εμπορικών αποφάσεων, outcome scoring και playbooks για επανάχρηση ή αποφυγή.
          </p>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={() => onSectionChange?.('strategy')}>
              Strategy
            </Button>
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>
              Add missing decision
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={<CheckCircle2 size={18} />} label="Winning scenarios" value={summary.winning} tone="success" />
        <SummaryCard icon={<CircleAlert size={18} />} label="Needs review" value={summary.review} tone="warning" />
        <SummaryCard icon={<TrendingDown size={18} />} label="Avoid repeating" value={summary.avoid} tone="danger" />
        <SummaryCard icon={<Lightbulb size={18} />} label="Active experiments" value={summary.active} tone="info" />
      </div>

      {showForm && (
        <Card padding="lg" className="border border-[var(--nts-accent)]/30">
          <CardHeader
            title="Add missing decision"
            subtitle="Για αποφάσεις που δεν ανιχνεύονται αυτόματα από connectors, Strategy ή campaign imports."
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <input
              className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm xl:col-span-2"
              placeholder="Τίτλος απόφασης"
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            />
            <select
              className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
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
              className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
              value={form.startDate}
              onChange={(e) => setForm((prev) => ({ ...prev, startDate: e.target.value }))}
            />
            <input
              type="date"
              className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
              value={form.endDate}
              onChange={(e) => setForm((prev) => ({ ...prev, endDate: e.target.value }))}
            />
          </div>
          <textarea
            className="mt-3 min-h-20 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
            placeholder="Hypothesis / γιατί πήραμε αυτή την απόφαση;"
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

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <Card padding="md">
            <CardHeader title="Decision Library" icon={<BookOpenCheck size={18} className="text-[var(--nts-accent)]" />} />
            <div className="space-y-3">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                <input
                  className="w-full rounded-lg border border-[#E5E7EB] py-2 pl-9 pr-3 text-sm"
                  placeholder="Search decision, SKU, channel..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <FilterSelect value={typeFilter} onChange={(value) => setTypeFilter(value as CommercialDecisionEventType | 'all')} options={TYPE_LABELS} />
                <FilterSelect value={verdictFilter} onChange={(value) => setVerdictFilter(value as CommercialDecisionVerdict | 'all')} options={VERDICT_LABELS} />
              </div>
            </div>
          </Card>

          <Card padding="none">
            {isLoading ? (
              <div className="p-5">
                <Spinner />
              </div>
            ) : filteredItems.length === 0 ? (
              <EmptyState coverage={dataCoverage} />
            ) : (
              <ul className="max-h-[720px] divide-y divide-[#E5E7EB] overflow-y-auto">
                {filteredItems.map((item) => (
                  <DecisionListItem
                    key={item.event.id}
                    item={item}
                    selected={selected?.event.id === item.event.id}
                    onSelect={() => setSelectedId(item.event.id)}
                  />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          {selected ? (
            <>
              <DecisionDetail item={selected} />
              {playbooks.length > 0 && <PlaybookPanel items={playbooks} onSelect={(id) => setSelectedId(id)} />}
            </>
          ) : (
            <Card padding="lg">
              <p className="text-sm text-[#6B7280]">Επιλέξτε decision για ανάλυση.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone: 'success' | 'warning' | 'danger' | 'info';
}) {
  const toneClass = {
    success: 'text-emerald-600 bg-emerald-50',
    warning: 'text-amber-600 bg-amber-50',
    danger: 'text-rose-600 bg-rose-50',
    info: 'text-sky-600 bg-sky-50',
  }[tone];
  return (
    <Card padding="md">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-[#9CA3AF]">{label}</p>
          <p className="mt-1 font-mono text-2xl font-bold text-[#1A1A1A]">{formatNumber(value)}</p>
        </div>
        <span className={`rounded-xl p-2 ${toneClass}`}>{icon}</span>
      </div>
    </Card>
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
      className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
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
  onSelect,
}: {
  item: DecisionMemoryItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const { event, impact } = item;
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`w-full px-4 py-3 text-left transition-colors ${
          selected ? 'bg-[var(--nts-accent)]/10' : 'hover:bg-[#F9FAFB]'
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[#1A1A1A]">{event.title}</p>
            <p className="mt-1 text-xs text-[#6B7280]">
              {TYPE_LABELS[event.eventType]} · {event.decisionDate} · {event.source}
            </p>
          </div>
          <Badge variant={VERDICT_BADGE[impact.verdict]} size="sm">
            {VERDICT_LABELS[impact.verdict]}
          </Badge>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-[#6B7280]">
          <span className="font-mono">{impact.score}/100</span>
          <span>Confidence: {impact.confidence}</span>
        </div>
      </button>
    </li>
  );
}

function DecisionDetail({ item }: { item: DecisionMemoryItem }) {
  const { event, impact } = item;
  return (
    <Card padding="lg">
      <CardHeader
        title={event.title}
        subtitle={`${TYPE_LABELS[event.eventType]} · ${event.startDate || event.decisionDate}${event.endDate ? ` έως ${event.endDate}` : ''}`}
        icon={<BarChart3 size={18} className="text-[var(--nts-accent)]" />}
        action={
          <div className="flex items-center gap-2">
            <Badge variant={VERDICT_BADGE[impact.verdict]}>{VERDICT_LABELS[impact.verdict]}</Badge>
            <Badge variant="default">Confidence {impact.confidence}</Badge>
          </div>
        }
      />

      {event.hypothesis && (
        <div className="mb-4 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-3">
          <p className="text-xs font-semibold uppercase text-[#9CA3AF]">Hypothesis</p>
          <p className="mt-1 text-sm text-[#374151]">{event.hypothesis}</p>
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
          label="Τζίρος περιόδου"
          value={formatCurrency(impact.periodRevenue, 0)}
          sub={impact.revenueChangePct != null ? `YoY ${impact.revenueChangePct >= 0 ? '+' : ''}${impact.revenueChangePct}%` : 'No YoY'}
          positive={impact.revenueChangePct != null && impact.revenueChangePct >= 0}
        />
        <MetricTile
          label="Παραγγελίες"
          value={formatNumber(impact.periodOrders)}
          sub={impact.ordersChangePct != null ? `YoY ${impact.ordersChangePct >= 0 ? '+' : ''}${impact.ordersChangePct}%` : 'No YoY'}
          positive={impact.ordersChangePct != null && impact.ordersChangePct >= 0}
        />
        <MetricTile
          label="Store ROAS"
          value={impact.periodRoas != null ? `${impact.periodRoas.toFixed(2)}x` : '—'}
          sub={`Spend ${formatCurrency(impact.campaignSpend, 0)}`}
          positive={impact.periodRoas != null && impact.periodRoas >= 3}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <InsightList title="What worked" items={impact.highlights} empty="Δεν υπάρχει ακόμη θετικό signal." tone="success" />
        <InsightList title="Risks / avoid" items={impact.risks} empty="Δεν εντοπίστηκαν σημαντικά risks." tone="danger" />
      </div>

      <div className="mt-4 grid gap-3 rounded-xl border border-[#E5E7EB] p-3 text-sm sm:grid-cols-3">
        <ScopeLine label="Channels" values={event.scope?.channels} />
        <ScopeLine label="Categories" values={event.scope?.categories} />
        <ScopeLine label="SKUs" values={event.scope?.skus} />
      </div>

      {event.changes && event.changes.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase text-[#9CA3AF]">Changes</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {event.changes.slice(0, 6).map((change) => (
              <div key={`${change.label}-${change.after}`} className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm">
                <span className="font-semibold text-[#374151]">{change.label}</span>
                <span className="ml-2 text-[#6B7280]">{change.after ?? '—'}</span>
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
    <div className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-3">
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-[#1A1A1A]">{value}</p>
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
    <div className="rounded-xl border border-[#E5E7EB] p-3">
      <p className="text-xs font-semibold uppercase text-[#9CA3AF]">{title}</p>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[#6B7280]">{empty}</p>
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
      <p className="text-xs font-semibold uppercase text-[#9CA3AF]">{label}</p>
      <p className="mt-1 truncate text-[#374151]">{display || '—'}</p>
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
            className="rounded-xl border border-[#E5E7EB] p-3 text-left transition-colors hover:bg-[#FAFAFA]"
          >
            <div className="flex items-center justify-between gap-2">
              <Badge variant={VERDICT_BADGE[impact.verdict]}>{VERDICT_LABELS[impact.verdict]}</Badge>
              <span className="font-mono text-xs text-[#6B7280]">{impact.score}/100</span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-semibold text-[#1A1A1A]">{event.title}</p>
            <p className="mt-1 text-xs text-[#6B7280]">
              {impact.verdict === 'winning' ? 'Use as playbook' : 'Avoid repeating without changes'}
            </p>
          </button>
        ))}
      </div>
    </Card>
  );
}

function EmptyState({
  coverage,
}: {
  coverage: { hasRevenue: boolean; campaigns: number; products: number; productSignals: number; connectedPlatforms: string[] };
}) {
  return (
    <div className="p-5">
      <p className="text-sm font-semibold text-[#1A1A1A]">Δεν υπάρχουν ακόμη decision events.</p>
      <p className="mt-1 text-sm text-[#6B7280]">
        Για υψηλότερο confidence συνδέστε e-shop, campaign connectors και product/procurement data.
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
