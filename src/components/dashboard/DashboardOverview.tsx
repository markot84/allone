import { useEffect, useMemo, useRef, useState } from 'react';
import { Tooltip } from '../common';
import { ChromeActions, useFullBleedCanvas } from '../layout/AppChrome';
import { ChromePeriodSwitch, ChromeTabRow, PageCanvas } from '../layout/ChromeControls';
import { NotificationBell } from '../coordination/NotificationBell';
import { BriefingDrawer } from '../coordination/BriefingDrawer';
import {
  AdsPerformanceChart,
  AxisTicks,
  HeroSpark,
  LegendKey,
  MONO,
  MetricTile,
  PillButton,
  RevenueTrendChart,
  SegmentShareBar,
  SignalAlerts,
  SignalCard,
  SignalCardHeader,
  SignalChip,
  SignalEyebrow,
  SignalSkeleton,
  deltaColor,
  directionOf,
  type Delta,
} from '../signal';
import { useSegments } from '../../hooks/useSegments';
import { useOrganic } from '../../hooks/useOrganic';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useBrand } from '../../hooks/useBrand';
import { prefersEshopRevenuePerformance } from '../../utils/revenueSource';
import { buildSupplierTodMap } from '../../utils/productUtils';
import { useProductAggregates, useSegmentAggregates } from '../../hooks/useAggregates';
import { useProductIntelligenceAggregate } from '../../hooks/useProductIntelligenceAggregate';
import { useProcurementSignals } from '../../hooks/useProcurementSignals';
import { usePlan } from '../../hooks/usePlan';
import { usePeriodScopedCampaigns } from '../../hooks/usePeriodScopedCampaigns';
import { useDashPeriod } from '../../hooks/useDashPeriod';
import { GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useConnectorStatuses, useConnectorSyncErrors } from '../../hooks/useConnectorSyncErrors';
import { useEcommerceFullHistoryMetrics } from '../../hooks/useEcommerceFullHistoryMetrics';
import { useBusinessRevenueSummary } from '../../hooks/useBusinessRevenueSummary';
import { useProcurement } from '../../hooks/useProcurement';
import { useModules } from '../../hooks/useModules';
import {
  calculateCampaignMetrics,
  getCampaignDateForMonth,
  getCampaignMonthlyAttributedValueInPeriod,
  getCampaignDailyAttributedValueInPeriod,
  getCampaignDailyAttributedSpendInPeriod,
  monthKeyFromDate,
  buildRoiTrendSeries,
  buildRoiTrendSeriesDaily,
  mergeOrganicByMonthWithGa4,
  mergeGa4OrganicDailyWithChannelFallback,
  sumDailyRevenueInPeriod,
  eachCalendarMonthInclusive,
  daysInMonthIntersectingRange,
  formatMonthKeyShort,
  formatTrendDayLabel,
} from '../../utils/roiUtils';
import { formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import type { Campaign } from '../../types';
import { useAiInsightsData } from '../insights/useAiInsightsData';
import { useAutomationRunner } from '../../hooks/useAutomationRunner';
import { useAutomationAlerts } from '../../hooks/useAutomation';
import { MorningBriefing } from './MorningBriefing';
import { eachDateInclusiveLocal, computeMarketingOverheadForPeriod } from '../../utils/marketingCostPeriod';
import { getCostingReal12mTurnover } from '../../utils/procurement12mTurnover';
import { coerceToDate } from '../../utils/coerceDate';
import { INSIGHT_NAV } from '../insights/aiInsightsConfig';
import { isSectionHidden } from '../../config/modules';
import { logger } from '../../utils/logger';
import type { AIInsight } from '../../types';

/** Daily points in the chart; above this -> monthly summary (readable axis). */
const REVENUE_CHART_MAX_DAILY_POINTS = 90;

/** Revenue Performance main chart. Follows the accent theme so all trends
 *  (e-commerce spark, GA4 spark, revenue chart) share one color with the selected theme. */

const REV_PERF_LABEL_ESHOP = 'Τζίρος e-shop (παραγγελίες)';
const REV_PERF_LABEL_ESHOP_BLEND = 'Organic + καμπάνιες (εκτίμηση)';
const DASHBOARD_LOADING_TIMEOUT_MS = 1800;
const FINANCIAL_GATE_TIMEOUT_MS = 1800;
const BRIEFING_CONTEXT_TIMEOUT_MS = 6000;
/** Ads standalone efficiency chart (not a comparison against revenue). */
// Fixed (not accent): the ads efficiency chart is multi-series — following the accent
// would clash with ADS_SPEND_COLOR.

/** X axis: unique key per day/month (avoids collisions from `toLocaleDateString` in Recharts). */
function formatDashChartDateKeyTick(dateKey: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return formatTrendDayLabel(dateKey);
  if (/^\d{4}-\d{2}$/.test(dateKey)) return formatMonthKeyShort(dateKey);
  return dateKey;
}

/** ERP chart: full daily series for the period, no interpolation/forward-fill. Missing day = €0. */
function completeDailyRevenueSeries(dayList: string[], record: Record<string, number>): number[] {
  return dayList.map((d) => {
    if (!Object.prototype.hasOwnProperty.call(record, d)) return 0;
    const value = Number(record[d]);
    return Number.isFinite(value) ? value : 0;
  });
}

function latestPositiveRevenueDayInPeriod(
  revenueByDay: Record<string, number> | undefined,
  fromDate: string,
  toDate: string
): string | null {
  if (!revenueByDay) return null;
  let latest: string | null = null;
  for (const [day, value] of Object.entries(revenueByDay)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (day < fromDate || day > toDate) continue;
    if ((Number(value) || 0) <= 0) continue;
    if (!latest || day > latest) latest = day;
  }
  return latest;
}

function daysBetweenDateKeys(fromDate: string | null, toDate: string): number | null {
  if (!fromDate || !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return null;
  }
  const from = new Date(`${fromDate}T00:00:00Z`).getTime();
  const to = new Date(`${toDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function hoursSince(value: unknown): number | null {
  const d = coerceToDate(value);
  if (!d) return null;
  const diff = Date.now() - d.getTime();
  if (!Number.isFinite(diff)) return null;
  return Math.max(0, diff / 3_600_000);
}

function sumDailyRecordByMonthInPeriod(
  daily: Record<string, number>,
  fromDate: string,
  toDate: string
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const day of eachDateInclusiveLocal(fromDate, toDate)) {
    const value = daily[day] || 0;
    if (!value) continue;
    const ym = day.slice(0, 7);
    out[ym] = (out[ym] || 0) + value;
  }
  return out;
}

interface DashboardOverviewProps {
  /** Optional `hashQuery` for deep links (e.g. alerts -> `#products?stock=low`) */
  onSectionChange?: (section: string, opts?: { hashQuery?: string }) => void;
  onOpenInsights?: () => void;
}

export function DashboardOverview({ onSectionChange, onOpenInsights }: DashboardOverviewProps = {}) {
  const { currentBrand } = useBrand();
  const { isB2B, enabledModules } = useModules();
  const { segments: rfmSegments, hasImported: hasSegments, isLoading: segmentsLoading, dataSource: segmentsDataSource, aggregateStatus } = useSegments({
    skipOrderHydration: true,
    // Feed from the precomputed server RFM aggregate (1 doc read) -> real segments fast,
    // without client-side computation over 400 days of orders.
    useServerAggregate: true,
  });
  const { segmentStats } = useSegmentAggregates();
  const lastGoodRfmSegmentsRef = useRef<{ brandId: string | null; segments: typeof rfmSegments }>({
    brandId: null,
    segments: [],
  });
  const productIntelligence = useProductIntelligenceAggregate('all', 1, { pageSize: 150 }, { staticFirstPage: true });
  const products = productIntelligence.page?.products ?? [];
  const { isEnterprise } = usePlan();
  const { signalsBySku: procurementSignals } = useProcurementSignals();
  const { productStats } = useProductAggregates();
  const { suppliers } = useSuppliers();
  const { totalOrganicRevenue, byMonth: organicByMonth, hasOrganicRevenue: hasOrganic, isLoading: organicLoading } = useOrganic();
  const { campaigns, hasImported: hasCampaigns, isLoading: campaignsLoading } = useCampaigns();
  const { activeStrategy, getStrategyName } = useActiveStrategy();
  useAutomationRunner();
  const ga4 = useGA4Data();
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const connectorSyncErrors = useConnectorSyncErrors();
  /** Server summary only (`ecommerce_summary`) — one Firestore read; `full` mode froze the main
   *  thread on 10K+ order brands. Accuracy kept via `refreshAggregates` on rules/source change. */
  const ecommHist = useEcommerceFullHistoryMetrics({ mode: 'summary_only' });
  const businessRevenue = useBusinessRevenueSummary();
  const procurementSheets = useProcurement({ sheets: ['costing'] });
  const { alerts: automationAlerts } = useAutomationAlerts();

  useEffect(() => {
    if (!currentBrand?.id || rfmSegments.length === 0) return;
    lastGoodRfmSegmentsRef.current = { brandId: currentBrand.id, segments: rfmSegments };
  }, [currentBrand?.id, rfmSegments]);

  const dashboardRfmSegments = useMemo(() => {
    if (rfmSegments.length > 0) return rfmSegments;
    if (!segmentsLoading || lastGoodRfmSegmentsRef.current.brandId !== currentBrand?.id) return rfmSegments;
    return lastGoodRfmSegmentsRef.current.segments;
  }, [currentBrand?.id, rfmSegments, segmentsLoading]);

  const dashboardHasSegments =
    hasSegments ||
    dashboardRfmSegments.length > 0 ||
    (segmentStats?.totalCustomers ?? 0) > 0;

  // Empty pie -> show guidance instead of an empty ring. Read rfmSegments directly (not the
  // ref-derived value) so the check does not pass through a ref (react-hooks/refs).
  const showSegmentsEmptyState = !segmentsLoading && rfmSegments.length === 0;
  // Optional caption: full pie from imported segments without a recent RFM aggregate —
  // a soft note WITHOUT a CTA (for import-only brands a refresh produces no result).
  const showSegmentsStaleSourceNote =
    !segmentsLoading && rfmSegments.length > 0 && segmentsDataSource !== 'ecommerce';

  const supplierTodMap = useMemo(
    () => buildSupplierTodMap(suppliers, currentBrand?.inventoryThresholds?.defaultTod),
    [suppliers, currentBrand?.inventoryThresholds?.defaultTod]
  );
  const productsCount = productIntelligence.aggregate?.totalCount ?? productStats?.totalSkus ?? 0;
  const hasAnyData =
    hasOrganic ||
    dashboardHasSegments ||
    productsCount > 0 ||
    hasCampaigns ||
    ecomm.hasData ||
    businessRevenue.hasErpRevenueData ||
    (enabledModules.procurement && procurementSheets.hasData);

  const ga4AnalyticsLoading = enabledModules.analytics && ga4.isLoading && !ga4.hasData;
  const ecommerceRawBusy =
    Boolean(currentBrand) &&
    enabledModules.ecommerce &&
    ecomm.connectedPlatforms.length > 0 &&
    ecommHist.rawLoading;

  // Financial gate: only on first load without usable data; background refetches must not hide the Dashboard (flicker).
  // procurement_costing hydrates late (getCostingReal12mTurnover) without blocking paint; procurementSheets.hasData speeds cached release.
  const rawFinancialSourcesLoading =
    Boolean(currentBrand) &&
    (businessRevenue.isLoading ||
      ecomm.isLoading ||
      campaignsLoading ||
      organicLoading);
  const hasUsableFinancialData =
    businessRevenue.hasErpRevenueData ||
    ecomm.hasData ||
    hasCampaigns ||
    hasOrganic ||
    (enabledModules.procurement && procurementSheets.hasData);
  const releasedFinancialGateBrandsRef = useRef(new Set<string>());
  const [financialGateTimedOut, setFinancialGateTimedOut] = useState(false);
  const financialGateReleased = currentBrand ? releasedFinancialGateBrandsRef.current.has(currentBrand.id) : false;
  const financialSourcesLoading =
    rawFinancialSourcesLoading && !financialGateReleased && !hasUsableFinancialData && !financialGateTimedOut;

  useEffect(() => {
    if (!currentBrand) return;
    if (!rawFinancialSourcesLoading || hasUsableFinancialData) {
      releasedFinancialGateBrandsRef.current.add(currentBrand.id);
    }
  }, [currentBrand, rawFinancialSourcesLoading, hasUsableFinancialData]);

  useEffect(() => {
    setFinancialGateTimedOut(false);
    if (!currentBrand || !rawFinancialSourcesLoading || hasUsableFinancialData || financialGateReleased) return;
    const t = window.setTimeout(() => setFinancialGateTimedOut(true), FINANCIAL_GATE_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [currentBrand?.id, rawFinancialSourcesLoading, hasUsableFinancialData, financialGateReleased]);

  /** AI Briefing must NOT be written before critical inputs load, else it may see campaigns=[]
   *  and wrongly state there is no ad spend. */
  const briefingMetricsReady =
    !rawFinancialSourcesLoading &&
    !ecommHist.rawLoading;
  const [briefingContextTimedOut, setBriefingContextTimedOut] = useState(false);
  const briefingSecondaryContextLoading = ga4AnalyticsLoading || segmentsLoading;
  const briefingReady =
    briefingMetricsReady &&
    (!briefingSecondaryContextLoading || briefingContextTimedOut);

  useEffect(() => {
    setBriefingContextTimedOut(false);
    if (!currentBrand?.id || !briefingMetricsReady || !briefingSecondaryContextLoading) return;
    const t = window.setTimeout(() => setBriefingContextTimedOut(true), BRIEFING_CONTEXT_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [currentBrand?.id, briefingMetricsReady, briefingSecondaryContextLoading]);

  const [dashboardLoadingTimedOut, setDashboardLoadingTimedOut] = useState(false);
  const dashboardOverviewBusy =
    Boolean(currentBrand) &&
    !hasAnyData &&
    !hasUsableFinancialData &&
    (segmentsLoading ||
      campaignsLoading ||
      organicLoading ||
      (enabledModules.ecommerce && ecomm.isLoading) ||
      ecommerceRawBusy ||
      ga4AnalyticsLoading);
  const dashboardOverviewLoading = financialSourcesLoading || (dashboardOverviewBusy && !dashboardLoadingTimedOut);
  /** Do not show "import data" while e-shop / campaigns / GA4 are still loading. */
  const dashboardStillHydrating =
    Boolean(currentBrand) &&
    !hasAnyData &&
    !hasUsableFinancialData &&
    (ecomm.isLoading || campaignsLoading || organicLoading || ga4AnalyticsLoading);

  useEffect(() => {
    setDashboardLoadingTimedOut(false);
    if (financialSourcesLoading || !dashboardOverviewBusy) return;
    const t = window.setTimeout(() => setDashboardLoadingTimedOut(true), DASHBOARD_LOADING_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [currentBrand?.id, financialSourcesLoading, dashboardOverviewBusy]);

  const campaignsTyped = (campaigns ?? []) as Campaign[];

  const { period: dashPeriod, periodDates } = useDashPeriod();

  const periodCampaigns = usePeriodScopedCampaigns(campaignsTyped, periodDates);

  const campaignMetrics = useMemo(() => calculateCampaignMetrics(periodCampaigns), [periodCampaigns]);

  /** Marketing overhead = costs beyond ad spend (agency, tools, one-off) from the active strategy,
   *  folded into the "Marketing Expenses" KPI with ad spend for total spend (matches ROI page). */
  const marketingOverheadPeriod = useMemo(
    () =>
      computeMarketingOverheadForPeriod(
        activeStrategy?.marketingCostLines,
        activeStrategy?.monthlyBudget || 0,
        periodDates.fromDate,
        periodDates.toDate
      ),
    [activeStrategy?.marketingCostLines, activeStrategy?.monthlyBudget, periodDates.fromDate, periodDates.toDate]
  );

  const totalMarketingExpenses = useMemo(
    () => Math.round((campaignMetrics.totalSpend + marketingOverheadPeriod.total) * 100) / 100,
    [campaignMetrics.totalSpend, marketingOverheadPeriod.total]
  );

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

  // Orders for the period: first from summary, then from raw aggregates once loaded (hybrid, same as revenue/AOV).
  const ordersInPeriod = useMemo(
    () =>
      ecommHist.ordersByDay
        .filter((d) => d.date >= periodDates.fromDate && d.date <= periodDates.toDate)
        .reduce((sum, d) => sum + d.orders, 0),
    [ecommHist.ordersByDay, periodDates.fromDate, periodDates.toDate]
  );

  /** AOV from real e-shop data (revenue/orders of the period). Reliable, no ad-platform double-counting. */
  const eshopAovInPeriod = useMemo(
    () => (ordersInPeriod > 0 ? storeRevenueInPeriod / ordersInPeriod : 0),
    [storeRevenueInPeriod, ordersInPeriod]
  );

  // GA4 totals for the selected period (instead of 90-day totals).
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

  const ga4SessionsTrend = useMemo(() => {
    const periodDays = ga4.dailyEntries.filter(
      (d) => d.date >= periodDates.fromDate && d.date <= periodDates.toDate
    );
    const sourceDays = periodDays.length > 1 ? periodDays : ga4.dailyEntries;
    return sourceDays
      .map((d) => ({
        dateKey: d.date,
        sessions: Number(d.sessions) || 0,
      }))
      .filter((d) => d.sessions > 0);
  }, [ga4.dailyEntries, periodDates.fromDate, periodDates.toDate]);

  const hasEcommerceRevenue = enabledModules.ecommerce && ecomm.hasData;

  /** Per-brand Revenue-Performance source. When the e-shop lens is active (default when an e-shop
   *  connector exists), the trend + total KPI use the e-shop series and never auto-flip to ERP. */
  const hasEshopConnector = ecomm.connectedPlatforms.length > 0 || ecomm.hasData;
  const prefersEshopPerformance = prefersEshopRevenuePerformance(
    currentBrand?.revenuePerformanceSource,
    hasEshopConnector
  );

  const erpRevenueByDayRecord = businessRevenue.revenueByDayRecord;
  const hasErpBusinessRevenue = businessRevenue.hasErpRevenueData;

  const costing12m = useMemo(
    () => getCostingReal12mTurnover((procurementSheets.data.costing ?? []) as Record<string, unknown>[]),
    [procurementSheets.data.costing]
  );

  const procurementPeriodDays = useMemo(
    () => eachDateInclusiveLocal(periodDates.fromDate, periodDates.toDate).length,
    [periodDates.fromDate, periodDates.toDate]
  );

  const procurementRevenueInPeriod = useMemo(() => {
    if (!enabledModules.procurement || !costing12m.hasColumn || costing12m.sum <= 0) return 0;
    return (costing12m.sum / 365) * procurementPeriodDays;
  }, [enabledModules.procurement, costing12m.hasColumn, costing12m.sum, procurementPeriodDays]);

  const erpRevenueInPeriod = useMemo(
    () => sumDailyRevenueInPeriod(erpRevenueByDayRecord, periodDates.fromDate, periodDates.toDate),
    [erpRevenueByDayRecord, periodDates.fromDate, periodDates.toDate]
  );

  const erpLatestRevenueDayInPeriod = useMemo(
    () => latestPositiveRevenueDayInPeriod(erpRevenueByDayRecord, periodDates.fromDate, periodDates.toDate),
    [erpRevenueByDayRecord, periodDates.fromDate, periodDates.toDate]
  );
  const ecommLatestRevenueDayInPeriod = useMemo(
    () => latestPositiveRevenueDayInPeriod(ecommRevenueByDayRecord, periodDates.fromDate, periodDates.toDate),
    [ecommRevenueByDayRecord, periodDates.fromDate, periodDates.toDate]
  );
  const erpDailyCoverageIsCurrentForPeriod =
    !hasEcommerceRevenue ||
    !ecommLatestRevenueDayInPeriod ||
    (!!erpLatestRevenueDayInPeriod && erpLatestRevenueDayInPeriod >= ecommLatestRevenueDayInPeriod);

  /** ERP wins for the total-turnover KPI when current for the period; e-shop revenue after the latest
   *  ERP day means the ERP summary is stale/incomplete for this view. */
  const hasErpRevenueForPeriod =
    hasErpBusinessRevenue && erpRevenueInPeriod > 0 && erpDailyCoverageIsCurrentForPeriod;

  /** PER-171: the headline total-turnover KPI (and its tooltip) use the business-wide ERP figure
   *  whenever ERP data exists — matching the Finances detail headline. The coverage-freshness gate
   *  stays on the chart/sparkline/AOV only; for the headline it would silently degrade the €268K
   *  business-wide turnover to the €83K e-shop subset whenever the ERP daily series lags by a day. */
  const kpiUsesErp = hasErpBusinessRevenue && erpRevenueInPeriod > 0;

  const hasProcurementTurnoverEstimate = procurementRevenueInPeriod > 0;

  /** The Revenue Performance trend uses the e-shop order-date series when the brand prefers it (avoids
   *  ERP document-date €0-gaps); the total-turnover KPI keeps its ERP-first cascade regardless. */
  const chartUsesProcurement = hasProcurementTurnoverEstimate && !prefersEshopPerformance;
  const chartUsesErp = hasErpRevenueForPeriod && !prefersEshopPerformance;

  /** Total revenue source priority: Procurement (Enterprise) -> ERP -> e-shop -> organic + campaigns.
   *  Procurement always wins when 12-month costing data exists. */
  const dashboardTotalRevenue = useMemo(() => {
    if (hasProcurementTurnoverEstimate) return procurementRevenueInPeriod;
    if (kpiUsesErp) return erpRevenueInPeriod;
    if (hasEcommerceRevenue) return storeRevenueInPeriod;
    return organicRevenueInPeriod + campaignMetrics.totalRevenue;
  }, [
    hasProcurementTurnoverEstimate,
    procurementRevenueInPeriod,
    kpiUsesErp,
    erpRevenueInPeriod,
    hasEcommerceRevenue,
    storeRevenueInPeriod,
    organicRevenueInPeriod,
    campaignMetrics.totalRevenue,
  ]);

  /** PER-301 disclosure: share from the KPI's backing source; € approximated as share × the period figure. */
  const nonMerchSubtext = useMemo(() => {
    const share = kpiUsesErp ? businessRevenue.nonMerchandiseShare : ecomm.nonMerchandiseShare;
    if (!share || share <= 0 || dashboardTotalRevenue <= 0) return undefined;
    return `~${formatCurrencyCompact(dashboardTotalRevenue * share)} (${(share * 100).toFixed(1)}%) από μη εμπορεύσιμα προϊόντα`;
  }, [kpiUsesErp, businessRevenue.nonMerchandiseShare, ecomm.nonMerchandiseShare, dashboardTotalRevenue]);

  const revenueTotalKpiTooltip = useMemo(() => {
    if (isB2B) {
      return 'Βασική εικόνα εσόδων από οργανική ζήτηση και demand generation. Για πλήρη αποτύπωση εσόδων ανά account απαιτείται invoicing ή ERP import.';
    }
    const tail = ' Ανάλυση e-shop & ROAS: σελίδα «ROI & Απόδοση». Πλήρης οικονομική εικόνα: «Οικονομικά».';
    if (hasProcurementTurnoverEstimate) {
      return (
        'Εκτιμώμενος συνολικός τζίρος της επιχείρησης για την επιλεγμένη περίοδο. Προκύπτει από τον πραγματικό ετήσιο τζίρο (τελευταίοι 12 μήνες, από την Κοστολόγηση) μοιρασμένο ομοιόμορφα στις ημέρες της περιόδου. Είναι εκτίμηση — όχι άθροισμα μεμονωμένων παραστατικών.' +
        tail
      );
    }
    if (kpiUsesErp) {
      return 'Πραγματικός τζίρος από τα παραστατικά του ERP για την περίοδο. Περιλαμβάνει φυσικά καταστήματα, B2B και online πωλήσεις, όπως καταγράφονται στο ERP.' + tail;
    }
    if (enabledModules.procurement) {
      return (
        'Συνολικά έσοδα της επιχείρησης για την περίοδο. Χρησιμοποιείται η καλύτερη διαθέσιμη πηγή με σειρά: ετήσιος τζίρος Κοστολόγησης → παραστατικά ERP → τζίρος e-shop → εκτίμηση από organic & καμπάνιες.' +
        tail
      );
    }
    return (
      'Συνολικά έσοδα της επιχείρησης για την περίοδο. Χρησιμοποιείται η καλύτερη διαθέσιμη πηγή με σειρά: παραστατικά ERP → τζίρος e-shop → εκτίμηση από organic & καμπάνιες.' +
      tail
    );
  }, [isB2B, hasProcurementTurnoverEstimate, kpiUsesErp, enabledModules.procurement]);

  const revenuePerformanceChartLabel = chartUsesProcurement
    ? 'Τζίρος επιχείρησης (Procurement · εκτίμηση 12μ.)'
    : chartUsesErp
      ? 'Τζίρος επιχείρησης (ERP)'
      : enabledModules.ecommerce && ecomm.hasData
        ? REV_PERF_LABEL_ESHOP
        : REV_PERF_LABEL_ESHOP_BLEND;

  /** Fingerprint for repeatedly checking AI briefing vs KPI. */
  const briefingFinanceKey = useMemo(
    () =>
      [
        enabledModules.ecommerce && ecomm.connectedPlatforms.length > 0 ? ecommHist.source : 'no_ecomm',
        businessRevenue.source,
        Math.round(dashboardTotalRevenue),
        Math.round(storeRevenueInPeriod),
        ordersInPeriod,
        Math.round(organicRevenueInPeriod),
        Math.round((campaignMetrics.totalSpend + Number.EPSILON) * 100) / 100,
        periodCampaigns.length,
        periodDates.fromDate,
        periodDates.toDate,
      ].join('|'),
    [
      enabledModules.ecommerce,
      ecomm.connectedPlatforms.length,
      ecommHist.source,
      businessRevenue.source,
      dashboardTotalRevenue,
      storeRevenueInPeriod,
      ordersInPeriod,
      organicRevenueInPeriod,
      campaignMetrics.totalSpend,
      periodCampaigns.length,
      periodDates.fromDate,
      periodDates.toDate,
    ]
  );

  const ecommLatestPositiveRevenueDay = useMemo(
    () => latestPositiveRevenueDayInPeriod(ecommRevenueByDayRecord, periodDates.fromDate, periodDates.toDate),
    [ecommRevenueByDayRecord, periodDates.fromDate, periodDates.toDate]
  );

  const ecommDaysSinceLatestRevenue = useMemo(
    () => daysBetweenDateKeys(ecommLatestPositiveRevenueDay, periodDates.toDate),
    [ecommLatestPositiveRevenueDay, periodDates.toDate]
  );

  const ecommAggregateSyncedHoursAgo = useMemo(() => hoursSince(ecomm.syncedAt), [ecomm.syncedAt]);
  const ecommAggregateFresh = ecommAggregateSyncedHoursAgo !== null && ecommAggregateSyncedHoursAgo <= 36;

  const hasSuspectedEcommSyncGap =
    enabledModules.ecommerce &&
    ecomm.connectedPlatforms.length > 0 &&
    storeRevenueInPeriod > 0 &&
    !ecommAggregateFresh &&
    (ecommDaysSinceLatestRevenue ?? 0) >= 2;
  // Inventory value: Enterprise from procurement_signals (sum tied_capital = stock x cost; PI is
  // hidden there); Growth from the PI aggregate (procurement) or the products aggregate (ERP/import).
  const procurementInventoryValue = useMemo(() => {
    if (!isEnterprise) return 0;
    let total = 0;
    for (const sig of Object.values(procurementSignals)) {
      const tied = sig.tied_capital ?? (sig.available_stock ?? 0) * (sig.cost_unit ?? 0);
      if (tied > 0) total += tied;
    }
    return total;
  }, [isEnterprise, procurementSignals]);
  const piSummaryValue =
    productIntelligence.aggregate?.sourceKind === 'procurement'
      ? productIntelligence.aggregate?.summary?.total_value ?? 0
      : 0;
  const inventoryValueEstimate =
    procurementInventoryValue > 0
      ? procurementInventoryValue
      : piSummaryValue > 0
        ? piSummaryValue
        : productStats?.totalInventoryValue ?? 0;

  /** Main chart — single revenue series, same priority as the total revenue KPI:
   *  ERP -> (Enterprise) costing estimate -> e-shop -> organic + campaigns. */
  const revenueChartData = useMemo(() => {
    const { fromDate, toDate } = periodDates;
    const dayCount = eachDateInclusiveLocal(fromDate, toDate).length;
    if (dayCount === 0) return [];

    if (chartUsesProcurement && costing12m.sum > 0) {
      const dailyRate = costing12m.sum / 365;
      if (dayCount <= REVENUE_CHART_MAX_DAILY_POINTS) {
        return eachDateInclusiveLocal(fromDate, toDate).map((d) => ({
          dateKey: d,
          total: dailyRate,
        }));
      }
      const fromYm = fromDate.slice(0, 7);
      const toYm = toDate.slice(0, 7);
      return eachCalendarMonthInclusive(fromYm, toYm).map((ym) => ({
        dateKey: ym,
        total: dailyRate * daysInMonthIntersectingRange(ym, fromDate, toDate),
      }));
    }

    if (chartUsesErp) {
      if (dayCount <= REVENUE_CHART_MAX_DAILY_POINTS) {
        const days = eachDateInclusiveLocal(fromDate, toDate);
        const daily = completeDailyRevenueSeries(days, erpRevenueByDayRecord);
        return days.map((d, i) => ({
          dateKey: d,
          total: daily[i] ?? 0,
        }));
      }
      const fromYm = fromDate.slice(0, 7);
      const toYm = toDate.slice(0, 7);
      return eachCalendarMonthInclusive(fromYm, toYm).map((ym) => {
        const y = Number(ym.split('-')[0]);
        const m = Number(ym.split('-')[1]);
        const monthEndDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const monthEnd = `${ym}-${String(monthEndDay).padStart(2, '0')}`;
        const start = `${ym}-01` > fromDate ? `${ym}-01` : fromDate;
        const end = monthEnd < toDate ? monthEnd : toDate;
        let total = 0;
        if (start <= end) {
          for (const d of eachDateInclusiveLocal(start, end)) {
            total += erpRevenueByDayRecord[d] || 0;
          }
        }
        return { dateKey: ym, total };
      });
    }

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
          dateKey: r.date,
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
        dateKey: r.monthSort,
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
    chartUsesProcurement,
    costing12m.sum,
    chartUsesErp,
    erpRevenueByDayRecord,
  ]);

  /** Daily or monthly series for the ads chart (spend + conversion value + ROAS from synced campaigns). */
  const adsPerformanceSeries = useMemo(() => {
    if (!hasCampaigns || periodCampaigns.length === 0) return [];
    const { fromDate, toDate } = periodDates;
    const dayList = eachDateInclusiveLocal(fromDate, toDate);
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
      return dayList.map((day) => {
        const adSpend = Math.round((spendByDay[day] || 0) * 100) / 100;
        const adConvValue = Math.round((valByDay[day] || 0) * 100) / 100;
        return {
          dateKey: day,
          adSpend,
          adConvValue,
          roas: adSpend > 0 ? Math.round((adConvValue / adSpend) * 100) / 100 : null,
        };
      });
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
        dateKey: ym,
        adSpend: Math.round(v.adSpend * 100) / 100,
        adConvValue: Math.round(v.adConvValue * 100) / 100,
        roas: v.adSpend > 0 ? Math.round((v.adConvValue / v.adSpend) * 100) / 100 : null,
      }));
  }, [hasCampaigns, periodCampaigns, periodDates]);

  // Debug logging
  useEffect(() => {
    if (import.meta.env.MODE === 'development') {
      logger.debug('[Dashboard] Organic revenue:', { totalOrganicRevenue, hasOrganic });
    }
  }, [totalOrganicRevenue, hasOrganic]);
  const { aiInsights } = useAiInsightsData({ skipOrderHydration: true, useServerAggregate: true });

  /** Navigate, unless the target is switched off for this build — then the action stays inert
   * rather than bouncing the user back to the dashboard. */
  const goToSection = (section: string, opts?: { hashQuery?: string }) => {
    if (isSectionHidden(section)) return;
    onSectionChange?.(section, opts);
  };

  /** `onClick` for tiles that link to another section: `undefined` when that section is hidden,
   * so the card renders as plain content instead of a dead link. */
  // Handle insight action clicks
  const handleInsightAction = (insight: AIInsight) => {
    const nav = insight.insightKey ? INSIGHT_NAV[insight.insightKey] : null;
    if (nav) {
      goToSection(nav.section, nav.hashQuery ? { hashQuery: nav.hashQuery } : undefined);
      return;
    }

    const action = insight.action.toLowerCase();

    // Map actions to navigation
    if (action.includes('campaign') || action.includes('win-back') || action.includes('στόχευση')) {
      goToSection('channels');
    } else if (action.includes('inventory') || action.includes('αναπλήρωση') || action.includes('ελέγξτε')) {
      goToSection('products');
    } else if (action.includes('sequence') || action.includes('setup')) {
      goToSection('strategy');
    } else {
      // Default: open AI Insights panel or navigate to relevant section
      goToSection('insights');
    }
  };
  /**
   * Month-over-month deltas for the headline figures.
   *
   * This used to be an IIFE inside the JSX, which meant nothing above the KPI row could see the
   * numbers it produced. The Signal Board prints the same deltas in three places — the hero card,
   * the KPI row and the "Σήμερα" line — so they are computed once, here.
   */
  const periodDeltas = useMemo(() => {
    const sortMonthKeys = (entries: [string, number][]) =>
      entries
        .filter(([k]) => k !== 'Other' && /^\d{4}-\d{2}$/.test(k))
        .sort((a, b) => a[0].localeCompare(b[0]));

    const revenueByMonth: Record<string, number> = {};
    const spendByMonth: Record<string, number> = {};
    const expensesByMonth: Record<string, number> = {};
    const convsValueByMonth: Record<string, number> = {};
    const convsByMonth: Record<string, number> = {};

    const kFromYm = periodDates.fromDate.slice(0, 7);
    const kToYm = periodDates.toDate.slice(0, 7);
    const usesAttributionFallback =
      !hasProcurementTurnoverEstimate && !hasErpRevenueForPeriod && !hasEcommerceRevenue;

    if (hasProcurementTurnoverEstimate && costing12m.sum > 0) {
      const dailyRate = costing12m.sum / 365;
      eachCalendarMonthInclusive(kFromYm, kToYm).forEach((ym) => {
        const days = daysInMonthIntersectingRange(ym, periodDates.fromDate, periodDates.toDate);
        if (days > 0) revenueByMonth[ym] = dailyRate * days;
      });
    } else if (hasErpRevenueForPeriod) {
      Object.entries(sumDailyRecordByMonthInPeriod(erpRevenueByDayRecord, periodDates.fromDate, periodDates.toDate)).forEach(([ym, val]) => {
        revenueByMonth[ym] = (revenueByMonth[ym] || 0) + val;
      });
    } else if (hasEcommerceRevenue) {
      Object.entries(sumDailyRecordByMonthInPeriod(ecommRevenueByDayRecord, periodDates.fromDate, periodDates.toDate)).forEach(([ym, val]) => {
        revenueByMonth[ym] = (revenueByMonth[ym] || 0) + val;
      });
    } else {
      Object.entries(sumDailyRecordByMonthInPeriod(ga4OrganicEffective, periodDates.fromDate, periodDates.toDate)).forEach(([ym, val]) => {
        revenueByMonth[ym] = (revenueByMonth[ym] || 0) + val;
      });
    }

    periodCampaigns.forEach((c) => {
      for (const [ym, val] of getCampaignMonthlyAttributedValueInPeriod(c as Campaign, periodDates.fromDate, periodDates.toDate)) {
        if (usesAttributionFallback) revenueByMonth[ym] = (revenueByMonth[ym] || 0) + val;
        convsValueByMonth[ym] = (convsValueByMonth[ym] || 0) + val;
      }
      const d = getCampaignDateForMonth(c as Campaign);
      const ymSpend = d ? monthKeyFromDate(d) : null;
      if (ymSpend) {
        spendByMonth[ymSpend] = (spendByMonth[ymSpend] || 0) + ((c as Campaign).amount_spent || 0);
        convsByMonth[ymSpend] = (convsByMonth[ymSpend] || 0) + ((c as Campaign).conversions || 0);
      }
    });

    // expensesByMonth = ad spend + marketing overhead, overhead computed per calendar month
    // (fixed_monthly full; percent_of_budget & one_off_month distributed) so MoM stays correct.
    new Set<string>([...Object.keys(spendByMonth), ...Object.keys(revenueByMonth)]).forEach((ym) => {
      const [yy, mm] = ym.split('-').map(Number);
      if (!yy || !mm) return;
      const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      const overheadMonth = computeMarketingOverheadForPeriod(
        activeStrategy?.marketingCostLines,
        activeStrategy?.monthlyBudget || 0,
        `${ym}-01`,
        `${ym}-${String(lastDay).padStart(2, '0')}`
      ).total;
      expensesByMonth[ym] = (spendByMonth[ym] || 0) + overheadMonth;
    });

    const calcMoM = (byMonth: Record<string, number>) => {
      const sorted = sortMonthKeys(Object.entries(byMonth));
      if (sorted.length < 2) return null;
      const prev = sorted[sorted.length - 2][1];
      const curr = sorted[sorted.length - 1][1];
      return prev > 0 ? ((curr - prev) / prev) * 100 : null;
    };

    const sortedRevenue = sortMonthKeys(Object.entries(revenueByMonth));
    const sortedConvVal = sortMonthKeys(Object.entries(convsValueByMonth));
    const sortedConvs = sortMonthKeys(Object.entries(convsByMonth));

    // AOV from real e-shop data (revenue/orders) avoids double-counting across Google Ads + Meta.
    // Fallback: campaign-attributed value/conversions only when there is no e-shop connection.
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

    return {
      revenueMoM: calcMoM(revenueByMonth),
      expensesMoM: calcMoM(expensesByMonth),
      aov,
      aovMoM: prevAov > 0 ? ((currAov - prevAov) / prevAov) * 100 : null,
      /** The comparison figure the hero card prints beside its delta. */
      previousMonthRevenue: sortedRevenue.length >= 2 ? sortedRevenue[sortedRevenue.length - 2][1] : null,
      hasEshopAov: hasEshop,
    };
  }, [
    activeStrategy?.marketingCostLines,
    activeStrategy?.monthlyBudget,
    campaignMetrics.totalConversions,
    campaignMetrics.totalRevenue,
    costing12m.sum,
    ecomm.hasData,
    ecommRevenueByDayRecord,
    enabledModules.ecommerce,
    erpRevenueByDayRecord,
    eshopAovInPeriod,
    ga4OrganicEffective,
    hasEcommerceRevenue,
    hasErpRevenueForPeriod,
    hasProcurementTurnoverEstimate,
    ordersInPeriod,
    periodCampaigns,
    periodDates.fromDate,
    periodDates.toDate,
  ]);
  const connectorStatuses = useConnectorStatuses();
  const [briefingDrawerOpen, setBriefingDrawerOpen] = useState(false);

  /** The dashboard draws its own 28/32px gutters, so it opts out of the shell's padded wrapper. */
  useFullBleedCanvas();

  const strategyName = activeStrategy ? getStrategyName(activeStrategy.scenarioId) : null;

  const deadStock = productIntelligence.aggregate?.summary?.dead_stock ?? null;
  /** What the board calls "δεσμευμένο κεφάλαιο": dead stock first, whole inventory as the fallback. */
  const tiedCapital = deadStock && deadStock.value > 0 ? deadStock.value : inventoryValueEstimate;

  /** Where the headline turnover figure actually came from, in four words. */
  const revenueSourceLabel = hasProcurementTurnoverEstimate
    ? 'εκτίμηση από κοστολόγηση 12μ.'
    : kpiUsesErp
      ? hasEcommerceRevenue
        ? 'παραστατικά ERP + e-shop'
        : 'παραστατικά ERP'
      : hasEcommerceRevenue
        ? 'παραγγελίες e-shop'
        : 'organic + καμπάνιες (εκτίμηση)';

  /**
   * The "Σήμερα" line: how many decisions are waiting, and the money the largest of them is
   * sitting on. Written from the same numbers the cards below print, never independently.
   */
  const todayLine = useMemo(() => {
    const pending = automationAlerts.filter((a) => a.status === 'new').length;
    if (pending === 0 && tiedCapital <= 0) return null;
    return { pending, tiedCapital };
  }, [automationAlerts, tiedCapital]);

  /** Evenly spaced ticks under a chart — first and last always land on a real data point. */
  const sampleTicks = (keys: string[], count: number): string[] => {
    if (keys.length === 0) return [];
    if (keys.length <= count) return keys.map(formatDashChartDateKeyTick);
    const step = (keys.length - 1) / (count - 1);
    return Array.from({ length: count }, (_, i) => formatDashChartDateKeyTick(keys[Math.round(i * step)]));
  };

  const revenueSeries = useMemo(() => revenueChartData.map((r) => r.total), [revenueChartData]);

  /** GA4 sessions mapped onto the revenue chart's x-axis, so the two lines share a timeline.
   *  Buckets GA4 has no data for stay null — the line stops there rather than the whole overlay
   *  disappearing, which is what a coverage threshold used to do. */
  const sessionsSeries = useMemo<(number | null)[]>(() => {
    if (ga4SessionsTrend.length === 0 || revenueChartData.length === 0) return [];
    // Past REVENUE_CHART_MAX_DAILY_POINTS the revenue chart buckets by calendar month and its keys
    // become YYYY-MM. GA4 is always daily, so it is folded onto whichever granularity the x-axis
    // is actually using — matching day keys against month keys would find nothing and drop the line.
    const monthlyBuckets = revenueChartData[0].dateKey.length === 7;
    const byKey = new Map<string, number>();
    for (const d of ga4SessionsTrend) {
      const key = monthlyBuckets ? d.dateKey.slice(0, 7) : d.dateKey;
      byKey.set(key, (byKey.get(key) ?? 0) + d.sessions);
    }
    const mapped = revenueChartData.map((r) => byKey.get(r.dateKey) ?? null);
    const first = mapped.findIndex((v) => v !== null);
    if (first === -1) return [];
    let lastKnownIndex = first;
    for (let i = mapped.length - 1; i > first; i--) {
      if (mapped[i] !== null) { lastKnownIndex = i; break; }
    }
    // Inside the covered span a missing day holds the previous value, so one unsynced day does not
    // punch a hole. Outside it the line simply does not exist — filling with zeroes there would
    // read as traffic collapsing rather than as data GA4 has not sent.
    let last = mapped[first] as number;
    return mapped.map((v, i) => {
      if (i < first || i > lastKnownIndex) return null;
      if (v === null) return last;
      last = v;
      return v;
    });
  }, [ga4SessionsTrend, revenueChartData]);

  const adsPoints = useMemo(
    () => adsPerformanceSeries.map((p) => ({ spend: p.adSpend, value: p.adConvValue, roas: p.roas })),
    [adsPerformanceSeries]
  );

  /** The board's segment palette, keyed off the RFM ids the analysis already emits. */
  const segmentRows = useMemo(() => {
    const palette: Record<string, { color: string; labelColor: string }> = {
      champions: { color: 'var(--success-700)', labelColor: 'var(--surface-0)' },
      loyal: { color: 'var(--sky-500)', labelColor: 'var(--surface-0)' },
      potential: { color: 'var(--seg-potential)', labelColor: 'var(--surface-0)' },
      at_risk: { color: 'var(--seg-at-risk)', labelColor: 'var(--navy-900)' },
      hibernating: { color: 'var(--seg-hibernating)', labelColor: 'var(--navy-900)' },
      lost: { color: 'var(--seg-lost)', labelColor: 'var(--surface-0)' },
    };
    const trendLabels: Record<string, { label: string; direction: Delta }> = {
      growing: { label: 'Άνοδος', direction: 'up' },
      stable: { label: 'Σταθερό', direction: 'flat' },
      declining: { label: 'Πτώση', direction: 'down' },
    };
    return dashboardRfmSegments.map((segment) => {
      const key = segment.id?.toLowerCase().replace(/[\s-]/g, '_') ?? '';
      const skin = palette[key] ?? { color: segment.color ?? 'var(--seg-lost)', labelColor: 'var(--surface-0)' };
      const trend = segment.predictive?.demand_trend
        ? trendLabels[segment.predictive.demand_trend]
        : null;
      return {
        id: segment.id,
        name: segment.name,
        percentage: segment.percentage ?? 0,
        customers: segment.count ?? 0,
        // revenue_share is a percentage of turnover, so the € figure is the period total scaled by
        // it — an apportionment, not a separately measured number. The title says so.
        revenue: ((segment.revenue_share ?? 0) / 100) * dashboardTotalRevenue,
        trend,
        ...skin,
      };
    });
  }, [dashboardRfmSegments, dashboardTotalRevenue]);

  /** Short forms for the top bar's period switch — the full labels do not fit four across. */

  const boardTabs: { id: string; label: string }[] = [
    { id: 'dashboard', label: 'Επισκόπηση' },
    { id: isB2B ? 'finances' : 'roi', label: 'Έσοδα' },
    { id: 'campaigns', label: 'Καμπάνιες' },
    { id: isB2B ? 'accounts' : 'rfm', label: 'Πελάτες' },
    { id: 'data', label: 'Δεδομένα' },
  ].filter((tab) => tab.id === 'dashboard' || !isSectionHidden(tab.id));

  const hasPeriodData =
    hasOrganic ||
    hasCampaigns ||
    hasEcommerceRevenue ||
    hasErpBusinessRevenue ||
    (enabledModules.procurement && costing12m.hasColumn && costing12m.sum > 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {/* ── Top bar contributions ─────────────────────────────────────────────────────────────── */}
      <ChromeTabRow tabs={boardTabs} current="dashboard" onSelect={goToSection} />

      <ChromeActions>
        {hasPeriodData && <ChromePeriodSwitch />}
        <NotificationBell variant="chip" onNavigate={(s) => onSectionChange?.(s)} />
        {currentBrand && (
          <button
            type="button"
            onClick={() => setBriefingDrawerOpen(true)}
            className="chrome-primary"
            style={{
              background: 'var(--gold-500)',
              color: 'var(--navy-900)',
              border: 'none',
              padding: '9px 16px',
              borderRadius: 8,
              fontFamily: MONO,
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Αποστολή briefing
          </button>
        )}
      </ChromeActions>

      {briefingDrawerOpen && (
        <BriefingDrawer
          strategyName={strategyName ?? 'Εμπορική πολιτική'}
          initialTitle={strategyName ? undefined : 'Briefing προς τμήματα'}
          onClose={() => setBriefingDrawerOpen(false)}
          onSent={() => setBriefingDrawerOpen(false)}
        />
      )}

      {/* ── "Σήμερα" ─────────────────────────────────────────────────────────────────────────── */}
      {todayLine && (
        <div style={{ padding: '20px 28px 6px', display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <SignalEyebrow style={{ fontSize: 10, letterSpacing: '0.16em', paddingTop: 4 }}>Σήμερα</SignalEyebrow>
          <span
            style={{
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.015em',
              lineHeight: 1.4,
              maxWidth: '78ch',
              textWrap: 'pretty',
            }}
          >
            {todayLine.pending > 0
              ? `${todayLine.pending} ${todayLine.pending === 1 ? 'σημείο ζητά' : 'σημεία ζητούν'} απόφαση`
              : 'Καμία εκκρεμής ειδοποίηση'}
            {todayLine.tiedCapital > 0 && (
              <>
                {' — το αδρανές απόθεμα δεσμεύει '}
                <span style={{ background: 'var(--gold-100)', padding: '0 5px' }}>
                  {formatCurrencyCompact(todayLine.tiedCapital)}
                </span>
              </>
            )}
          </span>
        </div>
      )}

      <PageCanvas>
        {/* ── Signals ────────────────────────────────────────────────────────────────────────── */}
        <SignalAlerts maxAlerts={3} onNavigate={onSectionChange} />

        {connectorSyncErrors.length > 0 && (
          <SignalCard accent="var(--gold-700)" padding={18} style={{ gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              Αποτυχημένος συγχρονισμός: {connectorSyncErrors.map((e) => e.name).join(', ')}
            </span>
            <button
              type="button"
              onClick={() => goToSection('data')}
              className="signal-link"
              style={{
                alignSelf: 'flex-start',
                border: 'none',
                background: 'transparent',
                padding: 0,
                cursor: 'pointer',
                fontSize: 13,
                color: 'var(--text-secondary)',
                textAlign: 'left',
              }}
            >
              Τα δεδομένα από {connectorSyncErrors.length === 1 ? 'αυτή τη σύνδεση' : 'αυτές τις συνδέσεις'} μπορεί να
              είναι ελλιπή. Δείτε λεπτομέρειες στις Συνδέσεις →
            </button>
          </SignalCard>
        )}

        {!currentBrand && (
          <SignalCard accent="var(--gold-700)" padding={20} style={{ gap: 10 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>Επιλέξτε εταιρικό brand</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              Για KPI και συγχρονισμένα δεδομένα, διαλέξτε brand από το μενού ή ανοίξτε τη διαχείριση brands.
            </span>
            <div>
              <PillButton tone="var(--orange-700)" active onClick={() => goToSection('brands')}>
                Διαχείριση brands
              </PillButton>
            </div>
          </SignalCard>
        )}

        {currentBrand && dashboardOverviewLoading && (
          <SignalCard padding={20} style={{ gap: 10 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>
              Σταθεροποίηση οικονομικών δεδομένων…
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              Φορτώνουμε ERP, e-shop και καμπάνιες πριν εμφανιστούν KPI και charts, ώστε το Dashboard να μη δείχνει
              προσωρινά νούμερα.
            </span>
            {/* Fixed-height stand-ins for the grid below, so nothing jumps when the data lands. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12, marginTop: 4 }}>
              <SignalSkeleton height={72} />
              <SignalSkeleton height={72} />
              <SignalSkeleton height={72} />
              <SignalSkeleton height={72} />
            </div>
          </SignalCard>
        )}

        {/* ── Hero, briefing, KPI row ────────────────────────────────────────────────────────── */}
        {currentBrand && !dashboardOverviewLoading && (
          <div className="dash-hero-grid">
            <SignalCard
              elevated
              padding={0}
              className="dash-hero-card"
              style={{ position: 'relative', overflow: 'hidden', minHeight: 260 }}
            >
              <HeroSpark values={revenueSeries} />
              <div style={{ position: 'relative', padding: 24, display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 11,
                      letterSpacing: '0.14em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {isB2B ? 'Revenue baseline' : 'Συνολικά έσοδα'}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tooltip content={revenueTotalKpiTooltip} size={13} />
                    {periodDeltas.revenueMoM !== null && (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: periodDeltas.revenueMoM >= 0 ? 'var(--success-700)' : 'var(--danger-700)',
                          background: periodDeltas.revenueMoM >= 0 ? 'var(--success-light)' : 'var(--danger-light)',
                          border: `1px solid ${periodDeltas.revenueMoM >= 0 ? 'var(--success-700)' : 'var(--danger-700)'}`,
                          padding: '4px 10px',
                          borderRadius: 999,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {periodDeltas.revenueMoM >= 0 ? '+' : '−'}
                        {formatNumber(Math.abs(periodDeltas.revenueMoM), 1)}%
                      </span>
                    )}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 'auto' }}>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontVariantNumeric: 'tabular-nums',
                      // Fluid, so the hero figure fills the card at 1440px without breaking out of
                      // it at 375px. The artboard's 64px is the ceiling.
                      fontSize: 'clamp(38px, 6vw, 64px)',
                      fontWeight: 700,
                      letterSpacing: '-0.04em',
                      color: 'var(--text-primary)',
                      lineHeight: 1,
                    }}
                  >
                    {formatCurrencyCompact(dashboardTotalRevenue)}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {periodDeltas.previousMonthRevenue !== null &&
                      `vs ${formatCurrencyCompact(periodDeltas.previousMonthRevenue)} προηγούμενου μήνα · `}
                    πηγή: {revenueSourceLabel}
                  </span>
                  {nonMerchSubtext && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{nonMerchSubtext}</span>
                  )}
                </div>
                {hasEcommerceRevenue && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
                      gap: 12,
                      borderTop: '1px solid var(--border)',
                      paddingTop: 16,
                    }}
                  >
                    <MetricTile label="Τζίρος e-shop" value={formatCurrencyCompact(storeRevenueInPeriod)} />
                    <MetricTile label="Παραγγελίες" value={formatNumber(ordersInPeriod)} />
                    <MetricTile label="AOV e-shop" value={formatCurrencyCompact(eshopAovInPeriod)} />
                  </div>
                )}
              </div>
            </SignalCard>

            {/* Briefing and the spend tile share one row, so they end up the same height. */}
            <div className="dash-briefing-row">
              <div style={{ display: 'flex', minWidth: 0 }}>
                {currentBrand ? (
                  <MorningBriefing
                    brandId={currentBrand.id}
                    brandName={currentBrand.name}
                    products={products}
                    campaigns={periodCampaigns}
                    segments={dashboardRfmSegments}
                    totalOrganicRevenue={organicRevenueInPeriod}
                    ga4={{ totals: ga4.totals, weeklyChange: ga4.weeklyChange, hasData: ga4.hasData }}
                    alerts={automationAlerts}
                    supplierTodMap={supplierTodMap}
                    metricsReady={briefingReady}
                    financeKey={briefingFinanceKey}
                    ecommerce={{
                      hasData: enabledModules.ecommerce && !!ecomm.hasData,
                      totalRevenue: storeRevenueInPeriod,
                      orderCount: ordersInPeriod,
                      aov: ordersInPeriod > 0 ? storeRevenueInPeriod / ordersInPeriod : ecomm.aov,
                      connectedPlatforms: ecomm.connectedPlatforms,
                      platformBreakdown: ecomm.platformBreakdown,
                      dataFreshness: {
                        latestPositiveRevenueDay: ecommLatestPositiveRevenueDay,
                        daysSinceLatestRevenue: ecommDaysSinceLatestRevenue,
                        aggregateSyncedHoursAgo: ecommAggregateSyncedHoursAgo,
                        suspectedSyncGap: hasSuspectedEcommSyncGap,
                      },
                    }}
                    onSectionChange={onSectionChange}
                    hasAnyData={hasAnyData}
                    period={dashPeriod}
                    periodLabel={
                      dashPeriod === 'custom'
                        ? `${periodDates.fromDate} — ${periodDates.toDate}`
                        : (GLOBAL_PERIOD_OPTIONS.find((o) => o.key === dashPeriod)?.label ?? 'Τρέχων Μήνας')
                    }
                  />
                ) : null}
              </div>

              <SignalCard padding={20} style={{ gap: 8 }}>
                <MetricTile
                  label={isB2B ? 'Demand spend' : 'Marketing expenses'}
                  size={30}
                  value={
                    hasCampaigns || marketingOverheadPeriod.total > 0
                      ? formatCurrencyCompact(totalMarketingExpenses)
                      : '€0'
                  }
                  note={
                    periodDeltas.expensesMoM !== null
                      ? `${periodDeltas.expensesMoM >= 0 ? '+' : '−'}${formatNumber(Math.abs(periodDeltas.expensesMoM), 1)}% vs προηγ. μήνα`
                      : campaignMetrics.cpa > 0
                        ? `CPA €${formatNumber(campaignMetrics.cpa, 1)}`
                        : '—'
                  }
                  // Spend climbing is not good news, so the delta inverts.
                  noteDirection={directionOf(periodDeltas.expensesMoM, false)}
                />
              </SignalCard>
            </div>

            <SignalCard padding={20} style={{ gap: 8 }}>
              <MetricTile
                label="Platform ROAS"
                size={30}
                value={campaignMetrics.roas > 0 ? `${formatNumber(campaignMetrics.roas, 2)}×` : '—'}
                valueColor={campaignMetrics.roas >= 1 ? 'var(--success-700)' : undefined}
                note={
                  campaignMetrics.totalSpend > 0
                    ? `${formatCurrencyCompact(campaignMetrics.totalRevenue)} από ${formatCurrencyCompact(campaignMetrics.totalSpend)}`
                    : 'χωρίς δαπάνη στην περίοδο'
                }
                noteDirection="flat"
              />
            </SignalCard>

            <SignalCard padding={20} style={{ gap: 8 }}>
              <MetricTile
                label={isB2B ? 'Demand conversions' : 'Μέσο καλάθι (AOV)'}
                size={30}
                value={
                  isB2B
                    ? formatNumber(campaignMetrics.totalConversions)
                    : periodDeltas.aov > 0
                      ? `€${formatNumber(periodDeltas.aov, 2)}`
                      : '—'
                }
                note={
                  isB2B
                    ? 'ενέργειες υψηλής πρόθεσης'
                    : periodDeltas.aovMoM !== null
                      ? `${periodDeltas.aovMoM >= 0 ? '+' : '−'}${formatNumber(Math.abs(periodDeltas.aovMoM), 1)}% vs προηγ. μήνα`
                      : periodDeltas.hasEshopAov
                        ? 'από παραγγελίες e-shop'
                        : 'από καμπάνιες'
                }
                noteDirection={isB2B ? 'flat' : directionOf(periodDeltas.aovMoM)}
              />
            </SignalCard>

            <SignalCard padding={20} style={{ gap: 8 }}>
              <MetricTile
                label="Δεσμευμένο κεφάλαιο"
                size={30}
                value={tiedCapital > 0 ? formatCurrencyCompact(tiedCapital) : '—'}
                note={
                  deadStock && deadStock.count > 0
                    ? `σε ${formatNumber(deadStock.count)} αδρανή SKUs`
                    : productsCount > 0
                      ? `σε ${formatNumber(productsCount)} SKUs`
                      : 'χωρίς δεδομένα αποθέματος'
                }
                noteDirection="flat"
              />
            </SignalCard>
          </div>
        )}

        {currentBrand && !dashboardOverviewLoading && !hasAnyData && (
          <SignalCard padding={20} style={{ gap: 10 }}>
            <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)' }}>
              {dashboardStillHydrating ? 'Φόρτωση δεδομένων πίνακα ελέγχου…' : 'Γεμίστε το Dashboard'}
            </span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {dashboardStillHydrating
                ? 'Συγχρονισμένα δεδομένα — φορτώνουμε e-shop, καμπάνιες και analytics…'
                : 'Δεν εμφανίζονται ακόμα τα στοιχεία που τροφοδοτούν τα κύρια charts (καμπάνιες, RFM από παραγγελίες ή προϊόντα). Συνδέστε πηγές ή κάντε εισαγωγή από το Data Import.'}
            </span>
            {!dashboardStillHydrating && !isSectionHidden('data') && (
              <div>
                <PillButton tone="var(--orange-700)" active onClick={() => goToSection('data')}>
                  Data Import
                </PillButton>
              </div>
            )}
          </SignalCard>
        )}

        {/* ── Revenue Performance ────────────────────────────────────────────────────────────── */}
        {!dashboardOverviewLoading && hasAnyData && revenueSeries.length > 1 && (
          <SignalCard style={{ gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
              <SignalCardHeader eyebrow="Revenue Performance" title={revenuePerformanceChartLabel} />
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 18,
                  fontFamily: MONO,
                  fontSize: 10.5,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  flexWrap: 'wrap',
                }}
              >
                <LegendKey color="var(--orange-500)">Τζίρος</LegendKey>
                {sessionsSeries.length > 0 && <LegendKey color="var(--sky-500)">Sessions</LegendKey>}
              </div>
            </div>

            {ga4TotalsInPeriod.hasData && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 16 }}>
                <MetricTile
                  label="Sessions"
                  size={22}
                  value={formatNumber(ga4TotalsInPeriod.sessions)}
                  note={
                    ga4.weeklyChange?.sessions != null
                      ? `${ga4.weeklyChange.sessions >= 0 ? '+' : '−'}${formatNumber(Math.abs(ga4.weeklyChange.sessions), 1)}% vs προηγ. 7ημ.`
                      : undefined
                  }
                  noteDirection={directionOf(ga4.weeklyChange?.sessions)}
                />
                <MetricTile
                  label="Χρήστες"
                  size={22}
                  value={formatNumber(ga4TotalsInPeriod.users)}
                  note={
                    ga4.weeklyChange?.users != null
                      ? `${ga4.weeklyChange.users >= 0 ? '+' : '−'}${formatNumber(Math.abs(ga4.weeklyChange.users), 1)}%`
                      : undefined
                  }
                  noteDirection={directionOf(ga4.weeklyChange?.users)}
                />
                <MetricTile label="Νέοι χρήστες" size={22} value={formatNumber(ga4TotalsInPeriod.newUsers)} />
                <MetricTile
                  label="Conversions"
                  size={22}
                  value={formatNumber(ga4TotalsInPeriod.conversions)}
                  note={
                    ga4.weeklyChange?.conversions != null
                      ? `${ga4.weeklyChange.conversions >= 0 ? '+' : '−'}${formatNumber(Math.abs(ga4.weeklyChange.conversions), 1)}%`
                      : undefined
                  }
                  noteDirection={directionOf(ga4.weeklyChange?.conversions)}
                />
                <MetricTile
                  label="Bounce rate"
                  size={22}
                  value={formatPercent(ga4TotalsInPeriod.bounceRate * 100, 1)}
                />
                <MetricTile
                  label="Conv. rate"
                  size={22}
                  value={
                    ga4TotalsInPeriod.sessions > 0
                      ? formatPercent((ga4TotalsInPeriod.conversions / ga4TotalsInPeriod.sessions) * 100, 2)
                      : '—'
                  }
                />
              </div>
            )}

            <div style={{ position: 'relative', borderTop: '1px solid var(--border)', paddingTop: 18 }}>
              <RevenueTrendChart revenue={revenueSeries} sessions={sessionsSeries} />
              <AxisTicks ticks={sampleTicks(revenueChartData.map((r) => r.dateKey), 8)} />
            </div>
          </SignalCard>
        )}

        {/* ── Segments · Campaigns ───────────────────────────────────────────────────────────── */}
        {!dashboardOverviewLoading && hasAnyData && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(420px,1fr))', gap: 16 }}>
            <SignalCard style={{ gap: 18 }}>
              <SignalCardHeader eyebrow="Customer Segments" title="Μερίδιο πελατών ανά RFM segment" />
              {showSegmentsEmptyState ? (
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  {aggregateStatus === 'running'
                    ? 'Η μηνιαία ανάλυση εκτελείται αυτή τη στιγμή…'
                    : 'Δεν υπάρχει πρόσφατη μηνιαία ανάλυση πελατών. Η ανάλυση RFM εκτελείται αυτόματα κάθε μήνα.'}
                </span>
              ) : (
                <>
                  <SegmentShareBar segments={segmentRows} />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    {segmentRows.map((segment) => (
                      <div
                        key={segment.id}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 10,
                          padding: '11px 0',
                          borderTop: '1px solid var(--border)',
                        }}
                      >
                        <span style={{ width: 11, height: 11, borderRadius: 3, display: 'block', background: segment.color, flex: 'none' }} />
                        <span style={{ flex: '1 1 96px', minWidth: 0, fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {segment.name}
                        </span>
                        <span style={{ flex: '0 0 auto', width: 58, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--text-primary)', textAlign: 'right' }}>
                          {formatNumber(segment.customers)}
                        </span>
                        <span
                          title="Μερίδιο του segment επί του τζίρου της περιόδου, εφαρμοσμένο στο συνολικό ποσό"
                          style={{ flex: '0 0 auto', width: 70, fontFamily: MONO, fontVariantNumeric: 'tabular-nums', fontSize: 12.5, color: 'var(--text-primary)', textAlign: 'right' }}
                        >
                          {formatCurrencyCompact(segment.revenue)}
                        </span>
                        <span
                          style={{
                            flex: '0 0 auto',
                            width: 62,
                            fontFamily: MONO,
                            fontSize: 12,
                            fontWeight: 700,
                            textAlign: 'right',
                            color: deltaColor(segment.trend?.direction ?? 'flat'),
                          }}
                        >
                          {segment.trend?.label ?? '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {showSegmentsStaleSourceNote && (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Πηγή: εισαγωγή segments — δεν υπάρχει πρόσφατη μηνιαία ανάλυση RFM.
                    </span>
                  )}
                </>
              )}
              {!isSectionHidden('rfm') && (
                <button
                  type="button"
                  onClick={() => goToSection('rfm')}
                  className="signal-link"
                  style={{
                    alignSelf: 'flex-start',
                    marginTop: 'auto',
                    border: 'none',
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    fontFamily: MONO,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: 'var(--sky-500)',
                  }}
                >
                  Πλήρης RFM ανάλυση →
                </button>
              )}
            </SignalCard>

            <SignalCard style={{ gap: 18 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
                <SignalCardHeader eyebrow="Campaigns" title="Google Ads + Meta Ads" />
                <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
                  <MetricTile label="Δαπάνη" value={formatCurrencyCompact(campaignMetrics.totalSpend)} />
                  <MetricTile label="Conv. value" value={formatCurrencyCompact(campaignMetrics.totalRevenue)} />
                  <MetricTile
                    label="Platform ROAS"
                    value={campaignMetrics.roas > 0 ? `${formatNumber(campaignMetrics.roas, 2)}×` : '—'}
                    valueColor={campaignMetrics.roas >= 1 ? 'var(--success-700)' : undefined}
                  />
                </div>
              </div>

              {adsPoints.length > 0 ? (
                <>
                  {/* The neighbouring segments card is a table, so this one is usually the shorter of
                      the pair and the grid stretches it. The chart takes that slack rather than
                      leaving it as white space under the legend. */}
                  <div style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
                    <AdsPerformanceChart points={adsPoints} />
                    <AxisTicks ticks={sampleTicks(adsPerformanceSeries.map((p) => p.dateKey), Math.min(6, adsPoints.length))} />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 20,
                      borderTop: '1px solid var(--border)',
                      paddingTop: 14,
                      fontFamily: MONO,
                      fontSize: 10.5,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--text-muted)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <LegendKey color="var(--sky-500)" shape="block">Δαπάνη</LegendKey>
                    <LegendKey color="var(--orange-500)" shape="block">Conversion value</LegendKey>
                    <LegendKey color="var(--navy-500)">Platform ROAS</LegendKey>
                  </div>
                </>
              ) : (
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  Δεν υπάρχουν συγχρονισμένες καμπάνιες για την επιλεγμένη περίοδο.
                </span>
              )}
            </SignalCard>
          </div>
        )}

        {/* ── Insights · Status ──────────────────────────────────────────────────────────────── */}
        {!dashboardOverviewLoading && hasAnyData && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(420px,1fr))', gap: 16 }}>
            <SignalCard style={{ gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
                <SignalCardHeader eyebrow="AI Insights" title="Σύντομες, εφαρμόσιμες συστάσεις" />
                {onOpenInsights && (
                  <button
                    type="button"
                    onClick={() => onOpenInsights()}
                    className="signal-link"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      padding: 0,
                      cursor: 'pointer',
                      fontFamily: MONO,
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: 'var(--sky-500)',
                    }}
                  >
                    Όλες ({aiInsights.length}) →
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {aiInsights.slice(0, 4).map((insight, index) => {
                  const tone = insight.type === 'warning' ? 'var(--orange-700)' : 'var(--sky-500)';
                  return (
                    <div
                      key={insight.insightKey ?? index}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 12,
                        background: 'var(--surface-2)',
                        borderRadius: 10,
                        padding: '13px 16px',
                      }}
                    >
                      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: tone, flex: 'none' }}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{insight.title}</span>
                        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          {insight.insight}
                        </span>
                      </div>
                      <span
                        style={{
                          flex: '0 0 auto',
                          width: 76,
                          fontFamily: MONO,
                          fontSize: 13.5,
                          fontWeight: 700,
                          color: 'var(--text-primary)',
                          textAlign: 'right',
                          textTransform: 'capitalize',
                        }}
                      >
                        {insight.impact === 'high' ? 'Υψηλό' : insight.impact === 'medium' ? 'Μεσαίο' : 'Χαμηλό'}
                      </span>
                      <PillButton onClick={() => handleInsightAction(insight)}>Εφαρμογή</PillButton>
                    </div>
                  );
                })}
                {aiInsights.length === 0 && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                    Δεν υπάρχουν ακόμα συστάσεις για την επιλεγμένη περίοδο.
                  </span>
                )}
              </div>
            </SignalCard>

            <SignalCard style={{ gap: 18 }}>
              <SignalCardHeader eyebrow="Κατάσταση" title="Ενεργή στρατηγική και δεδομένα" />
              <button
                type="button"
                onClick={() => goToSection('strategy')}
                className="signal-strategy"
                style={{
                  background: 'var(--navy-500)',
                  borderRadius: 12,
                  border: 'none',
                  padding: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  textAlign: 'left',
                  cursor: isSectionHidden('strategy') ? 'default' : 'pointer',
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--navy-100)',
                  }}
                >
                  Ενεργή στρατηγική
                </span>
                <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--surface-0)', letterSpacing: '-0.02em' }}>
                  {strategyName ?? 'Δεν έχει οριστεί'}
                </span>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    flexWrap: 'wrap',
                    fontFamily: MONO,
                    fontSize: 10.5,
                    color: 'var(--navy-100)',
                  }}
                >
                  {activeStrategy?.approvalStatus === 'implementing' && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--gold-500)', display: 'block' }} />
                      ενεργή
                    </span>
                  )}
                  {activeStrategy?.weights && Object.keys(activeStrategy.weights).length > 0 && (
                    <span>
                      βάρη: {Object.values(activeStrategy.weights).map((w) => Math.round(w)).join('/')}
                    </span>
                  )}
                </span>
              </button>

              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {connectorStatuses.map((source) => {
                  const chip =
                    source.state === 'ok'
                      ? { label: 'Συνδεδεμένο', tone: 'var(--success-700)', background: 'var(--success-light)' }
                      : source.state === 'stale'
                        ? { label: 'Εκκρεμεί', tone: 'var(--gold-700)', background: 'var(--gold-100)' }
                        : { label: 'Σφάλμα', tone: 'var(--danger-600)', background: 'var(--danger-light)' };
                  return (
                    <div
                      key={source.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0,1fr) auto',
                        gap: 12,
                        alignItems: 'center',
                        padding: '11px 0',
                        borderTop: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text-primary)' }}>{source.name}</span>
                        <span style={{ fontFamily: MONO, fontSize: 10.5, color: 'var(--text-muted)' }}>
                          {source.lastSyncAt
                            ? `συγχρονισμός ${new Date(source.lastSyncAt).toLocaleString('el-GR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                            : 'χωρίς καταγεγραμμένο συγχρονισμό'}
                        </span>
                      </div>
                      <SignalChip tone={chip.tone} background={chip.background}>
                        {chip.label}
                      </SignalChip>
                    </div>
                  );
                })}
                {connectorStatuses.length === 0 && (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55, paddingTop: 4 }}>
                    Δεν υπάρχουν συνδεδεμένες πηγές δεδομένων.
                  </span>
                )}
              </div>
            </SignalCard>
          </div>
        )}
      </PageCanvas>
    </div>
  );
}
