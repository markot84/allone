import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Calendar, CheckSquare, PackagePlus, Sparkles, TrendingUp } from 'lucide-react';
import { Card, CardHeader, Button, PageHeader, Badge, Spinner } from '../common';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useProductIntelligenceAggregate } from '../../hooks/useProductIntelligenceAggregate';
import {
  buildMarketingPlanDraft,
  resolvePlanPeriod,
  type MarketingPlanAction,
  type MarketingPlanDraft,
  type MarketingPlanPresetId,
  type MarketingPlanCoreMessage,
} from '../../services/marketingPlanEngine';
import {
  buildMarketingPlanInsight,
  shiftIsoDateByYears,
  type MarketingPlanReorderGroup,
  type MarketingPlanSkuSuggestion,
} from '../../services/marketingPlanInsights';
import { generateMarketingPlanMessage } from '../../services/marketingPlanMessage';
import { fetchDataAnalysisOrders } from '../../services/ecommerceRawOrders';
import { FirestoreService } from '../../services/firestore';
import { useBrand } from '../../hooks/useBrand';
import { formatCurrency, formatNumber } from '../../utils/format';

const PRESETS: { id: MarketingPlanPresetId; label: string }[] = [
  { id: 'next_month', label: 'Επόμενος μήνας' },
  { id: 'next_quarter', label: 'Επόμενο τρίμηνο' },
  { id: 'black_friday', label: 'Black Friday' },
  { id: 'christmas', label: 'Χριστούγεννα' },
  { id: 'january_sales', label: 'Εκπτώσεις Ιανουαρίου' },
  { id: 'back_to_school', label: 'Back to School' },
];

