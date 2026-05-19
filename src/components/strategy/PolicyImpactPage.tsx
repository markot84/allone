import { useMemo, useState } from 'react';
import { Percent, Plus, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardHeader, Button, PageHeader, Spinner, Badge } from '../common';
import { useBrand } from '../../hooks/useBrand';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useCommercialActions } from '../../hooks/useCommercialActions';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useCampaigns } from '../../hooks/useCampaigns';
import { analyzePolicyImpact } from '../../services/policyImpactAnalysis';
import { calculateCampaignMetrics } from '../../utils/roiUtils';
import {
  applyCampaignDateRangeToMetrics,
  filterCampaignsByScheduleDateOverlap,
} from '../../utils/campaignDateRangeMetrics';
import type { Campaign } from '../../types';
import type { SeasonalDiscountConfig } from './SeasonalDiscountPanel';
import { formatCurrency, formatNumber } from '../../utils/format';

export function PolicyImpactPage({ onSectionChange }: { onSectionChange?: (s: string) => void } = {}) {
  const { currentBrand } = useBrand();
  const { activeStrategy } = useActiveStrategy();
  const { actions, isLoading, saveAction, isSaving } = useCommercialActions();
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const { campaigns } = useCampaigns();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formDiscount, setFormDiscount] = useState(15);
  const targetUplift = 10;

  const strategyActions = useMemo(() => {
    const seasonal = activeStrategy?.seasonalDiscount as SeasonalDiscountConfig | undefined;
    if (!seasonal?.periodName) return [];
    const brandId = currentBrand?.id;
    if (!brandId) return [];
    return [
      {
        id: `strategy_${seasonal.periodId || 'seasonal'}`,
        brandId,
        name: seasonal.periodName,
        startDate: seasonal.startDate || '',
        endDate: seasonal.endDate || '',
        discountPercent: seasonal.discountPercent,
        scope: seasonal.scope,
        selectedCategories: seasonal.selectedCategories,
        selectedProductIds: seasonal.selectedProductIds,
        source: 'strategy_seasonal' as const,
        strategyRef: seasonal.periodId,
        createdAt: activeStrategy?.updatedAt || '',
        updatedAt: activeStrategy?.updatedAt || '',
        targets: undefined,
      },
    ];
  }, [activeStrategy, currentBrand?.id]);

  const allActions = useMemo(() => {
    const manual = actions.filter((a) => a.source === 'manual');
    const merged = [...strategyActions, ...manual];
    const seen = new Set<string>();
    return merged.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return Boolean(a.startDate && a.endDate);
    });
  }, [actions, strategyActions]);

  const selected = useMemo(
    () => allActions.find((a) => a.id === selectedId) ?? allActions[0] ?? null,
    [allActions, selectedId]
  );

  const impact = useMemo(() => {
    if (!selected?.startDate || !selected.endDate) return null;
    const periodCampaigns = applyCampaignDateRangeToMetrics(
      filterCampaignsByScheduleDateOverlap(campaigns as Campaign[], selected.startDate, selected.endDate),
      selected.startDate,
      selected.endDate
    );
    const spend = calculateCampaignMetrics(periodCampaigns).totalSpend;
    const revenueByDay: Record<string, number> = {};
    for (const r of ecomm.dailyRevenue) revenueByDay[r.date] = r.revenue;
    return analyzePolicyImpact({
      startDate: selected.startDate,
      endDate: selected.endDate,
      revenueByDay,
      ordersByDay: ecomm.ordersByDay,
      campaignSpendInPeriod: spend,
      targets: {
        revenueUpliftPct: selected.targets?.revenueUpliftPct ?? targetUplift,
        minRoas: selected.targets?.minRoas,
      },
    });
  }, [selected, campaigns, ecomm.dailyRevenue, ecomm.ordersByDay, targetUplift]);

  const handleCreate = async () => {
    if (!formName || !formStart || !formEnd) return;
    const saved = await saveAction({
      name: formName,
      startDate: formStart,
      endDate: formEnd,
      discountPercent: formDiscount,
      scope: 'all',
      source: 'manual',
      targets: { revenueUpliftPct: targetUplift },
    });
    setSelectedId(saved.id);
    setShowForm(false);
    setFormName('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Αξιολόγηση εμπορικής πολιτικής</h2>}
        description={
          <p className="text-sm text-[#4A4A4A]">
            Σύγκριση YoY — έσοδα, παραγγελίες και ROAS για κάθε ενέργεια (Strategy + manual).
          </p>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSectionChange?.('strategy')}>
              ← Strategy
            </Button>
            <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setShowForm(true)}>
              Νέα ενέργεια
            </Button>
          </div>
        }
      />

      {showForm && (
        <Card padding="lg" className="border border-[var(--nts-accent)]/30">
          <h3 className="text-sm font-semibold text-[#1A1A1A] mb-3">Χειροκίνητη ενέργεια</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
              placeholder="Όνομα"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
            />
            <input type="date" className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm" value={formStart} onChange={(e) => setFormStart(e.target.value)} />
            <input type="date" className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} />
            <input
              type="number"
              className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm"
              placeholder="% έκπτωση"
              value={formDiscount}
              onChange={(e) => setFormDiscount(Number(e.target.value))}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="primary" size="sm" onClick={() => void handleCreate()} disabled={isSaving}>
              Αποθήκευση
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>
              Ακύρωση
            </Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card padding="md">
          <p className="text-xs font-semibold uppercase text-[#9CA3AF] mb-2">Ενέργειες</p>
          {isLoading ? (
            <Spinner size="sm" />
          ) : allActions.length === 0 ? (
            <p className="text-sm text-[#6B7280]">Δεν υπάρχουν ενέργειες. Ορίστε seasonal discount στη Strategy ή προσθέστε manual.</p>
          ) : (
            <ul className="space-y-1">
              {allActions.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(a.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      selected?.id === a.id ? 'bg-[var(--nts-accent)]/10 font-semibold text-[var(--nts-accent)]' : 'hover:bg-[#F5F5F5]'
                    }`}
                  >
                    <span className="block truncate">{a.name}</span>
                    <span className="text-[10px] text-[#9CA3AF]">
                      {a.startDate} — {a.endDate}
                      {a.source === 'strategy_seasonal' ? ' · Strategy' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          {!selected ? (
            <Card padding="lg">
              <p className="text-sm text-[#6B7280]">Επιλέξτε ενέργεια για ανάλυση.</p>
            </Card>
          ) : !ecomm.hasData ? (
            <Card padding="lg">
              <p className="text-sm text-[#6B7280]">Συνδέστε e-shop για YoY σύγκριση εσόδων.</p>
            </Card>
          ) : impact ? (
            <>
              <Card padding="lg">
                <CardHeader
                  title={selected.name}
                  subtitle={`${selected.startDate} — ${selected.endDate}${selected.discountPercent ? ` · ${selected.discountPercent}% έκπτωση` : ''}`}
                  icon={<Percent size={18} className="text-[var(--nts-accent)]" />}
                />
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricTile
                    label="Τζίρος περιόδου"
                    value={formatCurrency(impact.periodRevenue, 0)}
                    sub={impact.revenueChangePct != null ? `YoY ${impact.revenueChangePct >= 0 ? '+' : ''}${impact.revenueChangePct}%` : undefined}
                    positive={impact.revenueChangePct != null && impact.revenueChangePct >= 0}
                  />
                  <MetricTile label="Τζίρος YoY" value={formatCurrency(impact.yoyRevenue, 0)} />
                  <MetricTile
                    label="Παραγγελίες"
                    value={formatNumber(impact.periodOrders)}
                    sub={impact.ordersChangePct != null ? `YoY ${impact.ordersChangePct >= 0 ? '+' : ''}${impact.ordersChangePct}%` : undefined}
                    positive={impact.ordersChangePct != null && impact.ordersChangePct >= 0}
                  />
                  <MetricTile
                    label="Store ROAS"
                    value={impact.periodRoas != null ? `${impact.periodRoas.toFixed(2)}x` : '—'}
                    sub={`Spend ${formatCurrency(impact.campaignSpend, 0)}`}
                  />
                </div>
              </Card>

              {impact.targetHits.length > 0 && (
                <Card padding="lg">
                  <CardHeader title="Στόχοι" icon={<Target size={18} className="text-[var(--nts-accent)]" />} />
                  <ul className="mt-3 space-y-2">
                    {impact.targetHits.map((t) => (
                      <li key={t.key} className="flex items-center justify-between gap-2 rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm">
                        <span className="text-[#374151]">{t.label}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-xs text-[#6B7280]">{t.actual}</span>
                          <Badge variant={t.hit ? 'success' : 'danger'} size="sm">
                            {t.hit ? 'Επίτευξη' : 'Απόκλιση'}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </>
          ) : (
            <Spinner />
          )}
        </div>
      </div>
    </div>
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
