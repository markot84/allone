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
  Plug,
  Package,
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
} from 'recharts';
import { Card, CardHeader, KPICard, Tooltip, AlertsBanner, PageHeader, Spinner, Button } from '../common';
import { useSegments } from '../../hooks/useSegments';
import { useOrganic } from '../../hooks/useOrganic';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useBrand } from '../../hooks/useBrand';
import { useProductAggregates, useSegmentAggregates } from '../../hooks/useAggregates';
import { useProductIntelligenceAggregate } from '../../hooks/useProductIntelligenceAggregate';
import { usePeriodScopedCampaigns } from '../../hooks/usePeriodScopedCampaigns';
import { useTasks } from '../../hooks/useCoordination';
import { useDashPeriod } from '../../hooks/useDashPeriod';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { DateRangePicker } from '../ui/DateRangePicker';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useEcommerceFullHistoryMetrics } from '../../hooks/useEcommerceFullHistoryMetrics';
import { useBusinessRevenueSummary } from '../../hooks/useBusinessRevenueSummary';
import { useProcurement } from '../../hooks/useProcurement';
import { useHREmployees } from '../../hooks/useHRData';
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
import { StrategyBriefingQuickStrip } from '../coordination/StrategyBriefingQuickStrip';
import { eachDateInclusiveLocal, computeMarketingOverheadForPeriod } from '../../utils/marketingCostPeriod';
import { getCostingReal12mTurnover } from '../../utils/procurement12mTurnover';
import { coerceToDate } from '../../utils/coerceDate';
import { INSIGHT_NAV } from '../insights/aiInsightsConfig';
import type { AIInsight } from '../../types';

/** Ημερήσια σημεία στο chart· πάνω από αυτό → μηνιαία σύνοψη (αναγνώσιμο άξονα). */
const REVENUE_CHART_MAX_DAILY_POINTS = 90;

/** Revenue Performance — κύριο chart τζίρου. Ακολουθεί το accent theme ώστε όλες οι τάσεις
 *  (e-commerce spark, GA4 spark, revenue chart) να έχουν ΕΝΙΑΙΟ χρώμα με το επιλεγμένο theme. */
const REV_CHART_ESHOP = 'var(--nts-accent)';

const REV_PERF_LABEL_ESHOP = 'Τζίρος e-shop (παραγγελίες)';
const REV_PERF_LABEL_ESHOP_BLEND = 'Organic + καμπάνιες (εκτίμηση)';
const DASHBOARD_LOADING_TIMEOUT_MS = 1800;
const FINANCIAL_GATE_TIMEOUT_MS = 1800;
const BRIEFING_CONTEXT_TIMEOUT_MS = 6000;
/** Διαφήμιση — standalone efficiency chart (όχι σύγκριση με τζίρο). */
const ADS_SPEND_COLOR = '#FDBA74';
// Σταθερό (όχι accent): το ads efficiency chart είναι multi-series — αν ακολουθούσε το accent
// θα συγκρουόταν με το ADS_SPEND_COLOR.
const ADS_CONV_COLOR = '#F97316';
const ADS_ROAS_COLOR = '#64748B';

/** Chart series values are full EUR; axis shows K when ≥ €1.000 (tooltip uses formatCurrencyCompact on same basis). */
function formatRevenueChartYAxisTick(value: number): string {
  const v = Number(value);
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1000) return `€${formatNumber(v / 1000, 1)}K`;
  return `€${formatNumber(v, 0)}`;
}

/** Άξονας X: μοναδικό κλειδί ανά ημέρα/μήνα (αποφυγή collisions από `toLocaleDateString` στο Recharts). */
function formatDashChartDateKeyTick(dateKey: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return formatTrendDayLabel(dateKey);
  if (/^\d{4}-\d{2}$/.test(dateKey)) return formatMonthKeyShort(dateKey);
  return dateKey;
}

/** ERP chart: πλήρης ημερήσια σειρά περιόδου, χωρίς interpolation/forward-fill. Missing day = €0. */
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