export function MarketingPlanPage({ onSectionChange }: { onSectionChange?: (s: string) => void } = {}) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;
  const { activeStrategy } = useActiveStrategy();
  const { campaigns } = useCampaigns();
  const ga4 = useGA4Data();
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const inventory = useProductIntelligenceAggregate('all', 1, {
    pageSize: 150,
    includeNoStock: true,
    sortField: 'stock_level',
    sortDirection: 'desc',
  });
  const queryClient = useQueryClient();

  const [preset, setPreset] = useState<MarketingPlanPresetId>('next_month');
  const [draft, setDraft] = useState<MarketingPlanDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const period = useMemo(() => ({ presetId: preset, ...resolvePlanPeriod(preset) }), [preset]);
  const lastYearFrom = shiftIsoDateByYears(period.fromDate, -1);
  const lastYearTo = shiftIsoDateByYears(period.toDate, -1);

  const lastYearOrdersQuery = useQuery({
    queryKey: ['marketingPlanLastYearOrders', brandId, lastYearFrom, lastYearTo, ecomm.connectedPlatforms.join('|')],
    queryFn: () =>
      brandId
        ? fetchDataAnalysisOrders(brandId, ecomm.connectedPlatforms, {
            sinceDate: lastYearFrom,
            untilDate: lastYearTo,
            cacheFirst: true,
            revenueMode: 'all',
          })
        : Promise.resolve([]),
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const savedQuery = useQuery({
    queryKey: ['marketing_plans', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      return FirestoreService.getDocuments<{ id: string; plan: MarketingPlanDraft; savedAt: string }>(
        'marketing_plans',
        [],
        brandId
      );
    },
    enabled: !!brandId,
    staleTime: 30 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: async (plan: MarketingPlanDraft) => {
      if (!brandId) throw new Error('No brand');
      const id = `mp_${Date.now()}`;
      await FirestoreService.setDocument('marketing_plans', id, {
        id,
        brandId,
        plan,
        savedAt: new Date().toISOString(),
      });
      return id;
    },
    onSuccess: () => {
      if (brandId) queryClient.invalidateQueries({ queryKey: ['marketing_plans', brandId] });
    },
  });

  const topRoas = useMemo(
    () => [...(campaigns ?? [])].map((c) => c.roas || 0).sort((a, b) => b - a)[0],
    [campaigns]
  );

  const canGenerate = !!brandId && !lastYearOrdersQuery.isLoading && !inventory.isLoading;

  const generate = async () => {
    if (!brandId) return;
    setGenerating(true);
    try {
      const insight = buildMarketingPlanInsight({
        period,
        lastYearOrders: lastYearOrdersQuery.data ?? [],
        inventoryProducts: inventory.page?.products ?? [],
      });
      const coreMessage: MarketingPlanCoreMessage = await generateMarketingPlanMessage({
        insight,
        brandName: currentBrand?.name,
      });
      setDraft(
        buildMarketingPlanDraft({
          presetId: preset,
          monthlyBudget: activeStrategy?.monthlyBudget,
          campaigns: campaigns as never[],
          storeRevenue12m: ecomm.totalRevenue,
          topCampaignRoas: topRoas,
          hasGa4: ga4.hasData,
          insight,
          coreMessage,
        })
      );
    } finally {
      setGenerating(false);
    }
  };

  const checklist = useMemo(() => {
    if (!draft) return [];
    return [...draft.performance, ...draft.organic];
  }, [draft]);

  const loadingContext = lastYearOrdersQuery.isLoading || inventory.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Marketing Plan</h2>}
        description={
          <p className="text-sm text-[#4A4A4A]">
            Seasonal plan από περσινές πωλήσεις, τρέχον απόθεμα, πρόταση παραγγελίας και core marketing message.
          </p>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSectionChange?.('strategy')}>
              Strategy
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onSectionChange?.('calendar')}>
              Content calendar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onSectionChange?.('coordination')}>
              Coordination
            </Button>
          </div>
        }
      />

      <Card padding="lg">
        <CardHeader title="Περίοδος & δεδομένα βάσης" icon={<Calendar size={18} className="text-[var(--nts-accent)]" />} />
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPreset(p.id);
                setDraft(null);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium border transition-colors ${
                preset === p.id
                  ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10 text-[var(--nts-accent)]'
                  : 'border-[#E5E7EB] text-[#4A4A4A] hover:border-[var(--nts-accent)]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <ContextPill label="Νέα περίοδος" value={`${period.fromDate} → ${period.toDate}`} />
          <ContextPill label="Στοιχεία βάσης" value={`${lastYearFrom} → ${lastYearTo}`} />
          <ContextPill label="Inventory sample" value={`${formatNumber(inventory.page?.products.length ?? 0)} SKU`} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            icon={generating ? <Spinner size="sm" /> : <Sparkles size={16} />}
            onClick={() => void generate()}
            disabled={!canGenerate || generating}
          >
            {generating ? 'Δημιουργία…' : 'Δημιουργία enriched plan'}
          </Button>
          {loadingContext ? <span className="text-xs text-[#6B7280]">Φόρτωση περσινών στοιχείων και inventory…</span> : null}
        </div>
      </Card>

      {draft && (
        <>
          <Card padding="lg">
            <CardHeader
              title={draft.coreMessage.headline}
              subtitle={`${draft.periodLabel} · ${draft.fromDate} — ${draft.toDate}`}
              icon={<Sparkles size={18} className="text-[var(--nts-accent)]" />}
            />
            <p className="mt-3 text-sm leading-relaxed text-[#4A4A4A]">{draft.coreMessage.campaignAngle}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <BudgetPill label="Google Ads" pct={draft.budgetSplit.googleAds} />
              <BudgetPill label="Meta" pct={draft.budgetSplit.meta} />
              <BudgetPill label="Organic" pct={draft.budgetSplit.organic} />
              <BudgetPill label="Other" pct={draft.budgetSplit.other} />
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                <p className="text-xs font-semibold uppercase text-[#9CA3AF]">Proof points</p>
                <ul className="mt-2 space-y-1 text-sm text-[#374151]">
                  {draft.coreMessage.proofPoints.map((point) => <li key={point}>• {point}</li>)}
                </ul>
              </div>
              <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                <p className="text-xs font-semibold uppercase text-[#9CA3AF]">CTA ideas</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {draft.coreMessage.ctaIdeas.map((cta) => <Badge key={cta} variant="info" size="sm">{cta}</Badge>)}
                </div>
              </div>
            </div>
            {draft.risks.length > 0 && (
              <ul className="mt-4 space-y-1 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                {draft.risks.map((r) => <li key={r}>• {r}</li>)}
              </ul>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={saveMutation.isPending}
                onClick={() => void saveMutation.mutateAsync(draft)}
              >
                Αποθήκευση στο Firestore
              </Button>
            </div>
          </Card>

          {draft.evidence && (
            <Card padding="lg">
              <CardHeader title="Based on last year" icon={<BarChart3 size={18} className="text-[var(--nts-accent)]" />} />
              <div className="mt-3 grid gap-3 sm:grid-cols-5">
                <Metric label="Τζίρος" value={formatCurrency(draft.evidence.revenue, 0)} />
                <Metric label="Παραγγελίες" value={formatNumber(draft.evidence.orders)} />
                <Metric label="Τεμάχια" value={formatNumber(draft.evidence.units)} />
                <Metric label="AOV" value={formatCurrency(draft.evidence.aov, 0)} />
                <Metric label="SKU match" value={`${draft.dataQuality?.lineItemCoveragePct ?? 0}%`} />
              </div>
            </Card>
          )}

          <Card padding="lg">
            <CardHeader title="Πρόταση παραγγελίας" icon={<PackagePlus size={18} className="text-[var(--nts-accent)]" />} />
            {draft.reorderPlan.length === 0 ? (
              <p className="mt-3 text-sm text-[#6B7280]">Δεν υπάρχει αρκετή περσινή ανάλυση γραμμών για πρόταση παραγγελίας.</p>
            ) : (
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                {draft.reorderPlan.slice(0, 8).map((row) => <ReorderCard key={row.key} row={row} />)}
              </div>
            )}
          </Card>

          {draft.skuSuggestions.length > 0 && (
            <Card padding="lg">
              <CardHeader title="SKU opportunities" icon={<TrendingUp size={18} className="text-[var(--nts-accent)]" />} />
              <div className="mt-3 overflow-x-auto rounded-xl border border-[#E5E7EB]">
                <table className="w-full text-sm">
                  <thead className="bg-[#F9FAFB] text-xs text-[#6B7280]">
                    <tr>
                      <th className="px-3 py-2 text-left">SKU</th>
                      <th className="px-3 py-2 text-left">Προϊόν</th>
                      <th className="px-3 py-2 text-right">Πέρυσι τεμ.</th>
                      <th className="px-3 py-2 text-right">Stock</th>
                      <th className="px-3 py-2 text-right">Πρόταση</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.skuSuggestions.slice(0, 12).map((row) => <SkuRow key={row.sku} row={row} />)}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card padding="lg">
            <CardHeader title="Execution checklist" icon={<CheckSquare size={18} className="text-[var(--nts-accent)]" />} />
            <ul className="mt-3 space-y-2">
              {checklist.map((item) => <ChecklistItem key={item.id} item={item} />)}
            </ul>
          </Card>
        </>
      )}

      {savedQuery.data && savedQuery.data.length > 0 && (
        <Card padding="md">
          <p className="mb-2 text-xs font-semibold uppercase text-[#9CA3AF]">Αποθηκευμένα plans</p>
          <ul className="space-y-1 text-sm text-[#4A4A4A]">
            {savedQuery.data.slice(0, 5).map((row) => (
              <li key={row.id}>
                {row.plan?.periodLabel} · {row.savedAt?.slice(0, 10)}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ContextPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">{label}</p>
      <p className="mt-1 text-sm font-semibold text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] px-3 py-2">
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function BudgetPill({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-center">
      <p className="text-[10px] font-semibold uppercase text-[#9CA3AF]">{label}</p>
      <p className="font-mono text-lg font-bold text-[#1A1A1A]">{pct}%</p>
    </div>
  );
}

function ReorderCard({ row }: { row: MarketingPlanReorderGroup }) {
  const tone = row.action === 'increase' ? 'success' : row.action === 'maintain' ? 'warning' : row.action === 'reduce' ? 'info' : 'default';
  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#1A1A1A]">{row.subcategory || row.category}</p>
          <p className="text-xs text-[#6B7280]">{[row.category, row.brand].filter(Boolean).join(' · ') || '—'}</p>
        </div>
        <Badge variant={tone} size="sm">{row.action}</Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <Metric label="Πέρυσι" value={`${formatNumber(row.lastYearUnits)} τεμ.`} />
        <Metric label="Stock" value={formatNumber(row.currentStock)} />
        <Metric label="Πρόταση" value={formatNumber(row.estimatedReorderQty)} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[#6B7280]">{row.rationale}</p>
    </div>
  );
}

function SkuRow({ row }: { row: MarketingPlanSkuSuggestion }) {
  return (
    <tr className="border-t border-[#E5E7EB]">
      <td className="px-3 py-2 font-mono text-xs text-[#1A1A1A]">{row.sku}</td>
      <td className="px-3 py-2">
        <p className="font-medium text-[#1A1A1A]">{row.name}</p>
        <p className="text-xs text-[#6B7280]">{[row.category, row.brand].filter(Boolean).join(' · ')}</p>
      </td>
      <td className="px-3 py-2 text-right font-mono">{formatNumber(row.lastYearUnits)}</td>
      <td className="px-3 py-2 text-right font-mono">{formatNumber(row.currentStock)}</td>
      <td className="px-3 py-2 text-right font-mono font-semibold">{formatNumber(row.estimatedReorderQty)}</td>
    </tr>
  );
}

function ChecklistItem({ item }: { item: MarketingPlanAction }) {
  return (
    <li className="flex gap-2 rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm">
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
          item.priority === 'high'
            ? 'bg-rose-100 text-rose-700'
            : item.priority === 'medium'
              ? 'bg-amber-100 text-amber-800'
              : 'bg-gray-100 text-gray-600'
        }`}
      >
        {item.channel}
      </span>
      <div>
        <p className="font-medium text-[#1A1A1A]">{item.title}</p>
        <p className="mt-0.5 text-xs text-[#6B7280]">{item.detail}</p>
      </div>
    </li>
  );
}
