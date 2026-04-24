import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TrendingUp,
  Users,
  Target,
  BarChart3,
  ShoppingBag,
  ArrowRight,
  Megaphone,
  Building2,
  Globe2,
  Handshake,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { Card, CardHeader, KPICard, Tooltip, AlertsBanner, PageHeader } from '../common';
import { useSegments } from '../../hooks/useSegments';
import { useOrganic } from '../../hooks/useOrganic';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useProductSource } from '../../hooks/useProductSource';
import { useBrand } from '../../hooks/useBrand';
import { useProductAggregates } from '../../hooks/useAggregates';
import { usePeriodScopedCampaigns } from '../../hooks/usePeriodScopedCampaigns';
import { useTasks } from '../../hooks/useCoordination';
import { useDashPeriod } from '../../hooks/useDashPeriod';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { DateRangePicker } from '../ui/DateRangePicker';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useEcommerceFullHistoryMetrics } from '../../hooks/useEcommerceFullHistoryMetrics';
import { useModules } from '../../hooks/useModules';
import {
  calculateCampaignMetrics,
  getCampaignDateForMonth,
  getCampaignMonthlyAttributedValueInPeriod,
  getCampaignDailyAttributedValueInPeriod,
  getCampaignDailyAttributedSpendInPeriod,
  getCampaignDailyAttributedConversionsInPeriod,
  monthKeyFromDate,
  buildRoiTrendSeries,
  buildRoiTrendSeriesDaily,
  mergeOrganicByMonthWithGa4,
  mergeGa4OrganicDailyWithChannelFallback,
  sumDailyRevenueInPeriod,
  eachCalendarMonthInclusive,
  formatMonthKeyShort,
  formatTrendDayLabel,
} from '../../utils/roiUtils';
import { formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import type { Campaign } from '../../types';
import { generateInsightsFromData } from '../../services/insights';
import { useAutomationRunner } from '../../hooks/useAutomationRunner';
import { useAutomationAlerts } from '../../hooks/useAutomation';
import { MorningBriefing } from './MorningBriefing';
import { StrategyBriefingQuickStrip } from '../coordination/StrategyBriefingQuickStrip';
import { eachDateInclusive } from '../../utils/marketingCostPeriod';

/** Ημερήσια σημεία στο chart· πάνω από αυτό → μηνιαία σύνοψη (αναγνώσιμο άξονα). */
const REVENUE_CHART_MAX_DAILY_POINTS = 90;

/** Revenue Performance — κύριο chart τζίρου */
const REV_CHART_ESHOP = '#F97316';

const REV_PERF_LABEL_ESHOP = 'Τζίρος e-shop (παραγγελίες)';
const REV_PERF_LABEL_ESHOP_BLEND = 'Organic + καμπάνιες (εκτίμηση)';
/** Διαφήμιση — ξεχωριστό mini chart (όχι σύγκριση με τζίρο). */
const ADS_SPEND_COLOR = '#94A3B8';
const ADS_CONV_COLOR = '#2563EB';

/** Chart series values are full EUR; axis shows K when ≥ €1.000 (tooltip uses formatCurrencyCompact on same basis). */
function formatRevenueChartYAxisTick(value: number): string {
  const v = Number(value);
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1000) return `€${formatNumber(v / 1000, 1)}K`;
  return `€${formatNumber(v, 0)}`;
}

/** Το Recharts Area χρειάζεται ≥2 σημεία· αν υπάρχει 1 μήνας μόνο, διπλασιάζουμε για ορατή γραμμή. */
function padSparklineForChart(values: number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [values[0], values[0]];
  return values;
}

const ECOMM_TOP_PLATFORM_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  opencart: 'OpenCart',
  magento: 'Magento',
};

interface DashboardOverviewProps {
  /** Προαιρετικό `hashQuery` για deep link (π.χ. ειδοποιήσεις → `#products?stock=low`) */
  onSectionChange?: (section: string, opts?: { hashQuery?: string }) => void;
  onOpenInsights?: () => void;
}

