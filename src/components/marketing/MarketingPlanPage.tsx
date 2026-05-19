import { useMemo, useState } from 'react';
import { Calendar, CheckSquare, Sparkles } from 'lucide-react';
import { Card, CardHeader, Button, PageHeader } from '../common';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import {
  buildMarketingPlanDraft,
  type MarketingPlanDraft,
  type MarketingPlanPresetId,
} from '../../services/marketingPlanEngine';
import { FirestoreService } from '../../services/firestore';
import { useBrand } from '../../hooks/useBrand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
  const queryClient = useQueryClient();

  const [preset, setPreset] = useState<MarketingPlanPresetId>('next_month');
  const [draft, setDraft] = useState<MarketingPlanDraft | null>(null);

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

  const generate = () => {
    const topRoas = [...(campaigns ?? [])]
      .map((c) => ({ roas: c.roas || 0 }))
      .sort((a, b) => b.roas - a.roas)[0]?.roas;
    setDraft(
      buildMarketingPlanDraft({
        presetId: preset,
        monthlyBudget: activeStrategy?.monthlyBudget,
        campaigns: campaigns as never[],
        storeRevenue12m: ecomm.totalRevenue,
        topCampaignRoas: topRoas,
        hasGa4: ga4.hasData,
      })
    );
  };

  const checklist = useMemo(() => {
    if (!draft) return [];
    return [...draft.performance, ...draft.organic];
  }, [draft]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Marketing Plan</h2>}
        description={
          <p className="text-sm text-[#4A4A4A]">
            Structured plan (performance + organic) από ιστορικό — presets περιόδου, checklist & budget split.
          </p>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" onClick={() => onSectionChange?.('strategy')}>
              ← Strategy
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
        <CardHeader title="Περίοδος" icon={<Calendar size={18} className="text-[var(--nts-accent)]" />} />
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
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
        <Button className="mt-4" variant="primary" icon={<Sparkles size={16} />} onClick={generate}>
          Δημιουργία draft
        </Button>
      </Card>

      {draft && (
        <>
          <Card padding="lg">
            <CardHeader
              title={draft.periodLabel}
              subtitle={`${draft.fromDate} — ${draft.toDate}`}
              icon={<Sparkles size={18} className="text-[var(--nts-accent)]" />}
            />
            <p className="mt-3 text-sm text-[#4A4A4A] leading-relaxed">{draft.narrative}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <BudgetPill label="Google Ads" pct={draft.budgetSplit.googleAds} />
              <BudgetPill label="Meta" pct={draft.budgetSplit.meta} />
              <BudgetPill label="Organic" pct={draft.budgetSplit.organic} />
              <BudgetPill label="Other" pct={draft.budgetSplit.other} />
            </div>
            {draft.risks.length > 0 && (
              <ul className="mt-4 text-xs text-amber-800 bg-amber-50 rounded-lg p-3 space-y-1">
                {draft.risks.map((r) => (
                  <li key={r}>• {r}</li>
                ))}
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

          <Card padding="lg">
            <CardHeader title="Checklist" icon={<CheckSquare size={18} className="text-[var(--nts-accent)]" />} />
            <ul className="mt-3 space-y-2">
              {checklist.map((item) => (
                <li key={item.id} className="flex gap-2 rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm">
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
                    <p className="text-xs text-[#6B7280] mt-0.5">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      {savedQuery.data && savedQuery.data.length > 0 && (
        <Card padding="md">
          <p className="text-xs font-semibold uppercase text-[#9CA3AF] mb-2">Αποθηκευμένα plans</p>
          <ul className="text-sm text-[#4A4A4A] space-y-1">
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

function BudgetPill({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="rounded-lg bg-[#F9FAFB] border border-[#E5E7EB] px-3 py-2 text-center">
      <p className="text-[10px] text-[#9CA3AF] uppercase font-semibold">{label}</p>
      <p className="font-mono text-lg font-bold text-[#1A1A1A]">{pct}%</p>
    </div>
  );
}