/** Το Recharts Area χρειάζεται ≥2 σημεία· αν υπάρχει 1 μήνας μόνο, διπλασιάζουμε για ορατή γραμμή. */
function padSparklineForChart(values: number[]): number[] {
  if (values.length === 0) return [];
  if (values.length === 1) return [values[0], values[0]];
  return values;
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
  const { segments: rfmSegments, hasImported: hasSegments, isLoading: segmentsLoading } = useSegments({
    skipOrderHydration: true,
  });
  const { segmentStats } = useSegmentAggregates();
  const lastGoodRfmSegmentsRef = useRef<{ brandId: string | null; segments: typeof rfmSegments }>({
    brandId: null,
    segments: [],
  });
  const productIntelligence = useProductIntelligenceAggregate('all', 1, { pageSize: 150 });
  const products = productIntelligence.page?.products ?? [];
  const { productStats } = useProductAggregates();
  const { suppliers } = useSuppliers();
  const { tasks } = useTasks();
  const { activeEmployees, totalMonthlyCost } = useHREmployees();
  const { totalOrganicRevenue, byMonth: organicByMonth, hasOrganicRevenue: hasOrganic, isLoading: organicLoading } = useOrganic();
  const { count: campaignsCount, campaigns, hasImported: hasCampaigns, isLoading: campaignsLoading } = useCampaigns();
  const { activeStrategy, getStrategyName } = useActiveStrategy();
  useAutomationRunner();
  const ga4 = useGA4Data();
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  /**
   * Dashboard: μόνο server summary (`ecommerce_summary`) — γρήγορο, ένα Firestore read.
   * Το `full` mode κατέβαζε όλο το ιστορικό orders παράλληλα με το `useSegments` 400ήμερο fetch
   * → πάγωμα του main thread σε brands με 10K+ orders. Η ακρίβεια του summary εξασφαλίζεται
   * μέσω `refreshAggregates` μετά από αλλαγή Sales Channel Rules / Revenue Source.
   */
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

  const supplierTodMap = useMemo(() => {
    const m = new Map<string, number>();
    suppliers.forEach(s => m.set(s.name, s.tod));
    return m;
  }, [suppliers]);
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

  /**
   * Τα ecom KPIs ξεκινούν με τιμές από το server summary (1 Firestore read, instant) και
   * αντικαθίστανται από client-side raw aggregates μόλις φορτωθούν τα orders. Όσο διαρκεί
   * αυτό το second pass, εμφανίζουμε pulsing dot στα affected cards για να ξέρει ο user
   * ότι το νούμερο ίσως ενημερωθεί ελαφρώς.
   */
  const ecomKpisRefreshing = ecommerceRawBusy && ecommHist.source === 'summary';

  /**
   * Financial gate: μόνο στο πρώτο load χωρίς usable data.
   * Background refetches δεν πρέπει να κρύβουν όλο το Dashboard, γιατί δημιουργούν εκνευριστικό flicker.
   */
  const rawFinancialSourcesLoading =
    Boolean(currentBrand) &&
    (businessRevenue.isLoading ||
      ecomm.isLoading ||
      campaignsLoading ||
      organicLoading ||
      (enabledModules.procurement && procurementSheets.isLoading));
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

  /**
   * Το Dashboard κάνει progressive render γρήγορα, αλλά το AI Briefing ΔΕΝ πρέπει να γράφεται
   * πριν φορτώσουν τα κρίσιμα inputs. Αλλιώς μπορεί να δει προσωρινά campaigns=[] και να πει
   * λάθος ότι δεν υπάρχει διαφημιστική δαπάνη.
   */
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
  /** Μην δείχνουμε «κάντε import» όσο ακόμα φορτώνουν e-shop / καμπάνιες / GA4. */
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

  const { period: dashPeriod, setPeriod: setDashPeriod, periodDates } = useDashPeriod();
  const { customFrom, customTo, setCustomRange } = useGlobalDate();

  const periodCampaigns = usePeriodScopedCampaigns(campaignsTyped, periodDates);

  const campaignMetrics = useMemo(() => calculateCampaignMetrics(periodCampaigns), [periodCampaigns]);

  /**
   * Marketing overhead = επιπλέον κόστη marketing εκτός ad spend (agency retainers, tools, one-off)
   * όπως δηλωμένα στο active strategy. Μπαίνουν στο KPI «Marketing Expenses» μαζί με το ad spend
   * ώστε ο owner να βλέπει συνολική marketing δαπάνη (όχι μόνο media), συνεπές με τη σελίδα ROI.
   */
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

  // Παραγγελίες περιόδου: πρώτα από summary, μετά από raw aggregates όταν φορτώσουν (hybrid · ίδιο με τζίρο/AOV).
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

  /**
   * ERP wins only when its daily coverage is current for the selected period.
   * If e-shop has revenue after the latest ERP day, ERP summary is stale/incomplete for this view.
   */
  const hasErpRevenueForPeriod = hasErpBusinessRevenue && erpRevenueInPeriod > 0 && erpDailyCoverageIsCurrentForPeriod;

  const hasProcurementTurnoverEstimate = procurementRevenueInPeriod > 0;

  /**
   * «Σύνολο Εσόδων» (Dashboard): Procurement (Enterprise) → ERP → e-shop → organic + καμπάνιες.
   * Procurement έχει ΠΑΝΤΑ προτεραιότητα όταν υπάρχουν δεδομένα κοστολόγησης 12μ.
   */
  const dashboardTotalRevenue = useMemo(() => {
    if (hasProcurementTurnoverEstimate) return procurementRevenueInPeriod;
    if (hasErpRevenueForPeriod) return erpRevenueInPeriod;
    if (hasEcommerceRevenue) return storeRevenueInPeriod;
    return organicRevenueInPeriod + campaignMetrics.totalRevenue;
  }, [
    hasProcurementTurnoverEstimate,
    procurementRevenueInPeriod,
    hasErpRevenueForPeriod,
    erpRevenueInPeriod,
    hasEcommerceRevenue,
    storeRevenueInPeriod,
    organicRevenueInPeriod,
    campaignMetrics.totalRevenue,
  ]);

  const dashboardRevenueSourceLabel = hasProcurementTurnoverEstimate
    ? 'Κοστολόγηση · Πραγματικός τζίρος 12μ. (εκτίμηση περιόδου)'
    : hasErpRevenueForPeriod
      ? 'ERP'
      : hasEcommerceRevenue
        ? 'E-shop connectors'
        : 'Organic + καμπάνιες (εκτίμηση)';

  const revenueTotalKpiTooltip = useMemo(() => {
    if (isB2B) {
      return 'Βασική εικόνα εσόδων από οργανική ζήτηση και demand generation. Για πλήρη αποτύπωση εσόδων ανά account απαιτείται invoicing ή ERP import.';
    }
    const tail = ' Λεπτομέρειες e-shop / ROAS στη σελίδα ROI · οικονομική εικόνα στα Οικονομικά.';
    if (hasProcurementTurnoverEstimate) {
      return (
        `Πηγή: ${dashboardRevenueSourceLabel}. Procurement έχει προτεραιότητα (Enterprise): άθροισμα «Πραγματικός τζίρος 12μ.» κατανεμημένο ανά ημέρα περιόδου (÷365). Ακόμα κι αν υπάρχει ERP, εμφανίζεται ο τζίρος procurement.` +
        tail
      );
    }
    if (hasErpRevenueForPeriod) {
      return `Πηγή: ${dashboardRevenueSourceLabel}. Συνολικά παραστατικά ERP — περιλαμβάνει φυσικά καταστήματα, B2B και online πωλήσεις όπως καταγράφονται στο ERP.` + tail;
    }
    if (enabledModules.procurement) {
      return (
        `Πηγή ${dashboardRevenueSourceLabel}. Προτεραιότητα: Κοστολόγηση 12μ. (Enterprise) · αλλιώς παραστατικά ERP · αλλιώς τζίρος e-shop · αλλιώς organic και καμπάνιες.` +
        tail
      );
    }
    return (
      `Πηγή ${dashboardRevenueSourceLabel}. Προτεραιότητα: παραστατικά ERP · αλλιώς τζίρος e-shop · αλλιώς εκτίμηση organic και καμπάνιες.` +
      tail
    );
  }, [isB2B, hasProcurementTurnoverEstimate, hasErpRevenueForPeriod, enabledModules.procurement, dashboardRevenueSourceLabel]);

  const revenuePerformanceChartLabel = hasProcurementTurnoverEstimate
    ? 'Τζίρος επιχείρησης (Procurement · εκτίμηση 12μ.)'
    : hasErpRevenueForPeriod
      ? 'Τζίρος επιχείρησης (ERP)'
      : enabledModules.ecommerce && ecomm.hasData
        ? REV_PERF_LABEL_ESHOP
        : REV_PERF_LABEL_ESHOP_BLEND;

  /** Fingerprint για επαναλαμβανόμενο έλεγχο AI briefing vs KPI. */
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
   * Κύριο chart — μία σειρά τζίρου (ίδια προτεραιότητα με το KPI «Σύνολο Εσόδων»):
   * ERP → (Enterprise) εκτίμηση Κοστολόγησης → e-shop → organic + καμπάνιες.
   */
  const revenueChartData = useMemo(() => {
    const { fromDate, toDate } = periodDates;
    const dayCount = eachDateInclusiveLocal(fromDate, toDate).length;
    if (dayCount === 0) return [];

    if (hasProcurementTurnoverEstimate && costing12m.sum > 0) {
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

    if (hasErpRevenueForPeriod) {
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
    hasProcurementTurnoverEstimate,
    costing12m.sum,
    hasErpRevenueForPeriod,
    erpRevenueByDayRecord,
  ]);

  /** Ημερήσια ή μηνιαία σειρά για chart διαφήμισης (δαπάνη + conversion value + ROAS από synced campaigns). */
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
      console.debug('[Dashboard] Organic revenue:', totalOrganicRevenue, 'hasOrganic:', hasOrganic);
    }
  }, [totalOrganicRevenue, hasOrganic]);
  const { aiInsights } = useAiInsightsData();

  // Handle insight action clicks
  const handleInsightAction = (insight: AIInsight) => {
    const nav = insight.insightKey ? INSIGHT_NAV[insight.insightKey] : null;
    if (nav) {
      onSectionChange?.(nav.section, nav.hashQuery ? { hashQuery: nav.hashQuery } : undefined);
      return;
    }

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
    let ro: ResizeObserver | null = null;
    let rafId = 0;
    let cancelled = false;

    const measure = () => {
      rafId = 0;
      if (cancelled) return;
      setChartDimensions((prev) => {
        let revenueW = prev.revenue.width;
        let segmentW = prev.segment.width;
        if (revenueContainerRef.current) {
          const w = Math.round(revenueContainerRef.current.getBoundingClientRect().width);
          if (w > 0) revenueW = Math.max(1, w);
        }
        if (segmentContainerRef.current) {
          const w = Math.round(segmentContainerRef.current.getBoundingClientRect().width);
          if (w > 0) segmentW = Math.max(1, w);
        }
        // Κρίσιμο: χωρίς early return το Recharts + ResizeObserver δημιουργούν feedback loop (freeze).
        if (revenueW === prev.revenue.width && segmentW === prev.segment.width) return prev;
        return {
          revenue: { width: revenueW, height: 288 },
          segment: { width: segmentW, height: 224 },
        };
      });
    };

    const scheduleMeasure = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(measure);
    };

    ro = new ResizeObserver(scheduleMeasure);
    if (revenueContainerRef.current) ro.observe(revenueContainerRef.current);
    if (segmentContainerRef.current) ro.observe(segmentContainerRef.current);
    const t = window.setTimeout(scheduleMeasure, 0);
    scheduleMeasure();

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      if (rafId) cancelAnimationFrame(rafId);
      ro?.disconnect();
    };
  }, [hasAnyData, revenueChartData.length, isB2B, dashboardHasSegments]);

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

      {!currentBrand && (
        <Card padding="lg" className="border border-amber-200 bg-amber-50/70">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                <Building2 size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-[var(--nts-charcoal)]">Επιλέξτε εταιρικό brand</h3>
                <p className="mt-1 text-xs leading-relaxed text-[var(--nts-medium-gray)]">
                  Για KPI και συγχρονισμένα δεδομένα, διαλέξτε brand από το μενού ή ανοίξτε τη διαχείριση brands.
                </p>
              </div>
            </div>
            <Button variant="primary" size="sm" className="w-full shrink-0 sm:w-auto" onClick={() => onSectionChange?.('brands')}>
              Διαχείριση brands
            </Button>
          </div>
        </Card>
      )}

      {/* Quick briefing — πάντα με brand, και χωρίς ενεργή στρατηγική */}
      {currentBrand && (
        <StrategyBriefingQuickStrip
          hasActiveStrategy={!!activeStrategy}
          strategyDisplayName={
            activeStrategy ? getStrategyName(activeStrategy.scenarioId) : 'Εμπορική πολιτική'
          }
        />
      )}

      {currentBrand && dashboardOverviewLoading && (
        <Card padding="lg" className="border border-[#E8EAED] bg-white">
          <div className="flex gap-4 items-start">
            <Spinner size="md" className="shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[var(--nts-charcoal)]">Σταθεροποίηση οικονομικών δεδομένων…</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--nts-medium-gray)]">
                Φορτώνουμε ERP, e-shop και καμπάνιες πριν εμφανιστούν KPI και charts, ώστε το Dashboard να μη δείχνει προσωρινά νούμερα.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Morning Briefing */}
      {currentBrand && !dashboardOverviewLoading && (
        <MorningBriefing
          brandId={currentBrand.id}
          brandName={currentBrand.name}
          products={products}
          campaigns={periodCampaigns}
          segments={dashboardRfmSegments}
          totalOrganicRevenue={organicRevenueInPeriod}
          ga4={{
            totals: ga4.totals,
            weeklyChange: ga4.weeklyChange,
            hasData: ga4.hasData,
          }}
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
          periodLabel={dashPeriod === 'custom' ? `${periodDates.fromDate} — ${periodDates.toDate}` : (GLOBAL_PERIOD_OPTIONS.find(o => o.key === dashPeriod)?.label ?? 'Τρέχων Μήνας')}
        />
      )}

      {currentBrand && !dashboardOverviewLoading && !hasAnyData && (
        dashboardStillHydrating ? (
          <Card padding="lg" className="border border-[#E8EAED] bg-white">
            <div className="flex gap-4 items-start">
              <Spinner size="md" className="shrink-0" />
              <motion.div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--nts-charcoal)]">Φόρτωση δεδομένων πίνακα ελέγχου…</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--nts-medium-gray)]">
                  Συγχρονισμένα δεδομένα — φορτώνουμε e-shop, καμπάνιες και analytics…
                </p>
              </motion.div>
            </div>
          </Card>
        ) : (
          <Card padding="lg" className="border border-dashed border-[#D1D5DB] bg-[#FAFAFA]">
            <h3 className="text-base font-semibold text-[var(--nts-charcoal)]">Γεμίστε το Dashboard</h3>
            <p className="mt-1 text-sm leading-relaxed text-[var(--nts-medium-gray)]">
              Δεν εμφανίζονται ακόμα τα στοιχεία που τροφοδοτούν τα κύρια charts (καμπάνιες, RFM από παραγγελίες ή προϊόντα). Συνδέστε πηγές ή κάντε εισαγωγή από το Data Import.
            </p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {enabledModules.data && (
                <Button
                  variant="secondary"
                  className="justify-center"
                  icon={<Plug size={16} />}
                  onClick={() => onSectionChange?.('data')}
                >
                  Data Import
                </Button>
              )}
              {enabledModules.ecommerce && (
                <Button
                  variant="secondary"
                  className="justify-center"
                  icon={<ShoppingBag size={16} />}
                  onClick={() => onSectionChange?.('ecommerce')}
                >
                  E-commerce
                </Button>
              )}
              {enabledModules.rfm && (
                <Button variant="secondary" className="justify-center" icon={<Target size={16} />} onClick={() => onSectionChange?.('rfm')}>
                  RFM & segments
                </Button>
              )}
              {enabledModules.products && (
                <Button variant="secondary" className="justify-center" icon={<Package size={16} />} onClick={() => onSectionChange?.('products')}>
                  Προϊόντα & stock
                </Button>
              )}
            </div>
          </Card>
        )
      )}

      {/* Global period selector — applies to all period-aware dashboard cards/charts */}
      {!dashboardOverviewLoading && (hasOrganic ||
        hasCampaigns ||
        hasEcommerceRevenue ||
        hasErpBusinessRevenue ||
        (enabledModules.procurement && costing12m.hasColumn && costing12m.sum > 0)) && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="-mx-1 max-w-full overflow-x-auto pb-1 sm:mx-0 sm:overflow-visible sm:pb-0">
          <div className="flex w-max min-w-0 items-center gap-1 rounded-lg bg-gray-100 p-1 sm:w-auto">
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

      {isB2B && !dashboardOverviewLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
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
          <KPICard
            index={4}
            kpi={{
              label: 'People & HR',
              value: activeEmployees.length > 0 ? `${activeEmployees.length}` : '—',
              changeLabel: activeEmployees.length > 0 ? `€${totalMonthlyCost.toLocaleString('el-GR')}/μήνα` : 'προσθήκη εργαζομένων',
              tooltip: 'Ενεργοί εργαζόμενοι και συνολικό μηνιαίο κόστος μισθοδοσίας. Λεπτομέρειες στη σελίδα HR & People.',
            }}
            onClick={() => onSectionChange?.('hr')}
          />
        </div>
      )}

      {/* KPI Cards — Financial Overview */}
      {!dashboardOverviewLoading && (hasOrganic ||
        hasCampaigns ||
        hasEcommerceRevenue ||
        hasErpBusinessRevenue ||
        (enabledModules.procurement && costing12m.hasColumn && costing12m.sum > 0)) &&
        (() => {
        const sortMonthKeys = (entries: [string, any][]) =>
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
        const dashboardUsesAttributionFallback =
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
          const organicMonthly = sumDailyRecordByMonthInPeriod(ga4OrganicEffective, periodDates.fromDate, periodDates.toDate);
          Object.entries(organicMonthly).forEach(([ym, val]) => {
            revenueByMonth[ym] = (revenueByMonth[ym] || 0) + val;
          });
        }
        periodCampaigns.forEach((c) => {
          for (const [ym, val] of getCampaignMonthlyAttributedValueInPeriod(c, periodDates.fromDate, periodDates.toDate)) {
            if (dashboardUsesAttributionFallback) {
              revenueByMonth[ym] = (revenueByMonth[ym] || 0) + val;
            }
            convsValueByMonth[ym] = (convsValueByMonth[ym] || 0) + val;
          }
          const d = getCampaignDateForMonth(c);
          const ymSpend = d ? monthKeyFromDate(d) : null;
          if (ymSpend) {
            spendByMonth[ymSpend] = (spendByMonth[ymSpend] || 0) + (c.amount_spent || 0);
            convsByMonth[ymSpend] = (convsByMonth[ymSpend] || 0) + (c.conversions || 0);
          }
        });

        // expensesByMonth = ad spend + marketing overhead εκείνου του μήνα. Marketing overhead
        // υπολογίζεται ξεχωριστά ανά calendar month (fixed_monthly = full amount, percent_of_budget &
        // one_off_month κατανέμονται), έτσι το MoM στο «Marketing Expenses» KPI είναι σωστό σε multi-month
        // periods («Τελευταίες 30 ημέρες», «Τρέχον Έτος» κ.λπ.).
        const monthsSet = new Set<string>([
          ...Object.keys(spendByMonth),
          ...Object.keys(revenueByMonth),
        ]);
        monthsSet.forEach((ym) => {
          const [yy, mm] = ym.split('-').map(Number);
          if (!yy || !mm) return;
          const monthFrom = `${ym}-01`;
          const lastDay = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
          const monthTo = `${ym}-${String(lastDay).padStart(2, '0')}`;
          const overheadMonth = computeMarketingOverheadForPeriod(
            activeStrategy?.marketingCostLines,
            activeStrategy?.monthlyBudget || 0,
            monthFrom,
            monthTo
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

        const revenueMoM = calcMoM(revenueByMonth);
        const expensesMoM = calcMoM(expensesByMonth);

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
        const dayList = eachDateInclusiveLocal(kFrom, kTo);

        const dailyTrendKpi = buildRoiTrendSeriesDaily(
          mergedOrganicByMonth,
          periodCampaigns as Campaign[],
          hasEcommerceRevenue ? ecommRevenueByDayRecord : undefined,
          kFrom,
          kTo,
          hasEcommerceRevenue,
          ga4OrganicEffective
        );
        const revenueSpark = padSparklineForChart(
          hasProcurementTurnoverEstimate && procurementPeriodDays > 0
            ? dayList.map(() => procurementRevenueInPeriod / procurementPeriodDays / 1000)
            : hasErpRevenueForPeriod
              ? completeDailyRevenueSeries(dayList, erpRevenueByDayRecord).map((v) => v / 1000)
              : hasEcommerceRevenue
                ? dailyTrendKpi.map((r) => r.storeRevenue / 1000)
                : dailyTrendKpi.map((r) => (r.organic + r.campaigns) / 1000)
        );

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
                  refreshing:
                    (hasEcommerceRevenue && ecomKpisRefreshing) || (hasErpBusinessRevenue && businessRevenue.isLoading),
                  tooltip:
                    isB2B
                      ? 'Βασική εικόνα εσόδων από οργανική ζήτηση και demand generation. Για πλήρη αποτύπωση εσόδων ανά account απαιτείται invoicing ή ERP import.'
                      : revenueTotalKpiTooltip,
                }}
                index={0}
                onClick={() => onSectionChange?.('finances')}
              />
              <KPICard
                kpi={{
                  label: isB2B ? 'Demand spend' : 'Marketing Expenses',
                  value:
                    hasCampaigns || marketingOverheadPeriod.total > 0
                      ? formatCurrencyCompact(totalMarketingExpenses)
                      : '€0',
                  change: expensesMoM !== null ? Math.round(expensesMoM) : undefined,
                  changeLabel:
                    expensesMoM !== null
                      ? 'vs προηγ. μήνα'
                      : hasCampaigns && campaignMetrics.cpa > 0
                        ? `CPA €${formatNumber(campaignMetrics.cpa, 1)}`
                        : marketingOverheadPeriod.total > 0
                          ? `Ad spend €${formatNumber(campaignMetrics.totalSpend, 0)} + overhead €${formatNumber(marketingOverheadPeriod.total, 0)}`
                          : undefined,
                  trend:
                    expensesMoM !== null
                      ? expensesMoM >= 0
                        ? 'up'
                        : 'down'
                      : hasCampaigns || marketingOverheadPeriod.total > 0
                        ? 'up'
                        : undefined,
                  sparklineData: spendSpark,
                  tooltip: isB2B
                    ? 'Spend για market validation και demand generation σε Google Ads / Meta.'
                    : marketingOverheadPeriod.total > 0
                      ? `Συνολικό κόστος marketing για την επιλεγμένη περίοδο: ad spend (Google Ads + Meta) €${formatNumber(campaignMetrics.totalSpend, 0)} + marketing overhead €${formatNumber(marketingOverheadPeriod.total, 0)} (agency, tools, one-off από το active strategy). CPA & ad-only spend στη σελίδα Καμπάνιες.`
                      : 'Συνολικό κόστος marketing: ad spend (Google Ads + Meta). Πρόσθεσε agency / tools / one-off lines στη σελίδα Στρατηγικής για πλήρες marketing overhead.',
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
                  refreshing: !isB2B && hasEshop && ecomKpisRefreshing,
                  tooltip: isB2B
                    ? 'Μετατροπές ή ενέργειες υψηλής πρόθεσης από τα demand channels, έως ότου ενεργοποιηθεί πλήρης παρακολούθηση pipeline.'
                    : hasEshop
                      ? 'Average Order Value (χωρίς ΦΠΑ) από πραγματικές παραγγελίες e-shop: καθαρός τζίρος / αριθμός παραγγελιών για την επιλεγμένη περίοδο.'
                      : 'Average Order Value από διαφημιστικές καμπάνιες (conversion value / conversions). Συνδέστε e-shop για ακριβές AOV χωρίς double-counting μεταξύ Google Ads & Meta.',
                }}
                index={2}
                onClick={() => onSectionChange?.(isB2B ? 'sales' : 'campaigns')}
              />
            </div>
            <p className="text-[12px] text-[#6B7280] leading-relaxed">
              {isB2B ? 'Για αναλυτικότερη οικονομική εικόνα, baseline revenue και πρόσθετα B2B data feeds, άνοιξε ' : <>Για <strong className="text-[#4B5563] font-medium">Campaign ROI incl. costs</strong>,{' '}
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

      {/* E-commerce + Web Analytics summary tabs */}
      {!dashboardOverviewLoading && ((enabledModules.ecommerce && ecomm.hasData) || (enabledModules.analytics && ga4.hasData)) && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          {enabledModules.ecommerce && ecomm.hasData && (
        <Card className="h-full" hover onClick={() => onSectionChange?.('ecommerce')}>
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-[var(--nts-accent)]/10 flex items-center justify-center">
                  <ShoppingBag size={16} className="text-[var(--nts-accent)]" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <h4 className="text-sm font-semibold text-[#1A1A1A]">E-commerce</h4>
                    {ecomKpisRefreshing && (
                      <span
                        className="inline-flex w-2 h-2 rounded-full bg-[var(--nts-accent)] animate-pulse"
                        title="Ανανέωση δεδομένων…"
                        aria-label="Ανανέωση δεδομένων"
                      />
                    )}
                  </div>
                  <span className="text-[10px] text-[#9CA3AF]">
                    {ecomm.connectedPlatforms.length} πλατφόρμες · επιλεγμένη περίοδος
                  </span>
                </div>
              </div>
              <ArrowRight size={16} className="text-[#D1D5DB] group-hover:text-[var(--nts-accent)] transition-colors" />
            </div>

            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 2xl:grid-cols-4 2xl:items-end">
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <p className="text-[11px] text-[#6B7280]">e-shop Revenue</p>
                  <Tooltip content="Πραγματικά καθαρά έσοδα e-shop (χωρίς ΦΠΑ) από τις συνδεδεμένες πλατφόρμες για την επιλεγμένη περίοδο." size={12} />
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
                  <Tooltip content="Average Order Value (χωρίς ΦΠΑ): καθαρός τζίρος e-shop / Παραγγελίες της επιλεγμένης περιόδου." size={12} />
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
                <div className="col-span-full hidden pt-2 sm:block">
                  <ResponsiveContainer width="100%" height={52}>
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

          {enabledModules.analytics && ga4.hasData && (
        <Card className="h-full" hover onClick={() => onSectionChange?.('analytics')}>
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
            <>
            <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 2xl:grid-cols-4">
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
            {ga4SessionsTrend.length > 1 && (
              <div className="mt-4 hidden pt-2 sm:block">
                <ResponsiveContainer width="100%" height={52}>
                  <AreaChart data={ga4SessionsTrend}>
                    <defs>
                      <linearGradient id="ga4SessionsDashSparkGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--nts-accent)" stopOpacity={0.18} />
                        <stop offset="95%" stopColor="var(--nts-accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <RechartsTooltip
                      cursor={{ stroke: '#FDBA74', strokeWidth: 1 }}
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #E8EAED',
                        borderRadius: '8px',
                        fontSize: '12px',
                        padding: '8px 10px',
                        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
                      }}
                      labelFormatter={(label) => formatDashChartDateKeyTick(String(label))}
                      formatter={(value: unknown) => [formatNumber(Number(value) || 0), 'Sessions']}
                      labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="sessions"
                      stroke="var(--nts-accent)"
                      strokeWidth={1.5}
                      fill="url(#ga4SessionsDashSparkGrad)"
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
            </>
              );
            })()}
          </div>
        </Card>
          )}
        </div>
      )}

      {/* Main Charts Row */}
      {!dashboardOverviewLoading && hasAnyData && (
        <>
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:gap-8 xl:grid-cols-3">
        {/* Revenue Trend */}
        <Card 
          className="min-w-0 xl:col-span-2" 
          padding="lg"
          hover={!!onSectionChange}
          onClick={() => onSectionChange?.('finances')}
        >
          <CardHeader
            title="Revenue Performance"
            subtitle={
              hasProcurementTurnoverEstimate ? (
                <p>
                  <strong className="font-semibold text-[var(--fgColor-default,#24292f)]">Πηγή: Procurement</strong> — εκτίμηση πραγματικού τζίρου για την επιλεγμένη περίοδο.
                </p>
              ) : hasErpRevenueForPeriod ? (
                <p>
                  <strong className="font-semibold text-[var(--fgColor-default,#24292f)]">Τζίρος επιχείρησης</strong> από συγχρονισμένα ERP παραστατικά για την επιλεγμένη περίοδο.
                </p>
              ) : enabledModules.ecommerce && ecomm.hasData ? (
                <p>
                  <strong className="font-semibold text-[var(--fgColor-default,#24292f)]">Καθαρός τζίρος παραγγελιών</strong> από το e-shop aggregate, συγχρονισμένος με την επιλεγμένη περίοδο.
                </p>
              ) : (
                <p>
                  {isB2B ? (
                    <>
                      Βασική εικόνα <strong className="font-semibold text-[var(--fgColor-default,#24292f)]">organic + demand generation</strong> μέχρι να προστεθεί ERP ή invoicing feed.
                    </>
                  ) : (
                    <>
                      Εκτίμηση <strong className="font-semibold text-[var(--fgColor-default,#24292f)]">organic + καμπανιών</strong> όταν δεν υπάρχει σύνδεση e-shop.
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
              className="relative w-full min-w-0 max-w-full" 
              style={{ 
                height: '288px', 
                minHeight: '288px', 
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
                  dataKey="dateKey"
                  tick={{ fill: '#57606a', fontSize: 12 }}
                  tickFormatter={(v) => formatDashChartDateKeyTick(String(v))}
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
                  labelFormatter={(label) => formatDashChartDateKeyTick(String(label))}
                  formatter={(value: unknown) => [
                    formatCurrencyCompact(Number(value) || 0),
                    revenuePerformanceChartLabel,
                  ]}
                  labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
                />
                <Area
                  type="linear"
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
                <span className="text-sm text-[var(--nts-medium-gray)]">{revenuePerformanceChartLabel}</span>
              </div>
            </div>
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
              subtitle="Μερίδιο πελατών ανά RFM segment."
              icon={<Users size={18} className="text-[var(--nts-medium-gray)]" />}
            />
            <div 
              ref={segmentContainerRef}
              className="relative w-full min-w-0 max-w-full" 
              style={{ 
                height: '224px', 
                minHeight: '224px', 
              }}
            >
              <PieChart width={chartDimensions.segment.width} height={chartDimensions.segment.height}>
                  <Pie
                    data={dashboardRfmSegments as any}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={3}
                    dataKey="percentage"
                    nameKey="name"
                    labelLine={false}
                  >
                    {dashboardRfmSegments.map((segment) => (
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
                      `${formatPercent((value as number) || 0, 1)} πελάτες`,
                      props?.payload?.name || ''
                    ]}
                  />
                </PieChart>
            </div>
            <div className="space-y-2 mt-4">
              {dashboardRfmSegments.map((segment) => (
                <div key={segment.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: segment.color }}
                    />
                    <span className="text-[#4A4A4A]">{segment.name}</span>
                  </div>
                  <span className="font-medium text-[#1A1A1A] font-mono" title="Μερίδιο επί του συνόλου πελατών RFM">
                    {formatPercent(segment.percentage ?? 0, 1)}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {hasCampaigns && adsPerformanceSeries.length > 0 && (
        <Card
          padding="lg"
          hover={!!onSectionChange}
          onClick={() => onSectionChange?.('campaigns')}
        >
          <CardHeader
            title="Campaigns"
            subtitle="Συνολική διαφημιστική απόδοση Google Ads + Meta Ads — conversion value, δαπάνη και Platform ROAS για την επιλεγμένη περίοδο."
            icon={<Megaphone size={18} className="text-[var(--nts-accent)]" />}
          />

          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-[#6B7280]">
            <span>
              Δαπάνη{' '}
              <strong className="font-mono text-[#1A1A1A]">{formatCurrencyCompact(campaignMetrics.totalSpend)}</strong>
            </span>
            <span>
              Conversion value{' '}
              <strong className="font-mono text-[#1A1A1A]">{formatCurrencyCompact(campaignMetrics.totalRevenue)}</strong>
            </span>
            <span>
              Platform ROAS{' '}
              <strong className="font-mono text-[#1A1A1A]">
                {campaignMetrics.totalSpend > 0 ? `${formatNumber(campaignMetrics.roas, 2)}×` : '—'}
              </strong>
            </span>
          </div>

          <div className="w-full min-w-0" style={{ height: 280, minHeight: 280 }}>
            <ResponsiveContainer width="100%" height="100%" minHeight={280}>
              <ComposedChart data={adsPerformanceSeries} margin={{ top: 8, right: 18, left: 4, bottom: 4 }}>
                <defs>
                  <linearGradient id="adsConvGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="8%" stopColor={ADS_CONV_COLOR} stopOpacity={0.18} />
                    <stop offset="100%" stopColor={ADS_CONV_COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F0F0" vertical={false} />
                <XAxis
                  dataKey="dateKey"
                  tickFormatter={(v) => formatDashChartDateKeyTick(String(v))}
                  tick={{ fill: '#57606a', fontSize: 11 }}
                  axisLine={{ stroke: '#d0d7de' }}
                  tickLine={{ stroke: '#d0d7de' }}
                />
                <YAxis
                  yAxisId="currency"
                  width={52}
                  tick={{ fill: '#57606a', fontSize: 11 }}
                  axisLine={{ stroke: '#d0d7de' }}
                  tickLine={{ stroke: '#d0d7de' }}
                  tickFormatter={formatRevenueChartYAxisTick}
                  tickCount={5}
                />
                <YAxis
                  yAxisId="roas"
                  orientation="right"
                  width={42}
                  tick={{ fill: ADS_ROAS_COLOR, fontSize: 11 }}
                  axisLine={{ stroke: '#d0d7de' }}
                  tickLine={{ stroke: '#d0d7de' }}
                  tickFormatter={(value) => `${formatNumber(Number(value) || 0, 1)}×`}
                  tickCount={5}
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
                  labelFormatter={(label) => formatDashChartDateKeyTick(String(label))}
                  formatter={(value: unknown, name?: string) => {
                    const numericValue = Number(value);
                    if (name === 'roas') {
                      return [Number.isFinite(numericValue) ? `${formatNumber(numericValue, 2)}×` : '—', 'Platform ROAS'];
                    }
                    return [
                      formatCurrencyCompact(Number.isFinite(numericValue) ? numericValue : 0),
                      name === 'adSpend' ? 'Δαπάνη' : 'Conversion value',
                    ];
                  }}
                />
                <Bar
                  yAxisId="currency"
                  dataKey="adSpend"
                  name="adSpend"
                  fill={ADS_SPEND_COLOR}
                  opacity={0.65}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={18}
                  isAnimationActive={false}
                />
                <Area
                  yAxisId="currency"
                  type="linear"
                  dataKey="adConvValue"
                  name="adConvValue"
                  stroke={ADS_CONV_COLOR}
                  strokeWidth={2.5}
                  fill="url(#adsConvGradient)"
                  fillOpacity={1}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="roas"
                  type="linear"
                  dataKey="roas"
                  name="roas"
                  stroke={ADS_ROAS_COLOR}
                  strokeWidth={1.75}
                  strokeDasharray="4 4"
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[#6B7280]">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: ADS_SPEND_COLOR }} />
              Δαπάνη
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: ADS_CONV_COLOR }} />
              Conversion value
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-0.5 w-5 rounded-full" style={{ backgroundColor: ADS_ROAS_COLOR }} />
              Platform ROAS
            </span>
          </div>
        </Card>
      )}

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
                <p className="text-lg font-bold text-[var(--nts-charcoal)] font-mono">{isB2B ? formatNumber(openCommercialTasks) : dashboardRfmSegments.length}</p>
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