export function DashboardOverview({ onSectionChange, onOpenInsights }: DashboardOverviewProps = {}) {
  const { currentBrand } = useBrand();
  const { isB2B, enabledModules } = useModules();
  const { segments: rfmSegments, hasImported: hasSegments } = useSegments();
  const { count: productsCount, products } = useProductSource();
  const { productStats } = useProductAggregates();
  const { suppliers } = useSuppliers();
  const { tasks } = useTasks();
  const { totalOrganicRevenue, byMonth: organicByMonth, hasOrganicRevenue: hasOrganic } = useOrganic();
  const { count: campaignsCount, campaigns, hasImported: hasCampaigns } = useCampaigns();
  const { activeStrategy, getStrategyName } = useActiveStrategy();
  useAutomationRunner();
  const ga4 = useGA4Data();
  const ecomm = useEcommerceSummary();
  const ecommHist = useEcommerceFullHistoryMetrics();
  const { alerts: automationAlerts } = useAutomationAlerts();

  const supplierTodMap = useMemo(() => {
    const m = new Map<string, number>();
    suppliers.forEach(s => m.set(s.name, s.tod));
    return m;
  }, [suppliers]);
  const hasAnyData = hasOrganic || hasSegments || productsCount > 0 || hasCampaigns;
  
  const campaignsTyped = (campaigns ?? []) as Campaign[];

  const { period: dashPeriod, setPeriod: setDashPeriod, periodDates } = useDashPeriod();
  const { customFrom, customTo, setCustomRange } = useGlobalDate();

  const periodCampaigns = usePeriodScopedCampaigns(campaignsTyped, periodDates);

  const campaignMetrics = useMemo(() => calculateCampaignMetrics(periodCampaigns), [periodCampaigns]);

  const ga4OrganicEffective = useMemo(
    () =>
      mergeGa4OrganicDailyWithChannelFallback(
        ga4.organicRevenueByDay,
        ga4.totalOrganicRevenueFromChannels,
        ga4.dateRange ?? undefined,
        periodDates.fromDate,
        periodDates.toDate
      ),
    [
      ga4.organicRevenueByDay,
      ga4.totalOrganicRevenueFromChannels,
      ga4.dateRange?.start,
      ga4.dateRange?.end,
      periodDates.fromDate,
      periodDates.toDate,
    ]
  );

  const mergedOrganicByMonth = useMemo(
    () => mergeOrganicByMonthWithGa4(organicByMonth, ga4OrganicEffective),
    [organicByMonth, ga4OrganicEffective]
  );

  const organicRevenueInPeriod = useMemo(() => {
    const rows = buildRoiTrendSeriesDaily(
      mergedOrganicByMonth,
      [],
      undefined,
      periodDates.fromDate,
      periodDates.toDate,
      false,
      ga4OrganicEffective
    );
    return rows.reduce((s, r) => s + r.organic, 0);
  }, [mergedOrganicByMonth, ga4OrganicEffective, periodDates.fromDate, periodDates.toDate]);

  const ecommRevenueByDayRecord = ecommHist.revenueByDayRecord;

  const storeRevenueInPeriod = useMemo(
    () => sumDailyRevenueInPeriod(ecommRevenueByDayRecord, periodDates.fromDate, periodDates.toDate),
    [ecommRevenueByDayRecord, periodDates.fromDate, periodDates.toDate]
  );

  // Πραγματικός αριθμός παραγγελιών στην περίοδο — full-history raw όταν φορτώσει (summary ~90d).
  const ordersInPeriod = useMemo(
    () =>
      ecommHist.ordersByDay
        .filter((d) => d.date >= periodDates.fromDate && d.date <= periodDates.toDate)
        .reduce((sum, d) => sum + d.orders, 0),
    [ecommHist.ordersByDay, periodDates.fromDate, periodDates.toDate]
  );

  /** AOV από πραγματικά e-shop data (revenue/orders της περιόδου). Αξιόπιστο, χωρίς ad-platform double-counting. */
  const eshopAovInPeriod = useMemo(
    () => (ordersInPeriod > 0 ? storeRevenueInPeriod / ordersInPeriod : 0),
    [storeRevenueInPeriod, ordersInPeriod]
  );

  const ecommTopPlatformDisplay = useMemo(() => {
    const t = ecommHist.getTopPlatformInRange(periodDates.fromDate, periodDates.toDate);
    if (t) return ECOMM_TOP_PLATFORM_LABELS[t.platform] || t.platform;
    const p0 = ecomm.platformBreakdown[0];
    return p0 ? ECOMM_TOP_PLATFORM_LABELS[p0.platform] || p0.platform : '—';
  }, [
    ecommHist,
    ecomm.platformBreakdown,
    periodDates.fromDate,
    periodDates.toDate,
  ]);

  // GA4 totals για την επιλεγμένη περίοδο (αντί για 90ήμερα totals).
  const ga4TotalsInPeriod = useMemo(() => {
    const days = ga4.dailyEntries.filter(
      (d) => d.date >= periodDates.fromDate && d.date <= periodDates.toDate
    );
    if (days.length === 0) {
      return { sessions: 0, users: 0, newUsers: 0, conversions: 0, bounceRate: 0, hasData: false };
    }
    const sum = days.reduce(
      (acc, d) => ({
        sessions: acc.sessions + d.sessions,
        users: acc.users + d.totalUsers,
        newUsers: acc.newUsers + d.newUsers,
        conversions: acc.conversions + d.conversions,
        bounceRate: acc.bounceRate + d.bounceRate,
      }),
      { sessions: 0, users: 0, newUsers: 0, conversions: 0, bounceRate: 0 }
    );
    return {
      sessions: sum.sessions,
      users: sum.users,
      newUsers: sum.newUsers,
      conversions: sum.conversions,
      bounceRate: sum.bounceRate / days.length,
      hasData: true,
    };
  }, [ga4.dailyEntries, periodDates.fromDate, periodDates.toDate]);

  const dashboardTotalRevenue = useMemo(
    () => organicRevenueInPeriod + campaignMetrics.totalRevenue,
    [organicRevenueInPeriod, campaignMetrics.totalRevenue]
  );
  const inventoryValueEstimate = productStats?.totalInventoryValue ?? 0;
  const openCommercialTasks = useMemo(
    () => tasks.filter((task) => task.status === 'pending' || task.status === 'in_progress').length,
    [tasks]
  );
  const b2bReadinessScore = useMemo(() => {
    const checks = [
      productsCount > 0,
      suppliers.length > 0,
      campaignsCount > 0,
      ga4.hasData,
      Boolean(currentBrand?.enterpriseTurnoverEUR || totalOrganicRevenue > 0),
      openCommercialTasks > 0,
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [campaignsCount, currentBrand?.enterpriseTurnoverEUR, ga4.hasData, openCommercialTasks, productsCount, suppliers.length, totalOrganicRevenue]);

  /**
   * Κύριο chart — μία σειρά τζίρου:
   * - Με e-shop: `ecommerce_summary.revenueByDay` (server-side aggregate μετά το sync).
   * - Χωρίς e-shop: εκτίμηση organic + conversion value καμπανιών (ίδια λογική efficiency / attributed revenue).
   * Η απόδοση διαφημίσεων (δαπάνη vs conversion value) είναι στο ξεχωριστό block από κάτω.
   */
  const revenueChartData = useMemo(() => {
    const { fromDate, toDate } = periodDates;
    const dayCount = eachDateInclusive(fromDate, toDate).length;
    if (dayCount === 0) return [];

    const useEshopTotals = enabledModules.ecommerce && ecomm.hasData;

    if (dayCount <= REVENUE_CHART_MAX_DAILY_POINTS) {
      const dailyRows = buildRoiTrendSeriesDaily(
        mergedOrganicByMonth,
        periodCampaigns as Campaign[],
        useEshopTotals ? ecommRevenueByDayRecord : undefined,
        fromDate,
        toDate,
        useEshopTotals,
        ga4OrganicEffective
      );
      return dailyRows.map((r) => {
        const total = useEshopTotals ? r.storeRevenue : r.organic + r.campaigns;
        return {
          month: r.label,
          total,
        };
      });
    }

    const fromYm = fromDate.slice(0, 7);
    const toYm = toDate.slice(0, 7);
    const rows = buildRoiTrendSeries(
      mergedOrganicByMonth,
      periodCampaigns as Campaign[],
      useEshopTotals ? ecommHist.monthlyRevenue : [],
      fromYm,
      toYm,
      useEshopTotals,
      {
        periodClip: { fromDate, toDate },
      }
    );
    return rows.map((r) => {
      const total = useEshopTotals ? r.storeRevenue : r.organic + r.campaigns;
      return {
        month: r.month,
        total,
      };
    });
  }, [
    mergedOrganicByMonth,
    periodCampaigns,
    periodDates,
    ga4OrganicEffective,
    enabledModules.ecommerce,
    ecomm.hasData,
    ecommHist.monthlyRevenue,
    ecommRevenueByDayRecord,
  ]);

  /** Ημερήσια ή μηνιαία σειρά για mini chart διαφήμισης (δαπάνη + conversion value από synced campaigns). */
  const adsPerformanceSeries = useMemo(() => {
    if (!hasCampaigns || periodCampaigns.length === 0) return [];
    const { fromDate, toDate } = periodDates;
    const dayList = eachDateInclusive(fromDate, toDate);
    if (dayList.length === 0) return [];

    const spendByDay: Record<string, number> = {};
    const valByDay: Record<string, number> = {};
    (periodCampaigns as Campaign[]).forEach((c) => {
      getCampaignDailyAttributedSpendInPeriod(c, fromDate, toDate).forEach((v, d) => {
        spendByDay[d] = (spendByDay[d] || 0) + v;
      });
      getCampaignDailyAttributedValueInPeriod(c, fromDate, toDate).forEach((v, d) => {
        valByDay[d] = (valByDay[d] || 0) + v;
      });
    });

    if (dayList.length <= REVENUE_CHART_MAX_DAILY_POINTS) {
      return dayList.map((day) => ({
        label: formatTrendDayLabel(day),
        adSpend: Math.round((spendByDay[day] || 0) * 100) / 100,
        adConvValue: Math.round((valByDay[day] || 0) * 100) / 100,
      }));
    }

    const byMonth = new Map<string, { adSpend: number; adConvValue: number }>();
    for (const ym of eachCalendarMonthInclusive(fromDate.slice(0, 7), toDate.slice(0, 7))) {
      byMonth.set(ym, { adSpend: 0, adConvValue: 0 });
    }
    for (const day of dayList) {
      const ym = day.slice(0, 7);
      const ex = byMonth.get(ym);
      if (!ex) continue;
      ex.adSpend += spendByDay[day] || 0;
      ex.adConvValue += valByDay[day] || 0;
    }
    return [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([ym, v]) => ({
        label: formatMonthKeyShort(ym),
        adSpend: Math.round(v.adSpend * 100) / 100,
        adConvValue: Math.round(v.adConvValue * 100) / 100,
      }));
  }, [hasCampaigns, periodCampaigns, periodDates]);

  // Debug logging
  useEffect(() => {
    if (import.meta.env.MODE === 'development') {
      console.debug('[Dashboard] Organic revenue:', totalOrganicRevenue, 'hasOrganic:', hasOrganic);
    }
  }, [totalOrganicRevenue, hasOrganic]);
  const aiInsights = useMemo(() => {
    return generateInsightsFromData(products, rfmSegments, supplierTodMap, {
      hasData: enabledModules.ecommerce && ecomm.hasData,
      totalRevenue: ecomm.totalRevenue,
      orderCount: ecomm.orderCount,
      aov: ecomm.aov,
      platformBreakdown: ecomm.platformBreakdown,
    });
  }, [products, rfmSegments, supplierTodMap, enabledModules.ecommerce, ecomm.hasData, ecomm.totalRevenue, ecomm.orderCount, ecomm.aov, ecomm.platformBreakdown]);

  // Handle insight action clicks
  const handleInsightAction = (insight: { action: string; title: string }) => {
    const action = insight.action.toLowerCase();
    
    // Map actions to navigation
    if (action.includes('campaign') || action.includes('win-back') || action.includes('στόχευση')) {
      onSectionChange?.('channels');
    } else if (action.includes('inventory') || action.includes('αναπλήρωση') || action.includes('ελέγξτε')) {
      onSectionChange?.('products');
    } else if (action.includes('sequence') || action.includes('setup')) {
      onSectionChange?.('strategy');
    } else {
      // Default: open AI Insights panel or navigate to relevant section
      onSectionChange?.('insights');
    }
  };
  const revenueContainerRef = useRef<HTMLDivElement>(null);
  const segmentContainerRef = useRef<HTMLDivElement>(null);
  const [chartDimensions, setChartDimensions] = useState({ revenue: { width: 800, height: 288 }, segment: { width: 400, height: 224 } });

  useEffect(() => {
    const updateDimensions = () => {
      if (revenueContainerRef.current) {
        const width = revenueContainerRef.current.offsetWidth || 800;
        setChartDimensions(prev => ({
          ...prev,
          revenue: { width: Math.max(width, 400), height: 288 }
        }));
      }
      if (segmentContainerRef.current) {
        const width = segmentContainerRef.current.offsetWidth || 400;
        setChartDimensions(prev => ({
          ...prev,
          segment: { width: Math.max(width, 300), height: 224 }
        }));
      }
    };

    updateDimensions();
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (revenueContainerRef.current) resizeObserver.observe(revenueContainerRef.current);
    if (segmentContainerRef.current) resizeObserver.observe(segmentContainerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader
        title={<h2 className="text-xl font-bold tracking-tight text-[var(--nts-charcoal)] sm:text-2xl">{isB2B ? 'Owner Dashboard' : 'Dashboard'}</h2>}
        description={
          <p className="text-[14px] text-[var(--nts-medium-gray)]">
            {isB2B ? (
              <>
                Αποθέματα, δίκτυο προμηθευτών, εμπορική εκτέλεση και ετοιμότητα ανάπτυξης σε ενιαία διοικητική εικόνα.
                {activeStrategy && (
                  <>
                    {' '}Ενεργή κατεύθυνση:{' '}
                    <span className="font-medium text-[var(--nts-charcoal)]">{getStrategyName(activeStrategy.scenarioId)}</span>
                  </>
                )}
              </>
            ) : activeStrategy ? (
              <>
                Στρατηγική:{' '}
                <span className="font-medium text-[var(--nts-charcoal)]">{getStrategyName(activeStrategy.scenarioId)}</span>
              </>
            ) : (
              'Καλώς ήρθατε στο Performance+'
            )}
            {activeStrategy?.approvalStatus === 'implementing' && (
              <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-green-700">
                ενεργή
              </span>
            )}
          </p>
        }
      />

      {/* Automation Alerts */}
      <AlertsBanner maxAlerts={3} onNavigate={onSectionChange} />

      {/* Quick briefing — πάντα με brand, και χωρίς ενεργή στρατηγική */}
      {currentBrand && (
        <StrategyBriefingQuickStrip
          hasActiveStrategy={!!activeStrategy}
          strategyDisplayName={
            activeStrategy ? getStrategyName(activeStrategy.scenarioId) : 'Εμπορική πολιτική'
          }
        />
      )}

      {/* Morning Briefing */}
      {currentBrand && (
        <MorningBriefing
          brandId={currentBrand.id}
          brandName={currentBrand.name}
          products={products}
          campaigns={periodCampaigns}
          segments={rfmSegments}
          totalOrganicRevenue={organicRevenueInPeriod}
          ga4={{
            totals: ga4.totals,
            weeklyChange: ga4.weeklyChange,
            hasData: ga4.hasData,
          }}
          alerts={automationAlerts}
          supplierTodMap={supplierTodMap}
          ecommerce={{
            hasData: enabledModules.ecommerce && ecomm.hasData,
            totalRevenue: storeRevenueInPeriod,
            orderCount: ordersInPeriod,
            aov: ordersInPeriod > 0 ? storeRevenueInPeriod / ordersInPeriod : ecomm.aov,
            connectedPlatforms: ecomm.connectedPlatforms,
            platformBreakdown: ecomm.platformBreakdown,
          }}
          onSectionChange={onSectionChange}
          hasAnyData={hasAnyData}
          period={dashPeriod}
          periodLabel={dashPeriod === 'custom' ? `${periodDates.fromDate} — ${periodDates.toDate}` : (GLOBAL_PERIOD_OPTIONS.find(o => o.key === dashPeriod)?.label ?? 'Τρέχων Μήνας')}
        />
      )}

      {/* Global period selector — applies to all pages as default */}
      {(hasOrganic || hasCampaigns) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
            {GLOBAL_PERIOD_OPTIONS.map(opt => (
              <button
                key={opt.key}
                onClick={() => setDashPeriod(opt.key)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  dashPeriod === opt.key
                    ? 'bg-white text-[var(--nts-orange)] shadow-sm font-semibold'
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
      )}

      {isB2B && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <KPICard
            index={0}
            kpi={{
              label: 'Inventory value',
              value: inventoryValueEstimate > 0 ? formatCurrencyCompact(inventoryValueEstimate) : 'Σε αναμονή',
              changeLabel: `${formatNumber(productsCount || productStats?.totalSkus || 0)} SKUs`,
              tooltip: 'Εκτιμώμενη αξία αποθέματος από τα διαθέσιμα aggregates, για γρήγορη συνοπτική εικόνα.',
            }}
            onClick={() => onSectionChange?.('products')}
          />
          <KPICard
            index={1}
            kpi={{
              label: 'Supplier network',
              value: `${suppliers.length}`,
              changeLabel: suppliers.length > 0 ? 'ενεργοί κόμβοι προμήθειας' : 'απαιτεί αρχική ρύθμιση',
              tooltip: 'Το δίκτυο προμηθευτών επηρεάζει χρόνους παράδοσης, αναπλήρωση αποθέματος και δυνατότητα ανάπτυξης.',
            }}
            onClick={() => onSectionChange?.('suppliers')}
          />
          <KPICard
            index={2}
            kpi={{
              label: 'Sales execution',
              value: `${openCommercialTasks}`,
              changeLabel: 'ανοικτές ενέργειες',
              tooltip: 'Ανοικτές ενέργειες συντονισμού που λειτουργούν ως ουρά εκτέλεσης για την εμπορική ομάδα.',
            }}
            onClick={() => onSectionChange?.('sales')}
          />
          <KPICard
            index={3}
            kpi={{
              label: 'Expansion readiness',
              value: `${b2bReadinessScore}%`,
              changeLabel: 'ετοιμότητα αγοράς',
              tooltip: 'Συνδυαστική ένδειξη που αποτυπώνει assortment, προμηθευτές, οικονομική βάση, καμπάνιες και οργανωτική ετοιμότητα.',
            }}
            onClick={() => onSectionChange?.('markets')}
          />
        </div>
      )}

      {/* KPI Cards — Financial Overview */}
      {(hasOrganic || hasCampaigns) && (() => {
        const sortMonthKeys = (entries: [string, any][]) =>
          entries
            .filter(([k]) => k !== 'Other' && /^\d{4}-\d{2}$/.test(k))
            .sort((a, b) => a[0].localeCompare(b[0]));

        const revenueByMonth: Record<string, number> = {};
        const spendByMonth: Record<string, number> = {};
        const convsValueByMonth: Record<string, number> = {};
        const convsByMonth: Record<string, number> = {};

        const kFromYm = periodDates.fromDate.slice(0, 7);
        const kToYm = periodDates.toDate.slice(0, 7);
        organicByMonth.forEach((v, ym) => {
          if (ym < kFromYm || ym > kToYm) return;
          revenueByMonth[ym] = (revenueByMonth[ym] || 0) + v;
        });
        periodCampaigns.forEach((c) => {
          for (const [ym, val] of getCampaignMonthlyAttributedValueInPeriod(c, periodDates.fromDate, periodDates.toDate)) {
            revenueByMonth[ym] = (revenueByMonth[ym] || 0) + val;
            convsValueByMonth[ym] = (convsValueByMonth[ym] || 0) + val;
          }
          const d = getCampaignDateForMonth(c);
          const ymSpend = d ? monthKeyFromDate(d) : null;
          if (ymSpend) {
            spendByMonth[ymSpend] = (spendByMonth[ymSpend] || 0) + (c.amount_spent || 0);
            convsByMonth[ymSpend] = (convsByMonth[ymSpend] || 0) + (c.conversions || 0);
          }
        });

        const calcMoM = (byMonth: Record<string, number>) => {
          const sorted = sortMonthKeys(Object.entries(byMonth));
          if (sorted.length < 2) return null;
          const prev = sorted[sorted.length - 2][1];
          const curr = sorted[sorted.length - 1][1];
          return prev > 0 ? ((curr - prev) / prev) * 100 : null;
        };

        const revenueMoM = calcMoM(revenueByMonth);
        const spendMoM = calcMoM(spendByMonth);

        const sortedConvVal = sortMonthKeys(Object.entries(convsValueByMonth));
        const sortedConvs = sortMonthKeys(Object.entries(convsByMonth));

        // AOV ΠΡΟΤΕΡΑΙΟΤΗΤΑ: πραγματικά e-shop data (revenue/orders της περιόδου). Αυτό αποφεύγει
        // το double-counting των ad platforms (Google Ads + Meta συχνά μετρούν την ίδια μετατροπή).
        // Fallback: campaign-attributed value/conversions μόνο όταν δεν υπάρχει e-shop σύνδεση.
        const hasEshop = enabledModules.ecommerce && ecomm.hasData && ordersInPeriod > 0;
        const aov = hasEshop
          ? eshopAovInPeriod
          : campaignMetrics.totalConversions > 0
            ? campaignMetrics.totalRevenue / campaignMetrics.totalConversions
            : 0;
        const prevAov = sortedConvs.length >= 2 && sortedConvs[sortedConvs.length - 2][1] > 0
          ? (sortedConvVal.length >= 2 ? sortedConvVal[sortedConvVal.length - 2][1] : 0) / sortedConvs[sortedConvs.length - 2][1]
          : 0;
        const currAov = sortedConvs.length >= 1 && sortedConvs[sortedConvs.length - 1][1] > 0
          ? (sortedConvVal.length >= 1 ? sortedConvVal[sortedConvVal.length - 1][1] : 0) / sortedConvs[sortedConvs.length - 1][1]
          : 0;
        const aovMoM = prevAov > 0 ? ((currAov - prevAov) / prevAov) * 100 : null;

        const { fromDate: kFrom, toDate: kTo } = periodDates;
        const dayList = eachDateInclusive(kFrom, kTo);

        const dailyTrendKpi = buildRoiTrendSeriesDaily(
          mergedOrganicByMonth,
          periodCampaigns as Campaign[],
          undefined,
          kFrom,
          kTo,
          false,
          ga4OrganicEffective
        );
        const revenueSpark = padSparklineForChart(dailyTrendKpi.map((r) => (r.organic + r.campaigns) / 1000));

        const spendByDay: Record<string, number> = {};
        periodCampaigns.forEach((c) => {
          getCampaignDailyAttributedSpendInPeriod(c, kFrom, kTo).forEach((v, d) => {
            spendByDay[d] = (spendByDay[d] || 0) + v;
          });
        });
        const spendSpark = padSparklineForChart(dayList.map((d) => (spendByDay[d] || 0) / 1000));

        const valByDay: Record<string, number> = {};
        const convByDay: Record<string, number> = {};
        periodCampaigns.forEach((c) => {
          getCampaignDailyAttributedValueInPeriod(c, kFrom, kTo).forEach((v, d) => {
            valByDay[d] = (valByDay[d] || 0) + v;
          });
          getCampaignDailyAttributedConversionsInPeriod(c, kFrom, kTo).forEach((v, d) => {
            convByDay[d] = (convByDay[d] || 0) + v;
          });
        });
        const aovSpark = padSparklineForChart(
          dayList.map((d) => {
            const conv = convByDay[d] || 0;
            const val = valByDay[d] || 0;
            return conv > 0 ? val / conv : 0;
          })
        );

        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
              <KPICard
                kpi={{
                  label: isB2B ? 'Revenue baseline' : 'Σύνολο Εσόδων',
                  value: formatCurrencyCompact(dashboardTotalRevenue),
                  change: revenueMoM !== null ? Math.round(revenueMoM) : undefined,
                  changeLabel: revenueMoM !== null ? 'vs προηγ. μήνα' : undefined,
                  trend: revenueMoM !== null ? (revenueMoM >= 0 ? 'up' : 'down') : 'up',
                  sparklineData: revenueSpark,
                  tooltip:
                    isB2B
                      ? 'Βασική εικόνα εσόδων από οργανική ζήτηση και demand generation. Για πλήρη αποτύπωση εσόδων ανά account απαιτείται invoicing ή ERP import.'
                      : 'Συνολικά έσοδα όπως αποτυπώνονται από organic δεδομένα και conversion value των διαφημιστικών πλατφορμών. Δεν πρόκειται για ταμειακό τζίρο e-shop.',
                }}
                index={0}
                onClick={() => onSectionChange?.(isB2B ? 'finances' : 'roi')}
              />
              <KPICard
                kpi={{
                  label: isB2B ? 'Demand spend' : 'Δαπάνη διαφημίσεων',
                  value: hasCampaigns ? formatCurrencyCompact(campaignMetrics.totalSpend) : '€0',
                  change: spendMoM !== null ? Math.round(spendMoM) : undefined,
                  changeLabel: spendMoM !== null ? 'vs προηγ. μήνα' : hasCampaigns && campaignMetrics.cpa > 0 ? `CPA €${formatNumber(campaignMetrics.cpa, 1)}` : undefined,
                  trend: spendMoM !== null ? (spendMoM >= 0 ? 'up' : 'down') : hasCampaigns ? 'up' : undefined,
                  sparklineData: spendSpark,
                  tooltip: isB2B ? 'Spend για market validation και demand generation σε Google Ads / Meta.' : 'Συνολικό κόστος διαφήμισης σε Google Ads και Meta. CPA = Κόστος ανά μετατροπή.',
                }}
                index={1}
                onClick={() => onSectionChange?.('campaigns')}
              />
              <KPICard
                kpi={{
                  label: isB2B ? 'Demand conversions' : 'Μέσο Καλάθι (AOV)',
                  value: isB2B ? formatNumber(campaignMetrics.totalConversions) : aov > 0 ? `€${formatNumber(aov, 1)}` : '—',
                  change: isB2B ? undefined : aovMoM !== null ? Math.round(aovMoM) : undefined,
                  changeLabel: isB2B ? 'ενέργειες υψηλής πρόθεσης' : aovMoM !== null ? 'vs προηγ. μήνα' : undefined,
                  trend: isB2B ? (campaignMetrics.totalConversions > 0 ? 'up' : undefined) : aov > 0 ? (aovMoM !== null && aovMoM < 0 ? 'down' : 'up') : undefined,
                  sparklineData: isB2B ? spendSpark : aovSpark,
                  tooltip: isB2B
                    ? 'Μετατροπές ή ενέργειες υψηλής πρόθεσης από τα demand channels, έως ότου ενεργοποιηθεί πλήρης παρακολούθηση pipeline.'
                    : hasEshop
                      ? 'Average Order Value από πραγματικές παραγγελίες e-shop στην επιλεγμένη περίοδο: e-shop revenue / αριθμός παραγγελιών.'
                      : 'Average Order Value από διαφημιστικές καμπάνιες (conversion value / conversions). Συνδέστε e-shop για ακριβές AOV χωρίς double-counting μεταξύ Google Ads & Meta.',
                }}
                index={2}
                onClick={() => onSectionChange?.(isB2B ? 'sales' : 'campaigns')}
              />
            </div>
            <p className="text-[12px] text-[#6B7280] leading-relaxed">
              {isB2B ? 'Για αναλυτικότερη οικονομική εικόνα, baseline revenue και πρόσθετα B2B data feeds, άνοιξε ' : <>Για <strong className="text-[#4B5563] font-medium">Campaign ROI</strong>,{' '}
              <strong className="text-[#4B5563] font-medium">e-shop ROI</strong>, Platform ROAS και σύγκριση εσόδων με το e-shop, ανοίξτε </>}
              <button
                type="button"
                onClick={() => onSectionChange?.(isB2B ? 'finances' : 'roi')}
                className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
              >
                {isB2B ? 'Finances' : 'ROI & Απόδοση'}
              </button>
              {!isB2B && '.'}
            </p>
          </div>
        );
      })()}

      {/* E-commerce Summary */}
      {enabledModules.ecommerce && ecomm.hasData && (
        <Card hover onClick={() => onSectionChange?.('ecommerce')}>
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[var(--nts-accent)]/10 flex items-center justify-center">
                  <ShoppingBag size={16} className="text-[var(--nts-accent)]" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-[#1A1A1A]">E-commerce</h4>
                  <span className="text-[10px] text-[#9CA3AF]">
                    {ecomm.connectedPlatforms.length} πλατφόρμες · επιλεγμένη περίοδος
                  </span>
                </div>
              </div>
              <ArrowRight size={16} className="text-[#D1D5DB] group-hover:text-[var(--nts-accent)] transition-colors" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <p className="text-[11px] text-[#6B7280]">e-shop Revenue</p>
                  <Tooltip content="Πραγματικά έσοδα e-shop από τις συνδεδεμένες πλατφόρμες για την επιλεγμένη περίοδο." size={12} />
                </div>
                <p className="text-lg font-bold text-[#1A1A1A]">{formatCurrencyCompact(storeRevenueInPeriod)}</p>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <p className="text-[11px] text-[#6B7280]">Παραγγελίες</p>
                  <Tooltip content="Παραγγελίες από Shopify/WooCommerce/OpenCart/Magento για την επιλεγμένη περίοδο (εξαιρούνται cancelled)." size={12} />
                </div>
                <p className="text-lg font-bold text-[#1A1A1A]">{formatNumber(ordersInPeriod)}</p>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <p className="text-[11px] text-[#6B7280]">AOV</p>
                  <Tooltip content="Average Order Value: e-shop Revenue / Παραγγελίες της επιλεγμένης περιόδου." size={12} />
                </div>
                <p className="text-lg font-bold text-[#1A1A1A]">{formatCurrencyCompact(eshopAovInPeriod)}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#6B7280] mb-0.5">Top Platform</p>
                <p className="text-lg font-bold text-[#1A1A1A]">{ecommTopPlatformDisplay}</p>
              </div>
              {/* Mini sparkline — φιλτραρισμένο για την επιλεγμένη περίοδο */}
              {(() => {
                const periodDaily = ecommHist.dailyRevenueRows.filter(
                  (d) => d.date >= periodDates.fromDate && d.date <= periodDates.toDate
                );
                if (periodDaily.length <= 1) return null;
                return (
                <div className="hidden md:block">
                  <ResponsiveContainer width="100%" height={40}>
                    <AreaChart data={periodDaily}>
                      <defs>
                        <linearGradient id="ecommDashSparkGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--nts-accent)" stopOpacity={0.2} />
                          <stop offset="95%" stopColor="var(--nts-accent)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="revenue" stroke="var(--nts-accent)" strokeWidth={1.5} fill="url(#ecommDashSparkGrad)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                );
              })()}
            </div>
          </div>
        </Card>
      )}

      {/* GA4 Web Analytics Summary */}
      {enabledModules.analytics && ga4.hasData && (
        <Card hover onClick={() => onSectionChange?.('analytics')}>
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 size={18} className="text-orange-500" />
                <h4 className="text-sm font-semibold text-[#1A1A1A]">Web Analytics</h4>
                <span className="text-[10px] text-[#9CA3AF] bg-[#F3F4F6] px-1.5 py-0.5 rounded">{ga4.propertyName}</span>
              </div>
              <span className="text-[10px] text-[#9CA3AF]">
                {ga4TotalsInPeriod.hasData ? 'επιλεγμένη περίοδος' : 'χωρίς ημερήσια δεδομένα — εμφάνιση συνολικού ιστορικού'}
              </span>
            </div>
            {(() => {
              const t = ga4TotalsInPeriod.hasData ? ga4TotalsInPeriod : { ...ga4.totals, hasData: false };
              const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString());
              return (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-[11px] text-[#6B7280] mb-0.5">Sessions</p>
                <p className="text-lg font-bold text-[#1A1A1A]">{fmt(t.sessions)}</p>
                {!t.hasData && ga4.weeklyChange?.sessions != null && (
                  <p className={`text-[10px] font-medium ${ga4.weeklyChange.sessions >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {ga4.weeklyChange.sessions >= 0 ? '+' : ''}{ga4.weeklyChange.sessions.toFixed(1)}% vs προηγ. 7ημ.
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] text-[#6B7280] mb-0.5">Users</p>
                <p className="text-lg font-bold text-[#1A1A1A]">{fmt(t.users)}</p>
                {!t.hasData && ga4.weeklyChange?.users != null && (
                  <p className={`text-[10px] font-medium ${ga4.weeklyChange.users >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {ga4.weeklyChange.users >= 0 ? '+' : ''}{ga4.weeklyChange.users.toFixed(1)}% vs προηγ. 7ημ.
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] text-[#6B7280] mb-0.5">Bounce Rate</p>
                <p className="text-lg font-bold text-[#1A1A1A]">{(t.bounceRate * 100).toFixed(1)}%</p>
                <p className="text-[10px] text-[#9CA3AF]">μέσος όρος περιόδου</p>
              </div>
              <div>
                <p className="text-[11px] text-[#6B7280] mb-0.5">Conversions</p>
                <p className="text-lg font-bold text-[#1A1A1A]">{t.conversions.toLocaleString()}</p>
                {!t.hasData && ga4.weeklyChange?.conversions != null && (
                  <p className={`text-[10px] font-medium ${ga4.weeklyChange.conversions >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {ga4.weeklyChange.conversions >= 0 ? '+' : ''}{ga4.weeklyChange.conversions.toFixed(1)}% vs προηγ. 7ημ.
                  </p>
                )}
              </div>
            </div>
              );
            })()}
          </div>
        </Card>
      )}

      {/* Main Charts Row */}
      {hasAnyData && (
        <>
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
        {/* Revenue Trend */}
        <Card 
          className="xl:col-span-2" 
          padding="lg"
          hover={!!onSectionChange}
          onClick={() => onSectionChange?.(isB2B ? 'finances' : 'roi')}
        >
          <CardHeader
            title="Revenue Performance"
            subtitle={
              enabledModules.ecommerce && ecomm.hasData ? (
                <p>
                  Ημερήσια ή μηνιαία εικόνα <strong className="font-semibold text-[var(--fgColor-default,#24292f)]">τζίρου από παραγγελίες</strong>, με βάση τον συγχρονισμό του e-shop και το server-side aggregate. Κάτω εμφανίζεται η{' '}
                  <strong className="font-semibold text-[var(--fgColor-default,#24292f)]">διαφημιστική απόδοση</strong> σε ξεχωριστή κλίμακα, χωρίς να αθροίζεται στον τζίρο.
                </p>
              ) : (
                <p>
                  {isB2B ? (
                    <>
                      Βασική εικόνα <strong className="font-semibold text-[var(--fgColor-default,#24292f)]">organic + demand generation</strong> έως ότου προστεθεί invoicing ή ERP feed για αποτύπωση εσόδων ανά account.
                    </>
                  ) : (
                    <>
                      Εκτίμηση <strong className="font-semibold text-[var(--fgColor-default,#24292f)]">organic + καμπανιών</strong> όταν δεν υπάρχει σύνδεση e-shop. Για πραγματικό τζίρο παραγγελιών απαιτείται σύνδεση του καταστήματος.
                    </>
                  )}
                </p>
              )
            }
            icon={<TrendingUp size={18} className="text-[var(--nts-accent)]" />}
          />
          {revenueChartData.length > 0 ? (
            <>
            <div 
              ref={revenueContainerRef}
              className="w-full" 
              style={{ 
                width: '100%', 
                height: '288px', 
                minHeight: '288px', 
                position: 'relative'
              }}
            >
              <AreaChart 
                width={chartDimensions.revenue.width} 
                height={chartDimensions.revenue.height} 
                data={revenueChartData} 
                margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
              >
                <defs>
                  <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="8%" stopColor={REV_CHART_ESHOP} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={REV_CHART_ESHOP} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                <XAxis
                  dataKey="month"
                  tick={{ fill: '#57606a', fontSize: 12 }}
                  axisLine={{ stroke: '#d0d7de' }}
                  tickLine={{ stroke: '#d0d7de' }}
                />
                <YAxis
                  width={52}
                  tick={{ fill: '#57606a', fontSize: 12 }}
                  axisLine={{ stroke: '#d0d7de' }}
                  tickLine={{ stroke: '#d0d7de' }}
                  tickFormatter={formatRevenueChartYAxisTick}
                  tickCount={6}
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #E8EAED',
                    borderRadius: '8px',
                    fontSize: '12px',
                    padding: '10px 14px',
                    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
                  }}
                  formatter={(value: any) => [
                    formatCurrencyCompact((value as number) || 0),
                    enabledModules.ecommerce && ecomm.hasData ? REV_PERF_LABEL_ESHOP : REV_PERF_LABEL_ESHOP_BLEND,
                  ]}
                  labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke={REV_CHART_ESHOP}
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#totalGradient)"
                  name="total"
                  isAnimationActive={false}
                />
              </AreaChart>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 pt-4 border-t border-[var(--nts-border-gray)]">
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white shadow-sm"
                  style={{ backgroundColor: REV_CHART_ESHOP }}
                />
                <span className="text-sm text-[var(--nts-medium-gray)]">
                  {enabledModules.ecommerce && ecomm.hasData ? REV_PERF_LABEL_ESHOP : REV_PERF_LABEL_ESHOP_BLEND}
                </span>
              </div>
            </div>

            {hasCampaigns && adsPerformanceSeries.length > 0 && (
              <div
                className="mt-6 border-t border-[var(--nts-border-gray)] pt-5"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
              >
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="flex items-start gap-2 min-w-0">
                    <Megaphone size={16} className="mt-0.5 shrink-0 text-[#64748B]" />
                    <div>
                      <p className="text-[13px] font-semibold text-[#1A1A1A]">Διαφήμιση (Google Ads / Meta)</p>
                      <p className="text-[11px] text-[#6B7280] leading-relaxed mt-0.5">
                        Δαπάνη (στήλες) και conversion value που αναφέρουν οι πλατφόρμες (γραμμή), για την ίδια περίοδο με το chart τζίρου. Η απεικόνιση είναι συγκριτική και όχι άμεση αντιστοίχιση με τον τζίρο του καταστήματος.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSectionChange?.('campaigns')}
                    className="shrink-0 text-xs font-semibold text-[var(--nts-accent)] hover:underline"
                  >
                    Campaigns →
                  </button>
                </div>
                <div className="w-full" style={{ height: 200, minHeight: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={adsPerformanceSeries} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                      <XAxis dataKey="label" tick={{ fill: '#57606a', fontSize: 11 }} axisLine={{ stroke: '#d0d7de' }} tickLine={{ stroke: '#d0d7de' }} />
                      <YAxis
                        width={48}
                        tick={{ fill: '#57606a', fontSize: 11 }}
                        axisLine={{ stroke: '#d0d7de' }}
                        tickLine={{ stroke: '#d0d7de' }}
                        tickFormatter={formatRevenueChartYAxisTick}
                        tickCount={5}
                      />
                      <RechartsTooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #E8EAED',
                          borderRadius: '8px',
                          fontSize: '12px',
                          padding: '8px 12px',
                        }}
                        formatter={(value: unknown, name?: string) => [
                          formatCurrencyCompact(Number(value) || 0),
                          name === 'adSpend' ? 'Δαπάνη διαφήμισης' : 'Conversion value (πλατφόρμα)',
                        ]}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                        formatter={(value) =>
                          value === 'adSpend' ? 'Δαπάνη' : value === 'adConvValue' ? 'Conversion value' : value
                        }
                      />
                      <Bar dataKey="adSpend" name="adSpend" fill={ADS_SPEND_COLOR} radius={[2, 2, 0, 0]} maxBarSize={28} />
                      <Line
                        type="monotone"
                        dataKey="adConvValue"
                        name="adConvValue"
                        stroke={ADS_CONV_COLOR}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-[#6B7280]">
                  <span>
                    Σύνολο περιόδου: δαπάνη{' '}
                    <strong className="text-[#374151]">{formatCurrencyCompact(campaignMetrics.totalSpend)}</strong>
                    {' · '}
                    conv. value{' '}
                    <strong className="text-[#374151]">{formatCurrencyCompact(campaignMetrics.totalRevenue)}</strong>
                  </span>
                  {campaignMetrics.totalSpend > 0 && (
                    <span>
                      ROAS (πλατφόρμα):{' '}
                      <strong className="text-[#374151]">{formatNumber(campaignMetrics.roas, 2)}×</strong>
                    </span>
                  )}
                </div>
              </div>
            )}
            </>
          ) : (
            <div className="w-full h-[288px] flex items-center justify-center bg-[#F5F5F5] rounded-lg">
              <div className="text-center">
                <TrendingUp size={32} className="text-[#9CA3AF] mx-auto mb-2" />
                <p className="text-sm text-[#4A4A4A] font-medium">Δεν υπάρχουν δεδομένα</p>
                <p className="text-xs text-[#9CA3AF] mt-1">Συνδέστε Analytics ή Campaigns για να εμφανιστεί η εικόνα απόδοσης εσόδων.</p>
              </div>
            </div>
          )}
        </Card>

        {/* Segment / B2B Priority Distribution */}
        {isB2B ? (
          <Card padding="lg">
            <CardHeader
              title="B2B Priorities"
              subtitle="Accounts, πωλήσεις και νέες αγορές"
              icon={<Building2 size={18} className="text-[var(--nts-medium-gray)]" />}
            />
            <div className="grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={() => onSectionChange?.('accounts')}
                className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4 text-left transition-colors hover:border-[var(--nts-accent)]"
              >
                <div className="flex items-center gap-2 text-[#1A1A1A]">
                  <Building2 size={16} className="text-[var(--nts-accent)]" />
                  <span className="font-semibold">Account Intelligence</span>
                </div>
                <p className="mt-2 text-sm text-[#6B7280]">Πλαίσιο αξιολόγησης για βασικούς λογαριασμούς, κίνδυνο ανανέωσης και δυνατότητες cross-sell.</p>
              </button>
              <button
                type="button"
                onClick={() => onSectionChange?.('sales')}
                className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4 text-left transition-colors hover:border-[var(--nts-accent)]"
              >
                <div className="flex items-center gap-2 text-[#1A1A1A]">
                  <Handshake size={16} className="text-[var(--nts-accent)]" />
                  <span className="font-semibold">Sales Pipeline</span>
                </div>
                <p className="mt-2 text-sm text-[#6B7280]">Λειτουργική παρακολούθηση για opportunities, pricing blockers και πειθαρχία στα επόμενα βήματα.</p>
              </button>
              <button
                type="button"
                onClick={() => onSectionChange?.('markets')}
                className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] p-4 text-left transition-colors hover:border-[var(--nts-accent)]"
              >
                <div className="flex items-center gap-2 text-[#1A1A1A]">
                  <Globe2 size={16} className="text-[var(--nts-accent)]" />
                  <span className="font-semibold">Market Exploration</span>
                </div>
                <p className="mt-2 text-sm text-[#6B7280]">Σχεδιασμός go-to-market για νέες αγορές, verticals και συνεργασίες διανομής.</p>
              </button>
            </div>
          </Card>
        ) : (
          <Card 
            padding="lg"
            hover={!!onSectionChange}
            onClick={() => onSectionChange?.('rfm')}
          >
            <CardHeader
              title="Customer Segments"
              subtitle="Κατανομή RFM"
              icon={<Users size={18} className="text-[var(--nts-medium-gray)]" />}
            />
            <div 
              ref={segmentContainerRef}
              className="w-full" 
              style={{ 
                width: '100%', 
                height: '224px', 
                minHeight: '224px', 
                position: 'relative'
              }}
            >
              <PieChart width={chartDimensions.segment.width} height={chartDimensions.segment.height}>
                  <Pie
                    data={rfmSegments as any}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="percentage"
                    nameKey="name"
                    labelLine={false}
                  >
                    {rfmSegments.map((segment) => (
                      <Cell key={segment.id} fill={segment.color ?? '#6B7280'} stroke="#fff" strokeWidth={2} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #d0d7de',
                      borderRadius: '6px',
                      fontSize: '12px',
                      padding: '8px 12px'
                    }}
                    formatter={(value: any, _name?: string, props?: any) => [
                      formatPercent((value as number) || 0, 1),
                      props?.payload?.name || ''
                    ]}
                  />
                </PieChart>
            </div>
            <div className="space-y-2 mt-4">
              {rfmSegments.map((segment) => (
                <div key={segment.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: segment.color }}
                    />
                    <span className="text-[#4A4A4A]">{segment.name}</span>
                  </div>
                  <span className="font-medium text-[#1A1A1A] font-mono">
                    {formatPercent(segment.percentage ?? 0, 1)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* AI Insights & Strategy */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-stretch">
        {/* AI Insights */}
        <Card 
          padding="lg"
          hover={!!onOpenInsights}
          onClick={() => onOpenInsights?.()}
          className="xl:col-span-2 h-full flex flex-col"
        >
          <CardHeader
            title="AI Insights"
            subtitle="Σύντομες, εφαρμόσιμες συστάσεις"
            icon={<Target size={18} className="text-[var(--nts-medium-gray)]" />}
            action={
              aiInsights.length > 4 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenInsights?.();
                  }}
                  className="text-xs font-medium text-[#9CA3AF] hover:text-[#4A4A4A] transition-colors"
                >
                  Όλα ({aiInsights.length})
                </button>
              )
            }
          />
          <div className="space-y-3 flex-1">
            {aiInsights.slice(0, 4).map((insight, index) => {
              const borderColor = insight.type === 'warning' ? '#F59E0B' : insight.type === 'opportunity' ? '#22C55E' : '#9CA3AF';
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="p-3 rounded-lg border border-[#E5E5E5] bg-[#FAFAFA]"
                  style={{ borderLeftWidth: 3, borderLeftColor: borderColor }}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-[#1A1A1A] text-[13px] mb-0.5 leading-snug">
                        {insight.title}
                      </h4>
                      <p className="text-[12px] text-[#9CA3AF] leading-relaxed line-clamp-2">
                        {insight.insight}
                      </p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleInsightAction(insight);
                      }}
                      className="text-[11px] font-medium text-[#4A4A4A] whitespace-nowrap px-2 py-1 rounded-md border border-[#E5E5E5] hover:bg-[#F5F5F5] transition-colors cursor-pointer flex-shrink-0 mt-0.5"
                    >
                      {insight.action}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </Card>

        {/* Strategy & Health */}
        <Card padding="lg" className="h-full flex flex-col">
          <CardHeader
            title={isB2B ? 'B2B Control Tower' : 'Strategy & Status'}
            subtitle={isB2B ? 'Στρατηγική, εμπορική εκτέλεση και ετοιμότητα' : 'Ενεργή στρατηγική και κατάσταση δεδομένων'}
            icon={<Target size={18} className="text-[var(--nts-medium-gray)]" />}
          />
          <div className="flex-1 flex flex-col gap-4">
            <div
              className="p-4 rounded-xl border border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)] cursor-pointer hover:border-[var(--nts-accent)] transition-colors"
              onClick={() => onSectionChange?.('strategy')}
            >
              <p className="text-[11px] font-medium text-[var(--nts-medium-gray)] uppercase tracking-wider mb-1">Στρατηγική</p>
              <p className="text-[15px] font-semibold text-[var(--nts-charcoal)]">
                {activeStrategy ? getStrategyName(activeStrategy.scenarioId) : 'Δεν έχει οριστεί'}
              </p>
              {activeStrategy?.approvalStatus === 'implementing' && (
                <span className="inline-block mt-1.5 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-green-100 text-green-700">ενεργή</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div
                className="text-center p-3 rounded-lg bg-white border border-[var(--nts-border-gray)] cursor-pointer hover:border-[var(--nts-accent)] transition-colors"
                onClick={(e) => { e.stopPropagation(); onSectionChange?.('products'); }}
              >
                <p className="text-lg font-bold text-[var(--nts-charcoal)] font-mono">{formatNumber(productsCount || productStats?.totalSkus || 0)}</p>
                <p className="text-[11px] text-[var(--nts-medium-gray)]">Προϊόντα</p>
              </div>
              <div
                className="text-center p-3 rounded-lg bg-white border border-[var(--nts-border-gray)] cursor-pointer hover:border-[var(--nts-accent)] transition-colors"
                onClick={(e) => { e.stopPropagation(); onSectionChange?.('campaigns'); }}
              >
                <p className="text-lg font-bold text-[var(--nts-charcoal)] font-mono">{formatNumber(campaignsCount)}</p>
                <p className="text-[11px] text-[var(--nts-medium-gray)]">{isB2B ? 'Demand' : 'Campaigns'}</p>
              </div>
              <div
                className="text-center p-3 rounded-lg bg-white border border-[var(--nts-border-gray)] cursor-pointer hover:border-[var(--nts-accent)] transition-colors"
                onClick={(e) => { e.stopPropagation(); onSectionChange?.(isB2B ? 'accounts' : 'rfm'); }}
              >
                <p className="text-lg font-bold text-[var(--nts-charcoal)] font-mono">{isB2B ? formatNumber(openCommercialTasks) : rfmSegments.length}</p>
                <p className="text-[11px] text-[var(--nts-medium-gray)]">{isB2B ? 'Open sales tasks' : 'Segments'}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>
        </>
      )}
    </div>
  );
}


