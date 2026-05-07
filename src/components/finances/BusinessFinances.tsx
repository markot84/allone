import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Euro, Trash2, TrendingUp, Building2, Megaphone, Leaf } from 'lucide-react';
import { Card, Button, Spinner, useToast, PageHeader } from '../common';
import { useOrganic } from '../../hooks/useOrganic';
import { useBrand } from '../../hooks/useBrand';
import { useCampaigns } from '../../hooks/useCampaigns';
import { usePeriodScopedCampaigns } from '../../hooks/usePeriodScopedCampaigns';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useEcommerceFullHistoryMetrics } from '../../hooks/useEcommerceFullHistoryMetrics';
import { useBusinessRevenueSummary } from '../../hooks/useBusinessRevenueSummary';
import { useProcurement } from '../../hooks/useProcurement';
import { useModules } from '../../hooks/useModules';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useDashPeriod } from '../../hooks/useDashPeriod';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { DateRangePicker } from '../ui/DateRangePicker';
import { MarketingCostLinesEditor } from '../channels/MarketingCostLinesEditor';
import {
  buildRoiTrendSeriesDaily,
  calculateCampaignMetrics,
  mergeGa4OrganicDailyWithChannelFallback,
  mergeOrganicByMonthWithGa4,
  sumDailyRevenueInPeriod,
} from '../../utils/roiUtils';
import { eachDateInclusive } from '../../utils/marketingCostPeriod';
import { getCostingReal12mTurnover } from '../../utils/procurement12mTurnover';
import { FirestoreService } from '../../services/firestore';
import { formatCurrency, formatCurrencyCompact } from '../../utils/format';
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
  const businessRevenue = useBusinessRevenueSummary();
  const procurementSheets = useProcurement();
  const { enabledModules } = useModules();
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

  const campaignMetrics = useMemo(
    () => calculateCampaignMetrics(periodCampaigns),
    [periodCampaigns]
  );

  const organicRevenueInPeriod = useMemo(() => {
    if (!periodFinanceSeries) return 0;
    return periodFinanceSeries.reduce((s, r) => s + r.organic, 0);
  }, [periodFinanceSeries]);

  const storeRevenueInPeriod = useMemo(
    () => sumDailyRevenueInPeriod(ecommRevenueByDayRecord, periodDates.fromDate, periodDates.toDate),
    [ecommRevenueByDayRecord, periodDates.fromDate, periodDates.toDate]
  );

  const hasEcommerceRevenue = enabledModules.ecommerce && ecomm.hasData;
  const costing12mFinance = useMemo(
    () => getCostingReal12mTurnover((procurementSheets.data.costing ?? []) as Record<string, unknown>[]),
    [procurementSheets.data.costing]
  );
  const erpRevenueByDayRecord = businessRevenue.revenueByDayRecord;
  const hasErpBusinessRevenue = businessRevenue.hasErpRevenueData;
  const procurementPeriodDays = useMemo(
    () => eachDateInclusive(periodDates.fromDate, periodDates.toDate).length,
    [periodDates.fromDate, periodDates.toDate]
  );
  const procurementRevenueInPeriod = useMemo(() => {
    if (!enabledModules.procurement || !costing12mFinance.hasColumn || costing12mFinance.sum <= 0) return 0;
    return (costing12mFinance.sum / 365) * procurementPeriodDays;
  }, [enabledModules.procurement, costing12mFinance.hasColumn, costing12mFinance.sum, procurementPeriodDays]);
  const erpRevenueInPeriod = useMemo(
    () => sumDailyRevenueInPeriod(erpRevenueByDayRecord, periodDates.fromDate, periodDates.toDate),
    [erpRevenueByDayRecord, periodDates.fromDate, periodDates.toDate]
  );
  const hasProcurementTurnoverEstimate = procurementRevenueInPeriod > 0;
  const dashboardTotalRevenueFinance = useMemo(() => {
    if (hasErpBusinessRevenue) return erpRevenueInPeriod;
    if (hasProcurementTurnoverEstimate) return procurementRevenueInPeriod;
    if (hasEcommerceRevenue) return storeRevenueInPeriod;
    return organicRevenueInPeriod + campaignMetrics.totalRevenue;
  }, [
    hasErpBusinessRevenue,
    erpRevenueInPeriod,
    hasProcurementTurnoverEstimate,
    procurementRevenueInPeriod,
    hasEcommerceRevenue,
    storeRevenueInPeriod,
    organicRevenueInPeriod,
    campaignMetrics.totalRevenue,
  ]);
  const dashboardRevenueSourceLabel = hasErpBusinessRevenue
    ? 'ERP'
    : hasProcurementTurnoverEstimate
      ? 'Κοστολόγηση · Πραγματικός τζίρος 12μ. (εκτίμηση περιόδου)'
      : hasEcommerceRevenue
        ? 'E-shop connectors'
        : 'Organic + καμπάνιες (εκτίμηση)';

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
      org = 0;
    for (const r of periodFinanceSeries) {
      eshopTotal += r.storeRevenue;
      org += r.organic;
    }
    const camp = campaignMetrics.totalRevenue;
    const other = eshopTotal - camp - org;
    return {
      eshopTotal: Math.round(eshopTotal),
      campaigns: Math.round(camp),
      organic: Math.round(org),
      other: Math.round(other),
    };
  }, [periodFinanceSeries, campaignMetrics.totalRevenue]);

  const queryClient = useQueryClient();
  const toast = useToast();
  const [isDeleting, setIsDeleting] = useState(false);

  const hasAnySignal =
    hasImported ||
    ecomm.hasData ||
    (campaigns?.length ?? 0) > 0 ||
    totalOrganicRevenue > 0 ||
    (ga4OrganicByDay && Object.keys(ga4OrganicByDay).length > 0) ||
    businessRevenue.hasErpRevenueData ||
    (enabledModules.procurement && costing12mFinance.hasColumn && costing12mFinance.sum > 0);

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
            Πλήρης εικόνα τζίρου για την επιλεγμένη περίοδο
          </p>
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="flex w-full flex-wrap gap-1 rounded-lg bg-gray-100 p-1 lg:w-auto">
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
              className="min-h-[36px] text-[#DC2626] hover:bg-[#FEE2E2]"
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

      <Card padding="lg" className="border-l-4 border-l-[var(--nts-accent)]">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--nts-accent)]/10">
              <TrendingUp size={24} className="text-[var(--nts-accent)]" />
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-sm font-semibold text-[#374151]">
                {hasErpBusinessRevenue
                  ? 'Συνολικός Τζίρος Επιχείρησης'
                  : 'Σύνολο Εσόδων (ίδιο KPI με το Dashboard)'}
              </p>
              <p className="text-3xl font-bold font-mono tabular-nums text-[#111827]">
                {formatCurrencyCompact(dashboardTotalRevenueFinance)}
              </p>
              {hasErpBusinessRevenue && (
                <p className="text-xs text-[#6B7280]">Φυσικά καταστήματα · B2B · online · όλα τα τιμολόγια ERP</p>
              )}
              <p className="text-sm text-[#6B7280]">
                Πηγή: <span className="font-medium text-[#374151]">{dashboardRevenueSourceLabel}</span>
              </p>
              {(hasErpBusinessRevenue && businessRevenue.isLoading) && (
                <p className="text-xs text-[#9CA3AF]">Φόρτωση δεδομένων ERP…</p>
              )}
              <p className="text-xs text-[#9CA3AF] leading-relaxed pt-1">
                {hasErpBusinessRevenue
                  ? 'Συνολικά παραστατικά ERP — περιλαμβάνει φυσικά καταστήματα, B2B και online πωλήσεις. Για ROAS και ανάλυση e-shop ανοίξτε το ROI & Απόδοση.'
                  : enabledModules.procurement
                    ? 'Προτεραιότητα: παραστατικά ERP · αλλιώς εκτίμηση Κοστολόγηση 12μ. (Enterprise) · αλλιώς e-shop · αλλιώς organic και καμπάνιες. Για ROAS ανοίξτε το ROI & Απόδοση.'
                    : 'Προτεραιότητα: παραστατικά ERP · αλλιώς τζίρος e-shop · αλλιώς εκτίμηση organic και καμπάνιες. Για ROAS ανοίξτε το ROI & Απόδοση.'
                }
              </p>
              <Button variant="secondary" size="sm" onClick={() => onSectionChange?.('dashboard')}>
                Άνοιγμα Dashboard
              </Button>
            </div>
          </div>
        </Card>

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

      {/* Τζίρος επιχείρησης (ευρύτερη εικόνα) — εμφανίζεται μόνο όταν ΔΕΝ υπάρχει ERP connector */}
      {!hasErpBusinessRevenue && <section className="space-y-3">
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
      </section>}

      {/* Τζίρος e-shop — ανάλυση */}
      {(ecomm.hasData || eshopTotals.campaigns > 0 || eshopTotals.organic > 0) && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-[#111827]">Τζίρος e-shop (ανάλυση περιόδου)</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
                  <p className="mt-1 text-[11px] text-[#9CA3AF]">Παραγγελίες στην επιλεγμένη περίοδο</p>
                </div>
              </div>
            </Card>

            <Card padding="md" className="border-l-4 border-l-[#EA580C] bg-gradient-to-br from-amber-50/50 to-white">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-amber-100">
                  <Megaphone size={20} className="text-amber-700" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-[#4A4A4A]">Έσοδα καμπανιών</p>
                  <p className="text-xl font-bold font-mono text-[#1A1A1A] tabular-nums">
                    {formatCurrencyCompact(eshopTotals.campaigns)}
                  </p>
                  <p className="mt-1 text-[11px] text-[#9CA3AF]">Conversion value Google Ads / Meta</p>
                </div>
              </div>
            </Card>

            <Card padding="md" className="border-l-4 border-l-[#22C55E] bg-gradient-to-br from-emerald-50/50 to-white">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-emerald-100">
                  <Leaf size={20} className="text-emerald-700" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-[#4A4A4A]">Organic revenue</p>
                  <p className="text-xl font-bold font-mono text-[#1A1A1A] tabular-nums">
                    {formatCurrencyCompact(eshopTotals.organic)}
                  </p>
                  <p className="mt-1 text-[11px] text-[#9CA3AF]">Import ή GA4 — ίδια λογική με ROI</p>
                </div>
              </div>
            </Card>
          </div>
        </section>
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
