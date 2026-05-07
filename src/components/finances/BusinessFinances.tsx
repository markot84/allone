import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Euro, Trash2, TrendingUp, Megaphone, Leaf } from 'lucide-react';
import { Card, Button, Spinner, useToast, PageHeader } from '../common';
import { PLCostEditor } from './PLCostEditor';
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
    updateCostCategories,
    isSavingCostCategories,
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

  // Period length in months (for P&L prorations)
  const periodMonths = useMemo(() => {
    if (!periodDates.fromDate || !periodDates.toDate) return 1;
    const from = new Date(periodDates.fromDate);
    const to = new Date(periodDates.toDate);
    const days = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(1 / 31, days / 30.44);
  }, [periodDates.fromDate, periodDates.toDate]);

  const plTotalMonthly = useMemo(
    () =>
      (activeStrategy?.costCategories ?? []).reduce(
        (sum, cat) => sum + cat.lines.reduce((s, l) => s + (l.amountEUR || 0), 0),
        0
      ),
    [activeStrategy?.costCategories]
  );

  const ebitda = dashboardTotalRevenueFinance - plTotalMonthly * periodMonths;

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

  const monthlyBudget = activeStrategy?.monthlyBudget || 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Οικονομικά Επιχείρησης</h2>}
        description={
          <p className="text-sm text-[#4A4A4A]">
            Πλήρης εικόνα τζίρου για την επιλεγμένη περίοδο
          </p>
        }
        actions={
          hasImported ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={handleDelete}
              disabled={isDeleting}
              className="min-h-[36px] text-[#DC2626] hover:bg-[#FEE2E2]"
            >
              {isDeleting ? 'Διαγραφή…' : 'Διαγραφή organic import'}
            </Button>
          ) : undefined
        }
      />

      {/* Period controls — ξεχωριστό bar για σωστό responsive */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-1 flex-wrap gap-1 rounded-lg bg-gray-100 p-1 sm:flex-none">
          {GLOBAL_PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setDashPeriod(opt.key)}
              className={`min-h-[32px] flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all sm:flex-none sm:px-3 ${
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
      </div>

      <p className="text-xs text-[#6B7280] sm:text-sm">
        <span className="font-medium text-[#374151]">Ενεργή περίοδος:</span>{' '}
        {formatPeriodDate(periodDates.fromDate)} — {formatPeriodDate(periodDates.toDate)}
        {hasImported ? ` · ${records.length} περίοδοι εισαγωγής organic` : ''}
        {organicRevenueSource === 'ga4' ? ' · GA4 organic' : ''}
      </p>

      {/* ── Revenue unified block ──────────────────────────────────────── */}
      <Card padding="none" className="overflow-hidden border border-slate-200 shadow-sm">
        {/* Main KPI row */}
        <div className="flex flex-col gap-4 bg-gradient-to-br from-[var(--nts-accent)]/5 to-white p-5 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--nts-accent)]/10">
            <TrendingUp size={26} className="text-[var(--nts-accent)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-[#9CA3AF]">
              {hasErpBusinessRevenue
                ? 'Συνολικός Τζίρος Επιχείρησης'
                : 'Σύνολο Εσόδων'}
            </p>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-3">
              <span className="text-4xl font-bold font-mono tabular-nums text-[#111827]">
                {formatCurrencyCompact(dashboardTotalRevenueFinance)}
              </span>
              {hasErpBusinessRevenue && businessRevenue.isLoading && (
                <span className="text-xs text-[#9CA3AF]">ανανέωση…</span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-[#374151]">
                Πηγή: {dashboardRevenueSourceLabel}
              </span>
              {hasErpBusinessRevenue && (
                <span className="text-xs text-[#6B7280]">Φυσικά καταστήματα · B2B · online</span>
              )}
            </div>
            <p className="mt-2 text-xs text-[#9CA3AF] leading-relaxed">
              {hasErpBusinessRevenue
                ? 'Συνολικά παραστατικά ERP — περιλαμβάνει όλα τα κανάλια. Για ROAS και ανάλυση e-shop → ROI & Απόδοση.'
                : enabledModules.procurement
                  ? 'Προτεραιότητα: ERP · Κοστολόγηση 12μ. · e-shop · organic/καμπάνιες. Για ROAS → ROI & Απόδοση.'
                  : 'Προτεραιότητα: ERP · e-shop · organic/καμπάνιες. Για ROAS → ROI & Απόδοση.'
              }
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="shrink-0 self-start"
            onClick={() => onSectionChange?.('dashboard')}
          >
            Dashboard ↗
          </Button>
        </div>

        {/* E-shop breakdown — only when data exists */}
        {(ecomm.hasData || eshopTotals.campaigns > 0 || eshopTotals.organic > 0) && (
          <>
            <div className="flex items-center gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                Ανάλυση e-shop περιόδου
              </span>
              {hasErpBusinessRevenue && (
                <span className="text-[11px] text-[#9CA3AF]">· περιλαμβάνεται στον ERP τζίρο</span>
              )}
            </div>
            <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {/* E-shop total */}
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 ring-1 ring-orange-100">
                  <Euro size={18} className="text-[var(--nts-accent)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-[#6B7280]">Σύνολο e-shop</p>
                  <p className="text-lg font-bold font-mono tabular-nums text-[#111827]">
                    {ecomm.hasData ? formatCurrencyCompact(eshopTotals.eshopTotal) : '—'}
                  </p>
                  <p className="text-[11px] text-[#9CA3AF]">Παραγγελίες περιόδου</p>
                </div>
              </div>
              {/* Campaigns */}
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 ring-1 ring-amber-100">
                  <Megaphone size={18} className="text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-[#6B7280]">Έσοδα καμπανιών</p>
                  <p className="text-lg font-bold font-mono tabular-nums text-[#111827]">
                    {formatCurrencyCompact(eshopTotals.campaigns)}
                  </p>
                  <p className="text-[11px] text-[#9CA3AF]">Google Ads / Meta conversion value</p>
                </div>
              </div>
              {/* Organic */}
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 ring-1 ring-emerald-100">
                  <Leaf size={18} className="text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-[#6B7280]">Organic revenue</p>
                  <p className="text-lg font-bold font-mono tabular-nums text-[#111827]">
                    {formatCurrencyCompact(eshopTotals.organic)}
                  </p>
                  <p className="text-[11px] text-[#9CA3AF]">Import ή GA4</p>
                </div>
              </div>
            </div>
          </>
        )}
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

      {/* ── Κόστη & P&L ───────────────────────────────────────────────── */}
      {activeStrategy && !activeStrategy.id.startsWith('default_') && (
        <section className="space-y-4">
          <PLCostEditor
            initialCategories={activeStrategy.costCategories}
            monthlyRevenue={periodMonths > 0 ? dashboardTotalRevenueFinance / periodMonths : 0}
            periodMonths={periodMonths}
            onSave={async (cats) => {
              await updateCostCategories(cats);
              toast.success('Αποθηκεύτηκαν τα κόστη P&L');
            }}
            isSaving={isSavingCostCategories}
          />

          {/* EBITDA card */}
          {plTotalMonthly > 0 && (
            <Card
              padding="md"
              className={`border-l-4 ${ebitda >= 0 ? 'border-l-emerald-500 bg-emerald-50/40' : 'border-l-red-400 bg-red-50/30'}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-[#374151]">EBITDA (εκτίμηση περιόδου)</p>
                  <p className="text-xs text-[#9CA3AF]">
                    Τζίρος − σύνολο κόστων P&L περιόδου
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-2xl font-bold font-mono tabular-nums ${ebitda >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                    {ebitda >= 0 ? '+' : ''}{formatCurrencyCompact(ebitda)}
                  </p>
                  {dashboardTotalRevenueFinance > 0 && (
                    <p className="text-xs text-[#9CA3AF]">
                      {((ebitda / dashboardTotalRevenueFinance) * 100).toFixed(1)}% margin
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-[#6B7280]">
                <span>Τζίρος: <span className="font-semibold text-[#374151] font-mono">{formatCurrencyCompact(dashboardTotalRevenueFinance)}</span></span>
                <span>Κόστη: <span className="font-semibold text-[#374151] font-mono">−{formatCurrencyCompact(plTotalMonthly * periodMonths)}</span></span>
              </div>
            </Card>
          )}
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
