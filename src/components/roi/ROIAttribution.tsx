import { useMemo, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Euro,
  TrendingUp,
  BarChart3,
  Wallet,
  ShoppingBag,
  ArrowUpRight,
  Loader2,
  Database,
  Leaf,
  Percent,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from 'recharts';
import { Card, CardHeader, Button, Tooltip, PageHeader, MetaAttributionSelector } from '../common';
import { useOrganic } from '../../hooks/useOrganic';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useBrand } from '../../hooks/useBrand';
import { useDashPeriod } from '../../hooks/useDashPeriod';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { DateRangePicker } from '../ui/DateRangePicker';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useEcommerceFullHistoryMetrics } from '../../hooks/useEcommerceFullHistoryMetrics';
import { useGA4Data } from '../../hooks/useGA4Data';
import { CampaignsService, OrganicService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import {
  calculateCampaignMetrics,
  sumDailyRevenueInPeriod,
  buildRoiTrendSeriesDaily,
  mergeGa4OrganicDailyWithChannelFallback,
  formatTrendDayLabel,
} from '../../utils/roiUtils';
import {
  applyCampaignDateRangeToMetrics,
  filterCampaignsByScheduleDateOverlap,
} from '../../utils/campaignDateRangeMetrics';
import { computeMarketingOverheadForPeriod, eachDateInclusive } from '../../utils/marketingCostPeriod';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import type { Campaign } from '../../types';

function formatPeriodDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

type RoasAnalysisMetricRow = { k: string; v: ReactNode; note: ReactNode };

function formatMultiplierValue(value: number | null | undefined, decimals = 2): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${formatNumber(value, decimals)}x`;
}

function getEfficiencyColor(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '#111827';
  return value >= 1 ? '#059669' : '#EF4444';
}

function RoasAnalysisMetricCard({ row }: { row: RoasAnalysisMetricRow }) {
  return (
    <div className="flex flex-col rounded-xl border border-[#ECECEE] bg-white/95 p-3 shadow-sm ring-1 ring-black/[0.02] sm:p-3.5">
      <p className="text-[11px] font-semibold leading-snug text-[#57534E]">{row.k}</p>
      <div className="mt-1 min-h-[1.75rem] font-mono text-xl font-bold tabular-nums text-[var(--nts-charcoal)] sm:text-2xl">
        {row.v}
      </div>
      <div className="mt-2 border-t border-[#F3F4F6] pt-2 text-[11px] leading-snug text-[#6B7280] sm:text-[12px]">{row.note}</div>
    </div>
  );
}

type RoasGroupVariant = 'ad' | 'cost' | 'full';

const ROAS_GROUP_SHELL: Record<
  RoasGroupVariant,
  { wrap: string; bar: string; titleClass: string }
> = {
  ad: {
    wrap: 'border-orange-200/90 bg-gradient-to-br from-orange-50/95 via-white to-white',
    bar: 'bg-[var(--nts-accent)]',
    titleClass: 'text-orange-900/90',
  },
  cost: {
    wrap: 'border-slate-200/90 bg-gradient-to-br from-slate-50/90 via-white to-white',
    bar: 'bg-slate-500',
    titleClass: 'text-slate-800',
  },
  full: {
    wrap: 'border-amber-200/90 bg-gradient-to-br from-amber-50/85 via-white to-white',
    bar: 'bg-amber-600',
    titleClass: 'text-amber-950/90',
  },
};

function RoasAnalysisGroupSection({
  variant,
  title,
  description,
  children,
}: {
  variant: RoasGroupVariant;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const s = ROAS_GROUP_SHELL[variant];
  return (
    <section className={`rounded-2xl border p-4 shadow-sm sm:p-5 ${s.wrap}`}>
      <div className="mb-4 flex gap-3">
        <div className={`w-1 shrink-0 self-stretch rounded-full ${s.bar}`} aria-hidden />
        <div className="min-w-0">
          <h3 className={`text-[11px] font-bold uppercase tracking-wide ${s.titleClass}`}>{title}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-[#6B7280] sm:text-[12px]">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

const DEMO_CAMPAIGNS: Omit<Campaign, 'id'>[] = [
  { name: 'Google Shopping — Ρούχα Εργασίας', channel: 'Google Ads', period: 'Jan 2026', start_date: '2026-01-01', end_date: '2026-01-31', status: 'completed', amount_spent: 1200, impressions: 84000, clicks: 3360, conversions: 142, conversion_value: 8520, roas: 7.1, ctr: 4.0 },
  { name: 'Google Shopping — Παπούτσια Ασφαλείας', channel: 'Google Ads', period: 'Jan 2026', start_date: '2026-01-01', end_date: '2026-01-31', status: 'completed', amount_spent: 980, impressions: 67000, clicks: 2680, conversions: 98, conversion_value: 6370, roas: 6.5, ctr: 4.0 },
  { name: 'Meta — Retargeting Cart Abandoners', channel: 'Meta', period: 'Jan 2026', start_date: '2026-01-05', end_date: '2026-01-31', status: 'completed', amount_spent: 650, impressions: 120000, clicks: 1800, conversions: 64, conversion_value: 3840, roas: 5.9, ctr: 1.5 },
  { name: 'Meta — Lookalike Champions', channel: 'Meta', period: 'Feb 2026', start_date: '2026-02-01', end_date: '2026-02-28', status: 'completed', amount_spent: 800, impressions: 145000, clicks: 2175, conversions: 76, conversion_value: 4940, roas: 6.2, ctr: 1.5 },
  { name: 'Google Shopping — Προστασία Κεφαλής', channel: 'Google Ads', period: 'Feb 2026', start_date: '2026-02-01', end_date: '2026-02-28', status: 'completed', amount_spent: 750, impressions: 52000, clicks: 2080, conversions: 89, conversion_value: 4895, roas: 6.5, ctr: 4.0 },
  { name: 'Google Search — Brand Terms', channel: 'Google Ads', period: 'Feb 2026', start_date: '2026-02-01', end_date: '2026-02-28', status: 'completed', amount_spent: 320, impressions: 18000, clicks: 1440, conversions: 112, conversion_value: 5040, roas: 15.8, ctr: 8.0 },
  { name: 'Meta — Spring Collection Launch', channel: 'Meta', period: 'Mar 2026', start_date: '2026-03-01', end_date: '2026-03-08', status: 'active', amount_spent: 420, impressions: 78000, clicks: 1170, conversions: 38, conversion_value: 2660, roas: 6.3, ctr: 1.5 },
  { name: 'Google Shopping — Υλικά Συσκευασίας', channel: 'Google Ads', period: 'Mar 2026', start_date: '2026-03-01', end_date: '2026-03-08', status: 'active', amount_spent: 380, impressions: 28000, clicks: 1120, conversions: 52, conversion_value: 2600, roas: 6.8, ctr: 4.0 },
  { name: 'Google Remarketing — Visited Products', channel: 'Google Ads', period: 'Jan 2026', start_date: '2026-01-10', end_date: '2026-02-28', status: 'completed', amount_spent: 540, impressions: 210000, clicks: 2100, conversions: 87, conversion_value: 4350, roas: 8.1, ctr: 1.0 },
  { name: 'Meta — Stock Clearance Flash Sale', channel: 'Meta', period: 'Feb 2026', start_date: '2026-02-10', end_date: '2026-02-17', status: 'completed', amount_spent: 350, impressions: 95000, clicks: 1425, conversions: 53, conversion_value: 2650, roas: 7.6, ctr: 1.5 },
];

const DEMO_ORGANIC = [
  { period: '2025-10-01', organic_revenue: 42000 },
  { period: '2025-11-01', organic_revenue: 48500 },
  { period: '2025-12-01', organic_revenue: 67000 },
  { period: '2026-01-01', organic_revenue: 38000 },
  { period: '2026-02-01', organic_revenue: 41200 },
  { period: '2026-03-01', organic_revenue: 15800 },
];

interface ROIAttributionProps {
  embedded?: boolean;
}

type KpiTabId = 'campaignEfficiency' | 'storeEfficiency';

type ExpenseKpiId = 'campaignsSpend' | 'marketingExpenses' | 'totalMarketingCost';

/** Κορυφή σελίδας: τα δύο βασικά ROI (μεγάλη εμφάνιση). */
const ROI_HERO_ORDER: KpiTabId[] = ['storeEfficiency', 'campaignEfficiency'];

const EXPENSES_ORDER: ExpenseKpiId[] = ['campaignsSpend', 'marketingExpenses', 'totalMarketingCost'];

export function ROIAttribution({ embedded }: ROIAttributionProps = {}) {
  const { byMonth: organicByMonth, hasOrganicRevenue: hasOrganic } = useOrganic();
  const { campaigns, hasImported: hasCampaigns } = useCampaigns();
  const campaignsAll = campaigns as Campaign[];
  const { activeStrategy } = useActiveStrategy();
  const ecomm = useEcommerceSummary();
  const ecommHist = useEcommerceFullHistoryMetrics();
  const {
    organicRevenueByDay: ga4OrganicByDay,
    totalOrganicRevenueFromChannels,
    dateRange: ga4DateRange,
    dailyEntries: ga4DailyEntries,
    trafficSources: ga4TrafficSources,
    hasData: hasGa4Data,
  } = useGA4Data();
  const { currentBrand } = useBrand();
  const queryClient = useQueryClient();
  const [seeding, setSeeding] = useState(false);
  const { period: dashPeriod, setPeriod: setDashPeriod, periodDates } = useDashPeriod();
  const { customFrom, customTo, setCustomRange } = useGlobalDate();

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

  /** Όταν δεν υπάρχει organicRevenueByDay στο Firestore, εφαρμόζεται κατανομή από σύνολο καναλιών. */
  const organicUsesChannelFallback = useMemo(() => {
    let sumRaw = 0;
    if (ga4OrganicByDay) {
      for (const d of eachDateInclusive(periodDates.fromDate, periodDates.toDate)) {
        sumRaw += Number(ga4OrganicByDay[d]) || 0;
      }
    }
    return sumRaw < 0.5 && totalOrganicRevenueFromChannels > 0;
  }, [ga4OrganicByDay, periodDates.fromDate, periodDates.toDate, totalOrganicRevenueFromChannels]);

  /** Ίδια pipeline με Campaigns: schedule overlap → applyCampaignDateRangeToMetrics (όχι ξεχωριστός τύπος slice). */
  const dateFilteredCampaigns = useMemo(() => {
    const all = campaigns as Campaign[];
    const { fromDate, toDate } = periodDates;
    const scheduleScoped = filterCampaignsByScheduleDateOverlap(all, fromDate, toDate);
    return applyCampaignDateRangeToMetrics(scheduleScoped, fromDate, toDate);
  }, [campaigns, periodDates]);

  const campaignsTyped = dateFilteredCampaigns;
  const hasData = hasOrganic || hasCampaigns || ecomm.hasData;
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(800);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const update = () => setChartWidth(el.offsetWidth || 800);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  const seedDemoData = useCallback(async () => {
    const brandId = currentBrand?.id ?? null;
    setSeeding(true);
    try {
      for (const c of DEMO_CAMPAIGNS) {
        const id = `demo_${c.name.replace(/\s+/g, '_').substring(0, 40)}_${Date.now()}`;
        await CampaignsService.create(id, { ...c } as Record<string, unknown>, brandId);
      }
      for (const o of DEMO_ORGANIC) {
        const id = `demo_organic_${o.period}_${Date.now()}`;
        await OrganicService.create(id, { ...o } as Record<string, unknown>, brandId);
      }
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['organic'] });
    } finally {
      setSeeding(false);
    }
  }, [currentBrand, queryClient]);
  const monthlyBudget = activeStrategy?.monthlyBudget || 0;
  const marketingOverhead = useMemo(
    () =>
      computeMarketingOverheadForPeriod(
        activeStrategy?.marketingCostLines,
        monthlyBudget,
        periodDates.fromDate,
        periodDates.toDate
      ),
    [activeStrategy?.marketingCostLines, monthlyBudget, periodDates.fromDate, periodDates.toDate]
  );

  const metrics = useMemo(() => calculateCampaignMetrics(campaignsTyped), [campaignsTyped]);
  const totalMarketingCost = useMemo(
    () => Math.round((metrics.totalSpend + marketingOverhead.total) * 100) / 100,
    [metrics.totalSpend, marketingOverhead.total]
  );
  const totalClicks = useMemo(
    () => campaignsTyped.reduce((sum, c) => sum + (c.clicks || 0), 0),
    [campaignsTyped],
  );
  const ecommRevenueByDay = ecommHist.revenueByDayRecord;

  const ecommRevenueInPeriod = useMemo(
    () => sumDailyRevenueInPeriod(ecommRevenueByDay, periodDates.fromDate, periodDates.toDate),
    [ecommRevenueByDay, periodDates.fromDate, periodDates.toDate]
  );

  /** Παραγγελίες e-shop (όλες οι συνδεδεμένες πλατφόρμες) στην επιλεγμένη περίοδο — για CVR καταστήματος. */
  const ordersCountInPeriod = useMemo(() => {
    return ecommHist.ordersByDay.reduce((sum, row) => {
      if (row.date >= periodDates.fromDate && row.date <= periodDates.toDate) return sum + row.orders;
      return sum;
    }, 0);
  }, [ecommHist.ordersByDay, periodDates.fromDate, periodDates.toDate]);

  /** GA4 sessions στην επιλεγμένη περίοδο (ημερήσια σύνολα). */
  const ga4SessionsInPeriod = useMemo(() => {
    if (!hasGa4Data || ga4DailyEntries.length === 0) return 0;
    const byDate = new Map(ga4DailyEntries.map((d) => [d.date, d.sessions]));
    let sum = 0;
    for (const day of eachDateInclusive(periodDates.fromDate, periodDates.toDate)) {
      sum += byDate.get(day) ?? 0;
    }
    return sum;
  }, [hasGa4Data, ga4DailyEntries, periodDates.fromDate, periodDates.toDate]);

  /**
   * E-shop CVR: συνολικές παραγγελίες από συγχρονισμένα καταστήματα (Shopify, WooCommerce, Magento κ.λπ.)
   * στην περίοδο ÷ συνολικές συνεδρίες GA4 τις ίδιες ημέρες. Το GA4 property πρέπει να αντιστοιχεί στο site.
   */
  const eShopCvrPercent = useMemo(() => {
    if (!ecomm.hasData || !hasGa4Data || ga4SessionsInPeriod <= 0 || ordersCountInPeriod <= 0) return null;
    return (ordersCountInPeriod / ga4SessionsInPeriod) * 100;
  }, [ecomm.hasData, hasGa4Data, ga4SessionsInPeriod, ordersCountInPeriod]);

  /**
   * Organic CVR από GA4 traffic channels (όσα default channel groups περιέχουν «organic»).
   * Βασίζεται στο τελευταίο GA4 sync, όχι στο ακριβές εύρος ημερολογίου ROI.
   */
  const organicCvrPercent = useMemo(() => {
    if (!ga4TrafficSources.length) return null;
    let sessions = 0;
    let conversions = 0;
    for (const row of ga4TrafficSources) {
      if (row.channel.toLowerCase().includes('organic')) {
        sessions += row.sessions || 0;
        conversions += row.conversions || 0;
      }
    }
    return sessions > 0 ? (conversions / sessions) * 100 : null;
  }, [ga4TrafficSources]);

  const trendData = useMemo(
    () =>
      buildRoiTrendSeriesDaily(
        organicByMonth,
        campaignsAll,
        ecommRevenueByDay,
        periodDates.fromDate,
        periodDates.toDate,
        ecomm.hasData,
        ga4OrganicEffective
      ),
    [
      organicByMonth,
      campaignsAll,
      ecommRevenueByDay,
      ecomm.hasData,
      periodDates.fromDate,
      periodDates.toDate,
      ga4OrganicEffective,
      ecommHist.source,
    ]
  );

  /** Organic στην επιλεγμένη περίοδο (ίδιο άθροισμα με τη γραμμή Organic στο chart τάσης). */
  const organicRevenueInPeriod = useMemo(
    () => trendData.reduce((s, r) => s + (r.organic || 0), 0),
    [trendData]
  );

  const performanceSummary = useMemo(() => {
    const cvr = totalClicks > 0 ? (metrics.totalConversions / totalClicks) * 100 : null;
    const platformRoas = metrics.totalSpend > 0 ? metrics.totalRevenue / metrics.totalSpend : null;
    const storeRoas =
      ecomm.hasData && metrics.totalSpend > 0 ? ecommRevenueInPeriod / metrics.totalSpend : null;
    const campaignEfficiency =
      totalMarketingCost > 0 ? metrics.totalRevenue / totalMarketingCost : null;
    const storeEfficiency =
      ecomm.hasData && totalMarketingCost > 0 ? ecommRevenueInPeriod / totalMarketingCost : null;
    const revenueGap = ecomm.hasData ? ecommRevenueInPeriod - metrics.totalRevenue : null;
    const periodDayCount = eachDateInclusive(periodDates.fromDate, periodDates.toDate).length;
    const monthlyRateHints: string[] = [];

    for (const line of activeStrategy?.marketingCostLines ?? []) {
      if (line.kind === 'fixed_monthly' && line.amountEUR > 0) {
        monthlyRateHints.push(`${line.label?.trim() || 'Γραμμή'}: ${formatCurrency(line.amountEUR, 0)}/μήνα`);
      }
      if (line.kind === 'percent_of_budget' && line.percent > 0) {
        monthlyRateHints.push(
          `${line.label?.trim() || 'Γραμμή'}: ${formatNumber(line.percent, 1)}% του μην. budget`
        );
      }
      if (line.kind === 'one_off_month' && line.amountEUR > 0) {
        monthlyRateHints.push(
          `${line.label?.trim() || 'Εφάπαξ'}: ${formatCurrency(line.amountEUR, 0)} (${line.month})`
        );
      }
    }

    return {
      cvr,
      platformRoas,
      storeRoas,
      campaignEfficiency,
      storeEfficiency,
      revenueGap,
      periodDayCount,
      monthlyRateHints,
    };
  }, [
    totalClicks,
    metrics.totalConversions,
    metrics.totalRevenue,
    metrics.totalSpend,
    ecomm.hasData,
    ecommRevenueInPeriod,
    totalMarketingCost,
    periodDates.fromDate,
    periodDates.toDate,
    activeStrategy?.marketingCostLines,
  ]);

  const kpiPanelConfig = useMemo(() => {
    return {
      campaignEfficiency: {
        icon: <TrendingUp size={22} strokeWidth={2} />,
        label: 'Campaign ROI',
        value: formatMultiplierValue(performanceSummary.campaignEfficiency),
        subtitle: 'Έσοδα καμπανιών / συνολικό κόστος marketing',
        color: getEfficiencyColor(performanceSummary.campaignEfficiency),
        iconWrapClass: 'bg-emerald-50 text-emerald-600',
        tooltip:
          'Revenue-based efficiency metric: attributed campaign revenue προς συνολικό marketing cost. Περιλαμβάνει ad spend και extra marketing expenses.',
      },
      storeEfficiency: {
        icon: <ShoppingBag size={22} strokeWidth={2} />,
        label: 'e-shop ROI',
        value: formatMultiplierValue(performanceSummary.storeEfficiency),
        subtitle: ecomm.hasData ? 'Τζίρος e-shop (χωρίς ΦΠΑ) / συνολικό κόστος marketing' : 'Χωρίς συνδεδεμένο e-shop',
        color: getEfficiencyColor(performanceSummary.storeEfficiency),
        iconWrapClass: 'bg-emerald-50 text-emerald-600',
        tooltip:
          'Βασικό KPI για owner view: καθαρός τζίρος e-shop (χωρίς ΦΠΑ) προς συνολικό κόστος marketing για την επιλεγμένη περίοδο.',
      },
    } satisfies Record<
      KpiTabId,
      {
        icon: ReactNode;
        label: string;
        value: string;
        subtitle: string;
        color: string;
        iconWrapClass: string;
        tooltip?: string;
      }
    >;
  }, [ecomm.hasData, performanceSummary.campaignEfficiency, performanceSummary.storeEfficiency]);

  const expensesPanelConfig = useMemo(() => {
    return {
      campaignsSpend: {
        icon: <Euro size={22} strokeWidth={2} />,
        label: 'Campaigns Spend',
        value: formatCurrencyCompact(metrics.totalSpend),
        subtitle: hasCampaigns
          ? `${campaignsTyped.length} καμπάνιες · media spend`
          : 'Κόστος διαφήμισης στην περίοδο',
        color: '#111827',
        iconWrapClass: 'bg-slate-100 text-slate-600',
        tooltip:
          'Συνολικό media spend από τις διαφημιστικές πλατφόρμες για την επιλεγμένη περίοδο. Δεν περιλαμβάνει agency, εργαλεία ή one-off έξοδα — αυτά εμφανίζονται στο «Marketing Expenses».',
      },
      marketingExpenses: {
        icon: <Wallet size={22} strokeWidth={2} />,
        label: 'Marketing Expenses',
        value: formatCurrencyCompact(marketingOverhead.total),
        subtitle:
          performanceSummary.monthlyRateHints.length > 0
            ? 'Agency, εργαλεία και one-off στην περίοδο'
            : 'Έξοδα εκτός media spend',
        color: '#111827',
        iconWrapClass: 'bg-amber-50 text-amber-600',
        tooltip:
          'Επιπλέον marketing expenses εκτός media spend. Τα σταθερά μηνιαία (π.χ. agency) μετρούν πλήρες ποσό ανά ημερολογιακό μήνα που καλύπτει η περίοδο· ποσοστά επί budget και one-off παραμένουν κατανομή ανά ημέρα.',
      },
      totalMarketingCost: {
        icon: <BarChart3 size={22} strokeWidth={2} />,
        label: 'Συνολικό κόστος marketing',
        value: formatCurrencyCompact(totalMarketingCost),
        subtitle: 'Campaigns Spend + Marketing Expenses',
        color: '#111827',
        iconWrapClass: 'bg-orange-50 text-orange-600',
        tooltip:
          'Άθροισμα Campaigns Spend και Marketing Expenses: media spend συν agency, εργαλεία και one-off από το Finances / Channel Activation.',
      },
    } satisfies Record<
      ExpenseKpiId,
      {
        icon: ReactNode;
        label: string;
        value: string;
        subtitle: string;
        color: string;
        iconWrapClass: string;
        tooltip?: string;
      }
    >;
  }, [
    campaignsTyped.length,
    hasCampaigns,
    marketingOverhead.total,
    metrics.totalSpend,
    performanceSummary.monthlyRateHints.length,
    totalMarketingCost,
  ]);

  const totalSpendForBudget = metrics.totalSpend;
  const budgetUtilization = monthlyBudget > 0 ? (totalSpendForBudget / monthlyBudget) * 100 : 0;

  if (!hasData) {
    return (
      <div className="space-y-6">
        {!embedded && (
          <PageHeader
            title={<h2 className="text-xl font-bold text-[var(--nts-charcoal)] sm:text-2xl">ROI & Απόδοση</h2>}
            description={
              <p className="text-sm text-[var(--nts-medium-gray)] sm:text-base">
                e-shop ROI, Campaign ROI και κατανομή εσόδων / εξόδων
              </p>
            }
          />
        )}
        <Card padding="lg">
          <div className="text-center py-16">
            <BarChart3 size={48} className="mx-auto text-[var(--nts-medium-gray)] mb-4" />
            <h3 className="text-lg font-semibold text-[var(--nts-charcoal)] mb-2">Δεν υπάρχουν δεδομένα</h3>
            <p className="text-[var(--nts-medium-gray)] max-w-md mx-auto mb-6">
              Συνδέστε campaigns, e-shop ή organic έσοδα από τις Συνδέσεις για να εμφανιστεί η συνολική εικόνα απόδοσης — ή φόρτωσε ενδεικτικά δεδομένα.
            </p>
            <Button
              variant="secondary"
              icon={seeding ? <Loader2 size={16} className="animate-spin" /> : <Database size={16} />}
              onClick={seedDemoData}
              disabled={seeding}
            >
              {seeding ? 'Φόρτωση...' : 'Φόρτωση Demo Data'}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          toolbarAriaLabel="Επιλογή περιόδου"
          title={<h2 className="text-xl font-bold text-[var(--nts-charcoal)] sm:text-2xl">ROI & Απόδοση</h2>}
          description={
            <p className="text-sm text-[var(--nts-medium-gray)] sm:text-base">
              e-shop ROI, Campaign ROI και κατανομή εσόδων / εξόδων
            </p>
          }
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex w-full flex-wrap gap-1 rounded-lg bg-gray-100 p-1 lg:w-auto">
                {GLOBAL_PERIOD_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setDashPeriod(opt.key)}
                    className={`min-h-[32px] flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-all sm:flex-initial sm:px-3 ${
                      dashPeriod === opt.key
                        ? 'bg-white font-semibold text-[var(--nts-orange)] shadow-sm'
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
              <MetaAttributionSelector compact />
            </div>
          }
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        {ROI_HERO_ORDER.map((id) => (
          <RoiHeroKpiCard
            key={id}
            variant={id === 'storeEfficiency' ? 'eshop' : 'campaign'}
            {...kpiPanelConfig[id]}
          />
        ))}
      </div>

      <Card padding="lg">
        <CardHeader
          title="Revenue Breakdown"
          subtitle="Σύγκριση των βασικών πηγών εσόδων για την επιλεγμένη περίοδο."
          icon={<ShoppingBag size={20} className="text-[var(--nts-accent)]" />}
        />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {ecomm.hasData && (
            <MetricCard
              icon={<ShoppingBag size={20} />}
              label="e-shop Revenue"
              value={formatCurrencyCompact(ecommRevenueInPeriod)}
              subtitle="Άθροισμα ημερήσιων παραγγελιών στην περίοδο"
              color="#10B981"
              tooltip="Καθαρά έσοδα (χωρίς ΦΠΑ) από τα συνδεδεμένα e-shop για τις ημερομηνίες που καλύπτει η επιλογή πάνω."
            />
          )}
          <MetricCard
            icon={<Euro size={20} />}
            label="Campaign Revenue"
            value={formatCurrencyCompact(metrics.totalRevenue)}
            subtitle="Attributed revenue από Meta / Google Ads"
            color="var(--nts-charcoal)"
            tooltip="Άθροισμα conversion value από Google Ads / Meta για την επιλεγμένη περίοδο."
          />
          <MetricCard
            icon={<Leaf size={20} />}
            label="Organic Revenue"
            value={
              hasOrganic || organicRevenueInPeriod > 0
                ? formatCurrencyCompact(organicRevenueInPeriod)
                : '—'
            }
            subtitle={
              hasOrganic
                ? 'Μηνιαίο import με ημερήσια κατανομή'
                : organicRevenueInPeriod > 0
                  ? 'GA4 sync ανά ημέρα / channel group'
                  : 'Χωρίς organic import ή GA4 revenue'
            }
            color="#059669"
            tooltip="Οργανικά έσοδα για την επιλεγμένη περίοδο. Αν υπάρχει μηνιαίο import, υπερισχύει ανά μήνα· αλλιώς χρησιμοποιούνται τα ημερήσια organic revenue από το GA4."
          />
          {ecomm.hasData && (
            <MetricCard
              icon={<BarChart3 size={20} />}
              label="Revenue Gap"
              value={
                performanceSummary.revenueGap == null
                  ? '—'
                  : performanceSummary.revenueGap >= 0
                    ? `+${formatCurrencyCompact(performanceSummary.revenueGap)}`
                    : formatCurrencyCompact(performanceSummary.revenueGap)
              }
              subtitle="Τζίρος e-shop (χωρίς ΦΠΑ) − έσοδα καμπανιών"
              color={
                performanceSummary.revenueGap == null
                  ? '#111827'
                  : performanceSummary.revenueGap >= 0
                    ? '#22C55E'
                    : '#EF4444'
              }
              tooltip="Διαφορά καθαρού e-shop revenue (χωρίς ΦΠΑ) μείον attributed campaign revenue για την ίδια περίοδο."
            />
          )}
        </div>
        <div className="mt-4 space-y-2">
          <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
            Τα organic revenue προέρχονται από μηνιαίο import όταν υπάρχει, αλλιώς από ημερήσιο <strong>GA4</strong> sync. Το revenue gap δείχνει πόσο απέχει ο συνολικός τζίρος του store από τα attributed έσοδα καμπανιών.
          </p>
          {!hasOrganic && organicRevenueInPeriod === 0 && (
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
              Δεν υπάρχει organic import και δεν βρέθηκαν ημερήσια organic έσοδα στο GA4 για αυτές τις ημέρες. Συγχρονίστε το GA4 από τις Συνδέσεις ή εισάγετε μηνιαία organic.
            </p>
          )}
        </div>
      </Card>

      <Card padding="lg">
        <CardHeader
          title="Expenses Breakdown"
          subtitle="Κατανομή εξόδων marketing: διαφημιστικό spend, λοιπά έξοδα και σύνολο για την επιλεγμένη περίοδο."
          icon={<Wallet size={20} className="text-[var(--nts-accent)]" />}
        />
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {EXPENSES_ORDER.map((id) => (
            <RoiKpiTabCard key={id} {...expensesPanelConfig[id]} />
          ))}
        </div>
      </Card>

      <Card padding="lg">
        <CardHeader
          title="Ρυθμός μετατροπής (CVR)"
          subtitle="Σύνοψη conversion rate για e-shop, διαφημιστικές καμπάνιες και οργανικά κανάλια (GA4)."
          icon={<Percent size={20} className="text-[var(--nts-accent)]" />}
        />
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MetricCard
            icon={<ShoppingBag size={20} />}
            label="E-shop (κατάστημα)"
            value={eShopCvrPercent != null ? formatPercent(eShopCvrPercent, 2) : '—'}
            subtitle={
              ecomm.hasData
                ? hasGa4Data
                  ? 'Παραγγελίες e-shop ÷ sessions GA4 (ίδια περίοδος)'
                  : 'Συνδέστε/συγχρονίστε GA4 για sessions'
                : 'Χωρίς συνδεδεμένο e-shop'
            }
            color="#7C3AED"
            tooltip="Ρυθμός μετατροπής καταστήματος: άθροισμα παραγγελιών από τα συγχρονισμένα e-shop (όλες οι πλατφόρμες) για την επιλεγμένη περίοδο, διαιρεμένο με τις συνολικές συνεδρίες του GA4 τις ίδιες ημέρες. Το GA4 property πρέπει να αντιστοιχεί στο ίδιο site. Αν λείπουν παραγγελίες ή sessions, εμφανίζεται —."
          />
          <MetricCard
            icon={<Euro size={20} />}
            label="Καμπάνιες"
            value={
              performanceSummary.cvr != null && totalClicks > 0
                ? formatPercent(performanceSummary.cvr, 2)
                : '—'
            }
            subtitle={
              totalClicks > 0
                ? `Μετατροπές ÷ κλικ (${formatNumber(metrics.totalConversions, 0)} / ${formatNumber(totalClicks, 0)})`
                : 'Μετατροπές ÷ κλικ στην περίοδο'
            }
            color="var(--nts-charcoal)"
            tooltip="Conversion rate από τα εισαγόμενα campaigns για την επιλεγμένη περίοδο: άθροισμα μετατροπών προς άθροισμα κλικ (ίδια λογική με το Paid Media View παρακάτω)."
          />
          <MetricCard
            icon={<Leaf size={20} />}
            label="Οργανικά (GA4)"
            value={organicCvrPercent != null ? formatPercent(organicCvrPercent, 2) : '—'}
            subtitle={
              hasGa4Data
                ? 'Μετατροπές ÷ sessions (organic channel groups, τελευταίο sync)'
                : 'Χωρίς GA4 δεδομένα'
            }
            color="#059669"
            tooltip="Από τα default channel groups του GA4 που περιέχουν «organic» (π.χ. Organic Search). Τα sessions/μετατροπές αντιστοιχούν στο εύρος ημερομηνιών του τελευταίου GA4 sync, όχι απαραίτητα στο ημερολογιακό εύρος πάνω από τη σελίδα."
          />
        </div>
      </Card>

      <div id="roas-analysis" className="scroll-mt-4">
        <Card padding="lg" className="border border-[var(--nts-border-gray)]">
          <CardHeader
            title="ROI & ROAS Analysis"
            subtitle={
              <>
                Βασικοί δείκτες ROI / ROAS για{' '}
                <span className="font-medium text-[var(--nts-charcoal)]">
                  {formatPeriodDate(periodDates.fromDate)} — {formatPeriodDate(periodDates.toDate)}
                </span>{' '}
                ({performanceSummary.periodDayCount} ημέρες). Τα σταθερά μηνιαία έξοδα μετρούν ανά ημερολογιακό μήνα· λοιπά γραμμές marketing ανά ημέρα εντός περιόδου.
              </>
            }
            icon={<BarChart3 size={20} className="text-[var(--nts-accent)]" />}
          />
          {(() => {
            const ownerRows: RoasAnalysisMetricRow[] = [
              {
                k: 'Campaign ROI',
                v: formatMultiplierValue(performanceSummary.campaignEfficiency),
                note:
                  'Attributed έσοδα καμπανιών ÷ συνολικό κόστος marketing. Είναι το βασικό KPI για το paid κομμάτι, γιατί περιλαμβάνει και media spend και λοιπά έξοδα marketing.',
              },
              {
                k: 'e-shop ROI',
                v: formatMultiplierValue(performanceSummary.storeEfficiency),
                note: ecomm.hasData
                  ? 'Καθαρός τζίρος e-shop (χωρίς ΦΠΑ) ÷ συνολικό κόστος marketing. Δείχνει τη συνολική απόδοση του store για την περίοδο.'
                  : 'Απαιτεί συνδεδεμένο e-shop για την επιλεγμένη περίοδο.',
              },
              {
                k: 'Revenue Gap',
                v:
                  performanceSummary.revenueGap == null
                    ? '—'
                    : performanceSummary.revenueGap >= 0
                      ? `+${formatCurrencyCompact(performanceSummary.revenueGap)}`
                      : formatCurrencyCompact(performanceSummary.revenueGap),
                note: ecomm.hasData
                  ? 'Διαφορά καθαρού τζίρου e-shop (χωρίς ΦΠΑ) μείον attributed έσοδα καμπανιών για την ίδια περίοδο. Χρήσιμο για να δεις τι μέρος του συνολικού τζίρου δεν εξηγείται από το platform attribution.'
                  : 'Χωρίς συνδεδεμένο e-shop δεν μπορεί να υπολογιστεί.',
              },
            ];

            const tacticalRows: RoasAnalysisMetricRow[] = [
              {
                k: 'Platform ROAS',
                v: formatMultiplierValue(performanceSummary.platformRoas),
                note:
                  'Έσοδα καμπανιών ÷ ad spend. Tactical metric για optimization καμπανιών και συγκρίσεις ανά πλατφόρμα ή channel.',
              },
              {
                k: 'Store ROAS',
                v: formatMultiplierValue(performanceSummary.storeRoas),
                note: ecomm.hasData
                  ? 'Καθαρός τζίρος e-shop (χωρίς ΦΠΑ) ÷ ad spend. Δείχνει πόσα ευρώ συνολικού τζίρου αντιστοιχούν σε κάθε €1 media spend.'
                  : 'Απαιτεί συνδεδεμένο e-shop για την επιλεγμένη περίοδο.',
              },
              {
                k: 'CVR καμπανιών',
                v:
                  performanceSummary.cvr != null && performanceSummary.cvr > 0
                    ? formatPercent(performanceSummary.cvr, 2)
                    : '—',
                note:
                  totalClicks > 0
                    ? `${formatNumber(metrics.totalConversions, 0)} μετατροπές / ${formatNumber(totalClicks, 0)} κλικ στην περίοδο.`
                    : 'Μετατροπές / κλικ (conversion rate).',
              },
            ];

            return (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <RoasAnalysisGroupSection
                    variant="full"
                    title="Owner View"
                    description="Τα βασικά KPIs της σελίδας χρησιμοποιούν ως denominator το συνολικό κόστος marketing: διαφήμιση + λοιπά έξοδα marketing."
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {ownerRows.map((row) => (
                        <RoasAnalysisMetricCard key={row.k} row={row} />
                      ))}
                    </div>
                  </RoasAnalysisGroupSection>

                  <RoasAnalysisGroupSection
                    variant="ad"
                    title="Paid Media View"
                    description="Τα tactical metrics κρατούν denominator μόνο το ad spend, ώστε να βοηθούν στο optimization των campaigns."
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {tacticalRows.map((row) => (
                        <RoasAnalysisMetricCard key={row.k} row={row} />
                      ))}
                    </div>
                  </RoasAnalysisGroupSection>
                </div>
                <div className="space-y-2">
                  {performanceSummary.monthlyRateHints.length > 0 && (
                    <p className="text-[11px] text-[#059669] leading-relaxed">
                      Marketing Expenses inputs: {performanceSummary.monthlyRateHints.join(' · ')}
                    </p>
                  )}
                  <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
                    Τα επιπλέον κόστη marketing ορίζονται στη σελίδα <span className="font-medium text-[var(--nts-accent)]">Finances</span>. Τα σταθερά μηνιαία (π.χ. agency) μετρούν πλήρες ποσό για κάθε ημερολογιακό μήνα που περιλαμβάνεται· άλλες γραμμές αναλογικά στις {performanceSummary.periodDayCount} ημέρες.
                  </p>
                </div>
              </div>
            );
          })()}
        </Card>
      </div>

      {/* Section 2: Revenue Trend */}
      {trendData.length > 0 && (
        <Card padding="lg">
          <CardHeader
            title="Τάση Εσόδων"
            subtitle={
              <>
                {ecomm.hasData
                  ? `Οργανικά έσοδα, καμπάνιες και e-shop ανά ημέρα (${formatPeriodDate(periodDates.fromDate)} — ${formatPeriodDate(periodDates.toDate)})`
                  : `Οργανικά έσοδα και καμπάνιες ανά ημέρα (${formatPeriodDate(periodDates.fromDate)} — ${formatPeriodDate(periodDates.toDate)})`}
                {organicUsesChannelFallback && (
                  <span className="block text-[11px] font-normal text-[#9CA3AF] mt-1.5 leading-snug">
                    Όταν λείπει το ημερήσιο organic στο sync, η γραμμή Organic εκτιμάται από το σύνολο organic στους πίνακες καναλιών GA4 (ομοιόμορφα στο εύρος sync, κλιμακωμένα στην περίοδο).
                  </span>
                )}
              </>
            }
            icon={<TrendingUp size={20} className="text-[var(--nts-accent)]" />}
          />
          <div ref={chartRef} className="w-full" style={{ minHeight: 320, position: 'relative' }}>
            <AreaChart width={chartWidth} height={300} data={trendData} margin={{ top: 10, right: 10, left: 10, bottom: 24 }}>
              <defs>
                <linearGradient id="organicGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="campaignGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F97316" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="storeRevGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => (typeof d === 'string' ? formatTrendDayLabel(d) : String(d))}
                interval="preserveStartEnd"
                minTickGap={28}
                angle={trendData.length > 14 ? -35 : 0}
                textAnchor={trendData.length > 14 ? 'end' : 'middle'}
                height={trendData.length > 14 ? 56 : 32}
                tick={{ fill: '#57606a', fontSize: 11 }}
                axisLine={{ stroke: '#d0d7de' }}
                tickLine={{ stroke: '#d0d7de' }}
              />
              <YAxis
                tickFormatter={(v) =>
                  Math.abs(v) >= 1000 ? `€${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}K` : `€${Math.round(v)}`
                }
                tick={{ fill: '#57606a', fontSize: 12 }}
                axisLine={{ stroke: '#d0d7de' }}
                tickLine={{ stroke: '#d0d7de' }}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #d0d7de',
                  borderRadius: '6px',
                  fontSize: '12px',
                  padding: '8px 12px',
                }}
                formatter={(value: any, name?: string) => [
                  formatCurrencyCompact((value as number) || 0),
                  name === 'organic'
                    ? 'Οργανικά έσοδα'
                    : name === 'storeRevenue'
                      ? 'Τζίρος e-shop'
                      : 'Έσοδα καμπανιών (πλατφόρμα)',
                ]}
                labelFormatter={(label) =>
                  typeof label === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(label)
                    ? formatTrendDayLabel(label)
                    : String(label)
                }
                labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
              />
              <Legend
                formatter={(value) =>
                  value === 'organic' ? 'Οργανικά έσοδα' : value === 'storeRevenue' ? 'Τζίρος e-shop' : 'Καμπάνιες (πλατφόρμα)'
                }
                wrapperStyle={{ fontSize: 12 }}
              />
              <Area
                type="linear"
                dataKey="organic"
                stroke="#3B82F6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#organicGrad)"
                name="organic"
                isAnimationActive={false}
              />
              <Area
                type="linear"
                dataKey="campaigns"
                stroke="#F97316"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#campaignGrad)"
                name="campaigns"
                isAnimationActive={false}
              />
              {ecomm.hasData && (
                <Area
                  type="linear"
                  dataKey="storeRevenue"
                  stroke="#10B981"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#storeRevGrad)"
                  name="storeRevenue"
                  isAnimationActive={false}
                />
              )}
            </AreaChart>
          </div>
        </Card>
      )}

      {/* Section 3: Budget Utilization */}
      {monthlyBudget > 0 && (
        <Card padding="lg">
          <CardHeader
            title="Ads Budget"
            subtitle="Μηνιαίο budget σε σύγκριση με το πραγματικό spend"
            icon={<Wallet size={20} className="text-[var(--nts-accent)]" />}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4">
            <div className="text-center">
              <p className="text-xs text-[var(--nts-medium-gray)] uppercase tracking-wider mb-1">Μηνιαίο Budget</p>
              <p className="text-2xl font-bold font-mono text-[var(--nts-charcoal)]">
                {formatCurrencyCompact(monthlyBudget)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-[var(--nts-medium-gray)] uppercase tracking-wider mb-1">Πραγματικό Spend</p>
              <p className="text-2xl font-bold font-mono text-[var(--nts-charcoal)]">
                {formatCurrencyCompact(totalSpendForBudget)}
              </p>
            </div>
            <div className="text-center">
              <p className="text-xs text-[var(--nts-medium-gray)] uppercase tracking-wider mb-1">Υπόλοιπο</p>
              <p className={`text-2xl font-bold font-mono ${monthlyBudget - totalSpendForBudget >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                {formatCurrencyCompact(monthlyBudget - totalSpendForBudget)}
              </p>
            </div>
          </div>
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--nts-medium-gray)]">Αξιοποίηση</span>
              <span className="text-xs font-mono font-bold text-[var(--nts-charcoal)]">
                {formatPercent(Math.min(budgetUtilization, 100))}
              </span>
            </div>
            <div className="w-full h-3 bg-[var(--nts-light-gray)] rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(budgetUtilization, 100)}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                style={{
                  backgroundColor: budgetUtilization > 100 ? '#EF4444' : budgetUtilization > 80 ? '#F59E0B' : '#22C55E',
                }}
              />
            </div>
            {budgetUtilization > 100 && (
              <p className="text-xs text-[#EF4444] mt-2 flex items-center gap-1">
                <ArrowUpRight size={12} />
                Υπέρβαση budget κατά {formatPercent(budgetUtilization - 100)}
              </p>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

function RoiHeroKpiCard({
  variant,
  icon,
  label,
  value,
  subtitle,
  color,
  tooltip,
  iconWrapClass,
}: {
  variant: 'eshop' | 'campaign';
  icon: ReactNode;
  label: string;
  value: string;
  subtitle: string;
  color: string;
  tooltip?: string;
  iconWrapClass: string;
}) {
  const shell =
    variant === 'eshop'
      ? 'border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 via-white to-white shadow-[0_8px_30px_-12px_rgba(16,185,129,0.35)] ring-1 ring-emerald-500/10'
      : 'border-sky-200/80 bg-gradient-to-br from-sky-50/90 via-white to-white shadow-[0_8px_30px_-12px_rgba(14,165,233,0.35)] ring-1 ring-sky-500/10';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="h-full"
    >
      <div
        className={`relative flex h-full min-h-[140px] flex-col overflow-hidden rounded-2xl border-2 p-5 sm:min-h-[152px] sm:p-6 ${shell}`}
      >
        <div
          className={`pointer-events-none absolute inset-x-0 top-0 h-1 ${variant === 'eshop' ? 'bg-gradient-to-r from-emerald-500 via-emerald-400 to-teal-400' : 'bg-gradient-to-r from-sky-500 via-blue-500 to-indigo-500'}`}
          aria-hidden
        />
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-5">
          <div
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl sm:h-16 sm:w-16 ${iconWrapClass} shadow-inner`}
            aria-hidden
          >
            {icon}
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#64748B] sm:text-xs">
                {label}
              </span>
              {tooltip ? <Tooltip content={tooltip} size={12} /> : null}
            </div>
            <p
              className="text-3xl font-bold font-mono leading-none tracking-tight tabular-nums sm:text-4xl"
              style={{ color }}
            >
              {value}
            </p>
            {subtitle ? (
              <p className="max-w-xl text-[12px] leading-snug text-[#64748B] sm:text-[13px]">{subtitle}</p>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function RoiKpiTabCard({
  icon,
  label,
  value,
  subtitle,
  color,
  tooltip,
  iconWrapClass,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  subtitle: string;
  color: string;
  tooltip?: string;
  iconWrapClass: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="h-full">
      <div className="group flex h-full min-h-[92px] items-center gap-3 rounded-xl border border-[#E8EAED] bg-white px-3.5 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-[box-shadow,border-color] duration-200 hover:border-[#D1D5DB] hover:shadow-[0_4px_12px_rgba(15,23,42,0.08)] sm:gap-4 sm:px-4 sm:py-4">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${iconWrapClass}`}
          aria-hidden
        >
          {icon}
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[11px] font-medium leading-snug text-[#6B7280] sm:text-xs">{label}</span>
            {tooltip ? <Tooltip content={tooltip} size={12} /> : null}
          </div>
          <p
            className="text-lg font-bold font-mono leading-tight tracking-tight tabular-nums sm:text-xl"
            style={{ color }}
          >
            {value}
          </p>
          {subtitle ? (
            <p className="line-clamp-2 text-[10px] leading-snug text-[#9CA3AF] sm:text-[11px]">{subtitle}</p>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

function MetricCard({
  icon, label, value, subtitle, color, tooltip,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  subtitle: string;
  color: string;
  tooltip?: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <Card padding="md" hover className="h-full">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg border border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)] flex items-center justify-center text-[var(--nts-medium-gray)] flex-shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-xs text-[var(--nts-medium-gray)]">{label}</p>
              {tooltip && <Tooltip content={tooltip} size={12} />}
            </div>
            <p className="text-xl font-bold font-mono mt-0.5" style={{ color }}>{value}</p>
            {subtitle && <p className="text-[10px] text-[var(--nts-medium-gray)] mt-0.5">{subtitle}</p>}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

