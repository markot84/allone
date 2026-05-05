import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Euro, Trash2, TrendingUp, Calendar, Building2, Megaphone, Leaf, PieChart } from 'lucide-react';
import { Card, Button, Spinner, useToast, Tooltip, PageHeader } from '../common';
import { useOrganic } from '../../hooks/useOrganic';
import { useBrand } from '../../hooks/useBrand';
import { useCampaigns } from '../../hooks/useCampaigns';
import { usePeriodScopedCampaigns } from '../../hooks/usePeriodScopedCampaigns';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useEcommerceFullHistoryMetrics } from '../../hooks/useEcommerceFullHistoryMetrics';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useDashPeriod } from '../../hooks/useDashPeriod';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { DateRangePicker } from '../ui/DateRangePicker';
import { MarketingCostLinesEditor } from '../channels/MarketingCostLinesEditor';
import {
  buildRoiTrendSeriesDaily,
  mergeGa4OrganicDailyWithChannelFallback,
  mergeOrganicByMonthWithGa4,
} from '../../utils/roiUtils';
import { FirestoreService } from '../../services/firestore';
import { formatCurrency, formatCurrencyCompact, formatNumber } from '../../utils/format';
import type { OrganicRevenue, MarketingCostLine } from '../../types';

interface BusinessFinancesProps {
  onSectionChange?: (section: string) => void;
}

function formatPeriodDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function BusinessFinances({ onSectionChange }: BusinessFinancesProps = {}) {
  const { currentBrand } = useBrand();
  const {
    records,
    totalOrganicRevenue,
    byMonth: organicByMonth,
    hasImported,
    organicRevenueSource,
    isLoading,
  } = useOrganic();
  const { campaigns } = useCampaigns();
  const {
    organicRevenueByDay: ga4OrganicByDay,
    totalOrganicRevenueFromChannels,
    dateRange: ga4DateRange,
  } = useGA4Data();
  const ecomm = useEcommerceSummary();
  const ecommHist = useEcommerceFullHistoryMetrics({ mode: 'summary_only' });
  const {
    activeStrategy,
    updateMarketingCostLines,
    isSavingMarketingCostLines,
  } = useActiveStrategy();

  const { period: dashPeriod, setPeriod: setDashPeriod, periodDates } = useDashPeriod();
  const { customFrom, customTo, setCustomRange } = useGlobalDate();

  const periodCampaigns = usePeriodScopedCampaigns(campaigns, periodDates);

  const ga4OrganicEffective = useMemo(
    () =>
      mergeGa4OrganicDailyWithChannelFallback(
        ga4OrganicByDay,
        totalOrganicRevenueFromChannels,
        ga4DateRange ?? undefined,
        periodDates.fromDate,
        periodDates.toDate
      ),
    [
      ga4OrganicByDay,
      totalOrganicRevenueFromChannels,
      ga4DateRange?.start,
      ga4DateRange?.end,
      periodDates.fromDate,
      periodDates.toDate,
    ]
  );

  const mergedOrganicByMonth = useMemo(
    () => mergeOrganicByMonthWithGa4(organicByMonth, ga4OrganicEffective),
    [organicByMonth, ga4OrganicEffective]
  );

  const ecommRevenueByDayRecord = ecommHist.revenueByDayRecord;

  /** Ίδια λογική με Dashboard/ROI: ημερήσια σειρά για την επιλεγμένη περίοδο. */
  const periodFinanceSeries = useMemo(() => {
    const { fromDate, toDate } = periodDates;
    if (!fromDate || !toDate || fromDate > toDate) return null;
    return buildRoiTrendSeriesDaily(
      mergedOrganicByMonth,
      periodCampaigns,
      ecomm.hasData ? ecommRevenueByDayRecord : undefined,
      fromDate,
      toDate,
      ecomm.hasData,
      ga4OrganicEffective
    );
  }, [
    mergedOrganicByMonth,
    periodCampaigns,
    ecomm.hasData,
    ecommRevenueByDayRecord,
    periodDates.fromDate,
    periodDates.toDate,
    ga4OrganicEffective,
    ecommHist.source,
  ]);

  const eshopTotals = useMemo(() => {
    if (!periodFinanceSeries || periodFinanceSeries.length === 0) {
      return {
        eshopTotal: 0,
        campaigns: 0,
        organic: 0,
        other: 0,
      };
    }
    let eshopTotal = 0,
      camp = 0,
      org = 0;
    for (const r of periodFinanceSeries) {
      eshopTotal += r.storeRevenue;
      camp += r.campaigns;
      org += r.organic;
    }
    const other = eshopTotal - camp - org;
    return {
      eshopTotal: Math.round(eshopTotal),
      campaigns: Math.round(camp),
      organic: Math.round(org),
      other: Math.round(other),
    };
  }, [periodFinanceSeries]);

  const queryClient = useQueryClient();
  const toast = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  const hasAnySignal =
    hasImported ||
    ecomm.hasData ||
    (campaigns?.length ?? 0) > 0 ||
    totalOrganicRevenue > 0 ||
    (ga4OrganicByDay && Object.keys(ga4OrganicByDay).length > 0);

  const handleDelete = async () => {
    if (!currentBrand?.id) return;
    if (
      !window.confirm(
        `Διαγραφή όλων των οργανικών εσόδων (${records.length} εγγραφές) για το brand "${currentBrand.name}"; Αυτή η ενέργεια δεν αναιρείται.`
      )
    )
      return;
    setIsDeleting(true);
    try {
      await FirestoreService.deleteCollection('organic', currentBrand.id);
      queryClient.invalidateQueries({ queryKey: ['organic', currentBrand.id] });
      toast.success('Τα οργανικά έσοδα διαγράφηκαν επιτυχώς.');
    } catch (e) {
      toast.error(`Σφάλμα διαγραφής: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Spinner size="lg" label="Φόρτωση οικονομικών…" />
      </div>
    );
  }

  if (!hasAnySignal) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Οικονομικά Επιχείρησης</h2>}
          description={<p className="text-sm text-[#4A4A4A] sm:text-base">Τζίρος και οργανικά έσοδα (χωρίς campaigns)</p>}
        />
        <Card padding="lg" className="text-center py-12">
          <p className="text-[#4A4A4A] mb-4">Δεν υπάρχουν ακόμα δεδομένα (e-shop, campaigns ή οργανικά).</p>
          <p className="text-sm text-[#4A4A4A]">
            Συνδέστε κανάλια από τις Συνδέσεις ή εισάγετε οργανικό τζίρο από την{' '}
            <button
              type="button"
              onClick={() => onSectionChange?.('data-organic')}
              className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
            >
              καρτέλα οργανικών εσόδων
            </button>
            .
          </p>
        </Card>
      </div>
    );
  }

  const enterpriseExtra = currentBrand?.enterpriseTurnoverEUR;
  const monthlyBudget = activeStrategy?.monthlyBudget || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        toolbarAriaLabel="Περίοδος και δεδομένα"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Οικονομικά Επιχείρησης</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
            Πλήρης εικόνα τζίρου για την επιλεγμένη περίοδο — ευθυγραμμισμένη με το Dashboard (αλλάζει εδώ αν το
            επιθυμείτε).
          </p>
        }
        actions={
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
            <div className="flex w-full flex-wrap gap-1 rounded-lg bg-gray-100 p-1 sm:w-auto">
              {GLOBAL_PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setDashPeriod(opt.key)}
                  className={`min-h-[32px] flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all sm:flex-initial sm:px-3 ${
                    dashPeriod === opt.key
                      ? 'bg-white font-semibold text-[var(--nts-accent)] shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
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
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={handleDelete}
              disabled={isDeleting || !hasImported}
              className="min-h-[36px] w-full text-[#DC2626] hover:bg-[#FEE2E2] sm:w-auto"
            >
              {isDeleting ? 'Διαγραφή…' : 'Διαγραφή οργανικών import'}
            </Button>
          </div>
        }
      />

      <p className="text-xs text-[#6B7280] sm:text-sm">
        <span className="font-medium text-[#374151]">Ενεργή περίοδος:</span>{' '}
        {formatPeriodDate(periodDates.fromDate)} — {formatPeriodDate(periodDates.toDate)}
        {hasImported ? ` · ${records.length} περίοδοι εισαγωγής organic` : ''}
        {organicRevenueSource === 'ga4' ? ' · GA4 organic' : ''}
      </p>

      {activeStrategy && (
        <MarketingCostLinesEditor
          key={activeStrategy.id}
          initialLines={activeStrategy.marketingCostLines}
          monthlyBudget={monthlyBudget}
          disabled={activeStrategy.id.startsWith('default_')}
          isSaving={isSavingMarketingCostLines}
          onSave={async (lines: MarketingCostLine[]) => {
            await updateMarketingCostLines(lines);
            toast.success('Αποθηκεύτηκαν τα επιπλέον κόστη marketing');
          }}
        />
      )}

      {/* Τζίρος επιχείρησης (ευρύτερη εικόνα) */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[#111827]">Τζίρος επιχείρησης</h3>
        <Card
          padding="md"
          className="border border-dashed border-slate-200 bg-gradient-to-br from-slate-50/90 to-white"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80">
              <Building2 size={22} className="text-slate-600" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-medium text-[#1A1A1A]">Φυσικά καταστήματα · B2B · τιμολόγια εκτός e-shop</p>
              {typeof enterpriseExtra === 'number' && enterpriseExtra > 0 ? (
                <p className="text-2xl font-bold font-mono tabular-nums text-[#111827]">
                  {formatCurrencyCompact(enterpriseExtra)}
                </p>
              ) : (
                <p className="text-sm leading-relaxed text-[#6B7280]">
                  Δεν έχει καταχωρηθεί συμπληρωματικός τζίρος εκτός των συνδέσεων του Performance+. Όταν η πληροφορία
                  διατίθεται (π.χ. ERP), μπορεί να αποθηκευτεί στο brand και εμφανίζεται εδώ.
                </p>
              )}
            </div>
          </div>
        </Card>
      </section>

      {/* Τζίρος e-shop — ανάλυση */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-[#111827]">Τζίρος e-shop (ανάλυση περιόδου)</h3>
        <p className="text-xs text-[#6B7280]">
          Σύνολο από παραγγελίες (Magento κ.λπ.) · campaigns από Google Ads/Meta · organic από import ή GA4 ·           λοιπά =
          σύνολο − campaigns − organic (ενδέχεται αρνητική τιμή όταν τα ποσά από διαφορετικές πηγές επικαλύπτονται ή έχουν διαφορετικό ορισμό).
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card padding="md" className="border-l-4 border-l-[var(--nts-accent)] bg-gradient-to-br from-orange-50/60 to-white">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-orange-100">
                <Euro size={20} className="text-[var(--nts-accent)]" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-[#4A4A4A]">Σύνολο e-shop</p>
                <p className="text-xl font-bold font-mono text-[#1A1A1A] tabular-nums">
                  {ecomm.hasData ? formatCurrencyCompact(eshopTotals.eshopTotal) : '—'}
                </p>
                <p className="mt-1 text-[11px] text-[#9CA3AF]">Άθροισμα ημερήσιων παραγγελιών στην περίοδο</p>
              </div>
            </div>
          </Card>

          <Card padding="md" className="border-l-4 border-l-[#EA580C] bg-gradient-to-br from-amber-50/50 to-white">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-amber-100">
                <Megaphone size={20} className="text-amber-700" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-[#4A4A4A]">Έσοδα καμπανιών (πλατφόρμα)</p>
                <p className="text-xl font-bold font-mono text-[#1A1A1A] tabular-nums">
                  {formatCurrencyCompact(eshopTotals.campaigns)}
                </p>
                <p className="mt-1 text-[11px] text-[#9CA3AF]">Conversion value από διαφ. πλατφόρμες (ημερ. metrics)</p>
              </div>
            </div>
          </Card>

          <Card padding="md" className="border-l-4 border-l-[#22C55E] bg-gradient-to-br from-emerald-50/50 to-white">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-emerald-100">
                <Leaf size={20} className="text-emerald-700" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-sm text-[#4A4A4A]">Organic revenue</p>
                  <Tooltip
                    content="Μηνιαίο import (ισοκατανομή) ή ημερήσιο organic revenue από GA4, ίδια λογική με ROI."
                    size={12}
                  />
                </div>
                <p className="text-xl font-bold font-mono text-[#1A1A1A] tabular-nums">
                  {formatCurrencyCompact(eshopTotals.organic)}
                </p>
              </div>
            </div>
          </Card>

          <Card padding="md" className="border-l-4 border-l-[#6366F1] bg-gradient-to-br from-indigo-50/40 to-white">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-indigo-100">
                <PieChart size={20} className="text-indigo-600" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-sm text-[#4A4A4A]">Λοιπά / μη αντιστοιχισμένο</p>
                  <Tooltip
                    content="e-shop σύνολο μείον έσοδα καμπανιών (πλατφόρμα) μείον organic. Αρνητική τιμή = επικάλυψη μετρήσεων ή διαφορά ορισμών μεταξύ πηγών."
                    size={12}
                  />
                </div>
                <p
                  className={`text-xl font-bold font-mono tabular-nums ${
                    eshopTotals.other < 0 ? 'text-amber-800' : 'text-[#1A1A1A]'
                  }`}
                >
                  {formatCurrencyCompact(eshopTotals.other)}
                </p>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* Σύνοψη legacy: σύνολο organic import (όχι ανά ημέρα) + e-shop 90d */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card padding="md" className="border-l-4 border-l-[#22C55E]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#DCFCE7]">
              <Euro size={20} className="text-[#22C55E]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]">Σύνολο οργανικών (import / GA4, όλο το ιστορικό)</p>
              <p className="text-xl font-bold font-mono text-[#1A1A1A]">€{formatCurrency(totalOrganicRevenue, 0)}</p>
            </div>
          </div>
        </Card>
        <Card padding="md">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#F5F5F5]">
              <Calendar size={20} className="text-[#4A4A4A]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]">Περίοδοι import</p>
              <p className="text-xl font-bold font-mono text-[#1A1A1A]">{records.length}</p>
            </div>
          </div>
        </Card>
        <Card padding="md" className={ecomm.hasData ? 'border-l-4 border-l-[#10B981]' : ''}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#ECFDF5]">
              <Euro size={20} className="text-[#10B981]" />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <p className="text-sm text-[#4A4A4A]">e-shop (σύνοψη sync ~90ημ.)</p>
                <Tooltip
                  content="Από τη σύνοψη e-commerce — για σύγκριση με το σύνολο της επιλεγμένης περιόδου πάνω."
                  size={12}
                />
              </div>
              <p className="text-xl font-bold font-mono text-[#1A1A1A]">
                {ecomm.hasData ? `€${formatCurrency(ecomm.totalRevenue, 0)}` : '—'}
              </p>
              <p className="text-xs text-[#4A4A4A]">
                {ecomm.hasData ? `${formatNumber(ecomm.orderCount)} orders` : 'Χωρίς e-commerce sync'}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {ecomm.hasData && (
        <Card padding="md" className="bg-[#F9FAFB] border-[#E5E7EB]">
          <p className="text-sm text-[#4A4A4A]">
            Έλεγχος: e-shop στην <strong>επιλεγμένη περίοδο</strong> ={' '}
            <strong className="font-mono text-[#111827]">{formatCurrencyCompact(eshopTotals.eshopTotal)}</strong>
            {' · '}Λοιπά (ανάλυση) ={' '}
            <strong className="font-mono">{formatCurrencyCompact(eshopTotals.other)}</strong>
          </p>
        </Card>
      )}

      {records.length > 0 && (
        <Card padding="lg">
          <h3 className="font-semibold text-[#1A1A1A] mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-[var(--nts-accent)]" />
            Λεπτομέρειες organic ανά περίοδο (import)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-[#4A4A4A] border-b border-[#E5E5E5]">
                  <th className="pb-3 font-medium">Περίοδος</th>
                  <th className="pb-3 font-medium text-right">Οργανικά Έσοδα</th>
                </tr>
              </thead>
              <tbody>
                {([...records] as OrganicRevenue[])
                  .sort((a, b) => (b.period || '').localeCompare(a.period || ''))
                  .map((r) => (
                    <tr key={r.id} className="border-b border-[#E5E5E5] last:border-0 hover:bg-[#F5F5F5]">
                      <td className="py-3 font-medium text-[#1A1A1A]">{r.period}</td>
                      <td className="py-3 text-right font-mono">€{formatCurrency(r.organic_revenue || 0)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
