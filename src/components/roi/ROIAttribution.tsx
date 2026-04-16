import { useMemo, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Euro,
  TrendingUp,
  Target,
  BarChart3,
  Wallet,
  ShoppingBag,
  ArrowUpRight,
  Loader2,
  Database,
  Leaf,
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
import { Card, CardHeader, Button, Tooltip, PageHeader } from '../common';
import { useOrganic } from '../../hooks/useOrganic';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import { useBrand } from '../../hooks/useBrand';
import { useDashPeriod } from '../../hooks/useDashPeriod';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { DateRangePicker } from '../ui/DateRangePicker';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useGA4Data } from '../../hooks/useGA4Data';
import { CampaignsService, OrganicService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import {
  calculateCampaignMetrics,
  sumDailyRevenueInPeriod,
  bucketOverlapFraction,
  metaUsesLegacyMonthBuckets,
  buildRoiTrendSeriesDaily,
  mergeGa4OrganicDailyWithChannelFallback,
  formatTrendDayLabel,
  ROI_PERCENT_CALC_TOOLTIP,
} from '../../utils/roiUtils';
import { computeMarketingOverheadForPeriod, eachDateInclusive } from '../../utils/marketingCostPeriod';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import type { Campaign, MarketingCostLine } from '../../types';

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

type KpiTabId = 'campaignRoi' | 'trueRoi' | 'eshopRevenue' | 'revenue' | 'organic' | 'conversionsRate';

/** Σειρά εμφάνισης — ίδιο visual language με Campaigns / Competitive Intelligence (segmented strip). */
const KPI_ORDER: KpiTabId[] = ['trueRoi', 'campaignRoi', 'eshopRevenue', 'revenue', 'organic', 'conversionsRate'];

export function ROIAttribution({ embedded }: ROIAttributionProps = {}) {
  const { byMonth: organicByMonth, hasOrganicRevenue: hasOrganic } = useOrganic();
  const { campaigns, hasImported: hasCampaigns } = useCampaigns();
  const campaignsAll = campaigns as Campaign[];
  const { activeStrategy } = useActiveStrategy();
  const ecomm = useEcommerceSummary();
  const {
    organicRevenueByDay: ga4OrganicByDay,
    totalOrganicRevenueFromChannels,
    dateRange: ga4DateRange,
  } = useGA4Data();
  const { currentBrand } = useBrand();
  const queryClient = useQueryClient();
  const [seeding, setSeeding] = useState(false);
  const [eshopCompareTab, setEshopCompareTab] = useState<'compare' | 'organic'>('compare');
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

  const dateFilteredCampaigns = useMemo(() => {
    const all = campaigns as Campaign[];
    const { fromDate, toDate } = periodDates;

    return all.filter(c => {
      const dm = (c as any).dailyMetrics as Record<string, any> | undefined;
      if (dm && Object.keys(dm).length > 0) {
        const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
        return Object.keys(dm).some(dateKey =>
          bucketOverlapFraction(dateKey, fromDate, toDate, { metaMonthBuckets }) > 0
        );
      }
      const start = c.start_date ? new Date(c.start_date) : null;
      const period = c.period ? new Date(c.period) : null;
      const cutoff = new Date(fromDate);
      if (start && start >= cutoff) return true;
      if (period && !isNaN(period.getTime()) && period >= cutoff) return true;
      if (!start && !period) return true;
      return false;
    }).map(c => {
      const dm = (c as any).dailyMetrics as Record<string, any> | undefined;
      if (!dm || Object.keys(dm).length === 0) return c;

      const filteredDm: Record<string, any> = {};
      let spend = 0, impr = 0, clicks = 0, convs = 0, convValue = 0;
      const convActions: Record<string, { conversions: number; value: number }> = {};

      const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
      for (const [dateKey, metrics] of Object.entries(dm)) {
        const frac = bucketOverlapFraction(dateKey, fromDate, toDate, { metaMonthBuckets });
        if (frac <= 0) continue;
        filteredDm[dateKey] = metrics;
        spend += ((metrics as any).amount_spent || 0) * frac;
        impr += ((metrics as any).impressions || 0) * frac;
        clicks += ((metrics as any).clicks || 0) * frac;
        convs += ((metrics as any).conversions || 0) * frac;
        convValue += ((metrics as any).conversion_value || 0) * frac;
        // Aggregate conversionActions with fractional scaling so getEffectiveConversionValue
        // reads filtered (not full-history) values for Meta campaigns.
        const ma = (metrics as any).conversionActions;
        if (ma) {
          for (const [label, vals] of Object.entries(ma as Record<string, { conversions: number; value: number }>)) {
            if (!convActions[label]) convActions[label] = { conversions: 0, value: 0 };
            convActions[label].conversions += (vals.conversions || 0) * frac;
            convActions[label].value += (vals.value || 0) * frac;
          }
        }
      }
      spend = Math.round(spend * 100) / 100;
      return {
        ...c,
        dailyMetrics: filteredDm,
        conversionActions: convActions,
        amount_spent: spend,
        impressions: Math.round(impr),
        clicks: Math.round(clicks),
        conversions: convs,
        conversion_value: convValue,
        ctr: impr > 0 ? (clicks / impr) * 100 : 0,
        roas: spend > 0 ? convValue / spend : 0,
      };
    });
  }, [campaigns, periodDates]);

  const campaignsTyped = dateFilteredCampaigns;
  const hasData = hasOrganic || hasCampaigns;
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
  const ecommRevenueByDay = useMemo(() => {
    const o: Record<string, number> = {};
    for (const r of ecomm.dailyRevenue) {
      o[r.date] = r.revenue;
    }
    return o;
  }, [ecomm.dailyRevenue]);

  const ecommRevenueInPeriod = useMemo(
    () => sumDailyRevenueInPeriod(ecommRevenueByDay, periodDates.fromDate, periodDates.toDate),
    [ecommRevenueByDay, periodDates.fromDate, periodDates.toDate]
  );

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
    ]
  );

  /** Organic στην επιλεγμένη περίοδο (ίδιο άθροισμα με τη γραμμή Organic στο chart τάσης). */
  const organicRevenueInPeriod = useMemo(
    () => trendData.reduce((s, r) => s + (r.organic || 0), 0),
    [trendData]
  );

  /** Organic (περίοδος) + conversion value καμπανιών (περίοδος) — για Blended ROAS. */
  const periodBlendedRevenue = useMemo(
    () => organicRevenueInPeriod + metrics.totalRevenue,
    [organicRevenueInPeriod, metrics.totalRevenue]
  );

  const kpiPanelConfig = useMemo(() => {
    const cvr = totalClicks > 0 ? (metrics.totalConversions / totalClicks) * 100 : 0;
    const campaignRoiMultiple =
      metrics.totalSpend > 0 ? metrics.totalRevenue / metrics.totalSpend : null;
    const trueRoiMultiple =
      ecomm.hasData && metrics.totalSpend > 0
        ? ecommRevenueInPeriod / metrics.totalSpend
        : null;
    return {
      campaignRoi: {
        icon: <TrendingUp size={22} strokeWidth={2} />,
        label: 'Campaign ROI',
        value: formatMultiplierValue(campaignRoiMultiple),
        subtitle: 'Conversion value καμπανιών / ad spend',
        color:
          campaignRoiMultiple != null && !Number.isNaN(campaignRoiMultiple)
            ? campaignRoiMultiple >= 1
              ? '#059669'
              : '#EF4444'
            : '#111827',
        iconWrapClass: 'bg-emerald-50 text-emerald-600',
        tooltip:
          'Campaign ROI σε multiplier μορφή: έσοδα καμπανιών / ad spend. Το 1,00x είναι break-even. Δεν χρησιμοποιεί e-shop revenue.',
      },
      trueRoi: {
        icon: <ShoppingBag size={22} strokeWidth={2} />,
        label: 'True ROI',
        value: formatMultiplierValue(trueRoiMultiple),
        subtitle: ecomm.hasData ? 'e-shop revenue / ad spend' : 'Χωρίς synced e-shop data',
        color:
          trueRoiMultiple != null && !Number.isNaN(trueRoiMultiple)
            ? trueRoiMultiple >= 1
              ? '#059669'
              : '#EF4444'
            : '#111827',
        iconWrapClass: 'bg-emerald-50 text-emerald-600',
        tooltip:
          'True ROI σε multiplier μορφή: e-shop revenue / ad spend, για την επιλεγμένη περίοδο. Το 1,00x είναι break-even.',
      },
      eshopRevenue: {
        icon: <ShoppingBag size={22} strokeWidth={2} />,
        label: 'e-shop Revenue',
        value: ecomm.hasData ? formatCurrencyCompact(ecommRevenueInPeriod) : '—',
        subtitle: ecomm.hasData ? 'Στην επιλεγμένη περίοδο · synced e-shop revenue' : 'Χωρίς synced e-shop data',
        color: '#111827',
        iconWrapClass: 'bg-emerald-50 text-emerald-600',
        tooltip:
          'Συνολικό e-shop Revenue για την επιλεγμένη περίοδο, από τα συνδεδεμένα καταστήματα και το συγχρονισμένο ημερήσιο revenue.',
      },
      revenue: {
        icon: <Euro size={22} strokeWidth={2} />,
        label: 'Revenue',
        value: formatCurrencyCompact(metrics.totalRevenue),
        subtitle: hasCampaigns
          ? `${campaignsTyped.length} καμπάνιες · conversion value`
          : 'Conversion value (ads)',
        color: '#111827',
        iconWrapClass: 'bg-slate-100 text-slate-600',
        tooltip:
          'Έσοδα μόνο από καμπάνιες: conversion value Google Ads / Meta κ.λπ. για την επιλεγμένη περίοδο (όχι organic). Το organic εμφανίζεται στο επόμενο KPI και στο chart.',
      },
      organic: {
        icon: <Leaf size={22} strokeWidth={2} />,
        label: 'Organic',
        value:
          hasOrganic || organicRevenueInPeriod > 0
            ? formatCurrencyCompact(organicRevenueInPeriod)
            : '—',
        subtitle: hasOrganic
          ? 'Στην περίοδο (import · κατανομή ανά ημέρα)'
          : organicRevenueInPeriod > 0
            ? 'Στην περίοδο (GA4 · ημερήσια ανά κανάλι)'
            : 'Χωρίς import · συγχρονίστε GA4',
        color: '#111827',
        iconWrapClass: 'bg-emerald-50 text-emerald-700',
        tooltip:
          'Οργανικά έσοδα για την επιλεγμένη περίοδο (ίδιο με τη γραμμή Organic στο chart). Αν υπάρχει μηνιαίο import, προτεραιότητα έχει η ομοιόμορφη κατανομή ανά ημέρα· αλλιώς χρησιμοποιούνται τα ημερήσια organic revenue από το τελευταίο GA4 sync (default channel groups).',
      },
      conversionsRate: {
        icon: <Target size={22} strokeWidth={2} />,
        label: 'Conversions Rate',
        value: cvr > 0 ? formatPercent(cvr, 2) : '—',
        subtitle:
          totalClicks > 0
            ? `${formatNumber(metrics.totalConversions, 0)} μετατροπές / ${formatNumber(totalClicks, 0)} κλικ`
            : 'Μετατροπές / κλικ (CVR)',
        color: '#111827',
        iconWrapClass: 'bg-amber-50 text-amber-600',
        tooltip: 'Ποσοστό μετατροπών προς κλικ όλων των καμπανιών στο διάστημα (conversion rate, όχι CTR).',
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
  }, [
    metrics,
    totalClicks,
    hasOrganic,
    hasCampaigns,
    campaignsTyped.length,
    organicRevenueInPeriod,
    ecommRevenueInPeriod,
    ecomm.hasData,
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
                Μέτρηση απόδοσης καμπανιών και εσόδων
              </p>
            }
          />
        )}
        <Card padding="lg">
          <div className="text-center py-16">
            <BarChart3 size={48} className="mx-auto text-[var(--nts-medium-gray)] mb-4" />
            <h3 className="text-lg font-semibold text-[var(--nts-charcoal)] mb-2">Δεν υπάρχουν δεδομένα</h3>
            <p className="text-[var(--nts-medium-gray)] max-w-md mx-auto mb-6">
              Συνδέστε campaigns και organic έσοδα από τις Συνδέσεις για να εμφανιστεί η απόδοση — ή φόρτωσε ενδεικτικά δεδομένα.
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
              Μέτρηση απόδοσης καμπανιών και εσόδων
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
            </div>
          }
        />
      )}

      {/* KPI row: εικονίδιο αριστερά (pastel box), label + τιμή + υπότιτλος δεξιά */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 lg:gap-4">
        {KPI_ORDER.map((id) => (
          <RoiKpiTabCard key={id} {...kpiPanelConfig[id]} />
        ))}
      </div>

      {/* ROAS Analysis — όλες οι εκδοχές απόδοσης σε ένα block */}
      <div id="roas-analysis" className="scroll-mt-4">
      <Card padding="lg" className="border border-[var(--nts-border-gray)]">
        <CardHeader
          title="Ανάλυση απόδοσης (ROAS & ROI)"
          subtitle={
            <>
              Όλες οι μετρήσεις απόδοσης διαφήμισης σε ένα σημείο. Περίοδος πίνακα:{' '}
              <span className="font-medium text-[var(--nts-charcoal)]">
                {formatPeriodDate(periodDates.fromDate)} — {formatPeriodDate(periodDates.toDate)}
              </span>{' '}
              ({eachDateInclusive(periodDates.fromDate, periodDates.toDate).length} ημέρες). Τα μηνιαία κόστη (π.χ. agency) εμφανίζονται ως{' '}
              <strong>αναλογία</strong> σε αυτές τις ημέρες, όχι ως πλήρες μηνιαία ποσά.
            </>
          }
          icon={<BarChart3 size={20} className="text-[var(--nts-accent)]" />}
        />
        {(() => {
          const campaignsRoas = metrics.roas;
          const blendedRoas = metrics.totalSpend > 0 ? periodBlendedRevenue / metrics.totalSpend : 0;
          const trueRoas =
            ecomm.hasData && metrics.totalSpend > 0 ? ecommRevenueInPeriod / metrics.totalSpend : null;
          const campaignRoiMultiple = metrics.totalSpend > 0 ? metrics.totalRevenue / metrics.totalSpend : null;
          const profit = metrics.totalRevenue - metrics.totalSpend;
          const fullBlendedRoas = totalMarketingCost > 0 ? periodBlendedRevenue / totalMarketingCost : 0;
          const fullTrueRoas =
            ecomm.hasData && totalMarketingCost > 0 ? ecommRevenueInPeriod / totalMarketingCost : null;
          const fullRoiMultiple = totalMarketingCost > 0 ? metrics.totalRevenue / totalMarketingCost : null;
          const periodDayCount = eachDateInclusive(periodDates.fromDate, periodDates.toDate).length;
          const mcl: MarketingCostLine[] = activeStrategy?.marketingCostLines ?? [];
          const monthlyRateHints: string[] = [];
          for (const l of mcl) {
            if (l.kind === 'fixed_monthly' && l.amountEUR > 0) {
              monthlyRateHints.push(`${l.label?.trim() || 'Γραμμή'}: ${formatCurrency(l.amountEUR, 0)}/μήνα`);
            }
            if (l.kind === 'percent_of_budget' && l.percent > 0) {
              monthlyRateHints.push(
                `${l.label?.trim() || 'Γραμμή'}: ${formatNumber(l.percent, 1)}% του μην. budget`
              );
            }
            if (l.kind === 'one_off_month' && l.amountEUR > 0) {
              monthlyRateHints.push(
                `${l.label?.trim() || 'Εφάπαξ'}: ${formatCurrency(l.amountEUR, 0)} (${l.month})`
              );
            }
          }
          const adSpendRows: RoasAnalysisMetricRow[] = [
            {
              k: 'ROAS καμπανιών (πλατφόρμα)',
              v: campaignsRoas > 0 ? `${formatNumber(campaignsRoas, 2)}x` : '—',
              note: 'Έσοδα καμπανιών (conversion value από platforms) ÷ Ad Spend. Χρήσιμο για βελτιστοποίηση ανά καμπάνια.',
            },
            {
              k: 'Blended ROAS',
              v: blendedRoas > 0 ? `${formatNumber(blendedRoas, 2)}x` : '—',
              note: 'Έσοδα organic + καμπανιών για την επιλεγμένη περίοδο (ίδια βάση με το chart) ÷ Ad Spend. Ευρύτερη εικόνα από τον ROAS καμπανιών (πλατφόρμα).',
            },
            ...(trueRoas != null && trueRoas > 0
              ? [
                  {
                    k: 'True ROAS',
                    v: `${formatNumber(trueRoas, 2)}x`,
                    note: 'Άθροισμα ημερήσιου e-shop revenue στην επιλεγμένη περίοδο ÷ Ad Spend (όχι το σύνολο 90ημ. της σύνοψης).',
                  } satisfies RoasAnalysisMetricRow,
                ]
              : []),
            {
              k: 'Campaign ROI',
              v: formatMultiplierValue(campaignRoiMultiple),
              note: 'Ίδιος υπολογισμός σε multiplier μορφή: έσοδα καμπανιών ÷ Ad Spend. Το 1,00x είναι break-even.',
            },
          ];

          const costRows: RoasAnalysisMetricRow[] = [
            {
              k: 'Επιπλέον κόστη (εκτός ad spend)',
              v:
                marketingOverhead.total > 0 ||
                (activeStrategy?.marketingCostLines && activeStrategy.marketingCostLines.length > 0) ? (
                  <div className="flex flex-col items-start gap-1">
                    <span>
                      {marketingOverhead.total > 0
                        ? formatCurrencyCompact(marketingOverhead.total)
                        : formatCurrencyCompact(0)}{' '}
                      <span className="text-[10px] font-normal text-[#6B7280]">στην περίοδο</span>
                    </span>
                    {monthlyRateHints.length > 0 && (
                      <span className="max-w-full text-[10px] font-normal font-sans leading-snug text-[#059669]">
                        {monthlyRateHints.join(' · ')}
                      </span>
                    )}
                  </div>
                ) : (
                  '—'
                ),
              note: (
                <>
                  Ποσό που αντιστοιχεί στις {periodDayCount} ημέρες ({formatPeriodDate(periodDates.fromDate)} —{' '}
                  {formatPeriodDate(periodDates.toDate)}). Τα σταθερά μηνιαία (π.χ. €800) χρεώνονται{' '}
                  <strong>ημέρα-ημέρα</strong>· για πλήρη μήνα στον πίνακα χρειάζεται περίοδος ~όλου του μήνα. Ρυθμίσεις: Channel
                  Activation.
                </>
              ),
            },
            {
              k: 'Σύνολο κόστους marketing',
              v: metrics.totalSpend > 0 || marketingOverhead.total > 0 ? formatCurrencyCompact(totalMarketingCost) : '—',
              note: 'Ad Spend + επιπλέον κόστη. Βάση για «πλήρες» ROAS/ROI παρακάτω.',
            },
          ];

          const fullCostRows: RoasAnalysisMetricRow[] = [
            {
              k: 'Blended ROAS (πλήρες κόστος)',
              v: fullBlendedRoas > 0 ? `${formatNumber(fullBlendedRoas, 2)}x` : '—',
              note: 'Organic + καμπανιών (για την επιλεγμένη περίοδο) ÷ σύνολο κόστους marketing. Πιο ρεαλιστικό όταν υπάρχουν σημαντικά έξοδα εκτός media.',
            },
            ...(fullTrueRoas != null && fullTrueRoas > 0
              ? [
                  {
                    k: 'True ROAS (πλήρες κόστος)',
                    v: `${formatNumber(fullTrueRoas, 2)}x`,
                    note: 'Άθροισμα e-shop revenue στην περίοδο ÷ σύνολο κόστους marketing.',
                  } satisfies RoasAnalysisMetricRow,
                ]
              : []),
            {
              k: 'ROI (πλήρες κόστος marketing)',
              v: formatMultiplierValue(fullRoiMultiple),
              note: 'Έσοδα καμπανιών ÷ σύνολο κόστους marketing, σε multiplier μορφή. Το 1,00x είναι break-even.',
            },
          ];

          return (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <RoasAnalysisGroupSection
                  variant="ad"
                  title="Με βάση το ad spend"
                  description="ROAS και ROI σε μορφή multiplier όταν στον παρονομαστή είναι μόνο η δαπάνη διαφημίσεων (όχι agency κ.λπ.)."
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {adSpendRows.map((row) => (
                      <RoasAnalysisMetricCard key={row.k} row={row} />
                    ))}
                  </div>
                </RoasAnalysisGroupSection>

                <RoasAnalysisGroupSection
                  variant="cost"
                  title="Κόστη εκτός media"
                  description="Τι προστίθεται στο ad spend για να σχηματίσει το πλήρες κόστος marketing."
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {costRows.map((row) => (
                      <RoasAnalysisMetricCard key={row.k} row={row} />
                    ))}
                  </div>
                </RoasAnalysisGroupSection>

                <RoasAnalysisGroupSection
                  variant="full"
                  title="Πλήρες κόστος marketing"
                  description="Απόδοση όταν στο κόστος συμπεριλαμβάνονται και τα επιπλέον έξοδα (ίδια έσοδα, ευρύτερος παρονομαστής)."
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {fullCostRows.map((row) => (
                      <RoasAnalysisMetricCard key={row.k} row={row} />
                    ))}
                  </div>
                </RoasAnalysisGroupSection>
              </div>
              {profit !== 0 && metrics.totalSpend > 0 && (
                <p className="text-[12px] text-[var(--nts-medium-gray)] flex flex-wrap items-center gap-1.5">
                  Απόδοση σε ευρώ: κέρδος από έσοδα καμπανιών έναντι spend ≈{' '}
                  <span className="font-mono font-medium">{formatCurrencyCompact(profit)}</span> σε{' '}
                  {formatCurrencyCompact(metrics.totalSpend)} spend.
                  <Tooltip content={ROI_PERCENT_CALC_TOOLTIP} size={12}>
                    <span className="inline-flex cursor-help rounded text-[#9CA3AF] hover:text-[var(--nts-medium-gray)]" tabIndex={0}>
                      ⓘ
                    </span>
                  </Tooltip>
                </p>
              )}
              <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
                Επιπλέον κόστη marketing ορίζονται στο{' '}
                <a href="#channels" className="font-medium text-[var(--nts-accent)] hover:underline">
                  Channel Activation
                </a>
                .
              </p>
            </div>
          );
        })()}
      </Card>
      </div>

      {/* E-commerce vs Campaigns Revenue */}
      {ecomm.hasData && (
        <Card padding="lg">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <ShoppingBag size={18} className="text-[var(--nts-accent)] shrink-0" />
              <h3 className="text-sm font-semibold text-[#1A1A1A]">e-shop vs έσοδα καμπανιών (πλατφόρμα)</h3>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex gap-0.5 rounded-lg bg-[#F5F5F5] p-0.5">
                <button
                  type="button"
                  onClick={() => setEshopCompareTab('compare')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    eshopCompareTab === 'compare'
                      ? 'bg-white text-[#111827] shadow-sm'
                      : 'text-[#6B7280] hover:text-[#111827]'
                  }`}
                >
                  Σύγκριση
                </button>
                <button
                  type="button"
                  onClick={() => setEshopCompareTab('organic')}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors inline-flex items-center gap-1.5 ${
                    eshopCompareTab === 'organic'
                      ? 'bg-white text-[#111827] shadow-sm'
                      : 'text-[#6B7280] hover:text-[#111827]'
                  }`}
                >
                  <Leaf size={12} className="text-emerald-600" />
                  Organic
                </button>
              </div>
              <span className="text-[10px] text-[#9CA3AF] bg-[#F3F4F6] px-1.5 py-0.5 rounded">
                e-shop: επιλεγμένη περίοδος
              </span>
            </div>
          </div>

          {eshopCompareTab === 'compare' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <MetricCard
                  icon={<ShoppingBag size={20} />}
                  label="e-shop Revenue"
                  value={formatCurrencyCompact(ecommRevenueInPeriod)}
                  subtitle="Άθροισμα ημερήσιων παραγγελιών στην περίοδο"
                  color="#10B981"
                  tooltip="Καθαρά έσοδα από συνδεδεμένα e-shop για τις ημερομηνίες που καλύπτει η επιλογή πάνω (ίδιο άθροισμα με τη πράσινη γραμμή στο chart τάσης)."
                />
                <MetricCard
                  icon={<Euro size={20} />}
                  label="Έσοδα καμπανιών (πλατφόρμα)"
                  value={formatCurrencyCompact(metrics.totalRevenue)}
                  subtitle="Conversion value όπως το αναφέρουν Google Ads / Meta (ίδια λογική με τη σελίδα Campaigns)"
                  color="var(--nts-charcoal)"
                  tooltip="Άθροισμα conversion value από Google Ads / Meta για την επιλεγμένη περίοδο — χωρίς organic import."
                />
                <MetricCard
                  icon={<BarChart3 size={20} />}
                  label="Revenue Gap"
                  value={(() => {
                    const gap = ecommRevenueInPeriod - metrics.totalRevenue;
                    return gap >= 0 ? `+${formatCurrencyCompact(gap)}` : formatCurrencyCompact(gap);
                  })()}
                  subtitle="e-shop − έσοδα καμπανιών (ads), ίδια περίοδος"
                  color={ecommRevenueInPeriod >= metrics.totalRevenue ? '#22C55E' : '#EF4444'}
                  tooltip="Διαφορά e-shop (άθροισμα ημερών στην περίοδο) μείον conversion value καμπανιών για την ίδια περίοδο."
                />
              </div>
              <p className="text-[11px] text-[#9CA3AF] mt-3 leading-relaxed">
                Οι εκδοχές <strong>ROAS</strong> (συμπεριλαμβανομένου του <strong>True ROAS</strong> από e-shop) εξηγούνται στο παραπάνω block «Ανάλυση απόδοσης (ROAS & ROI)». Στο tab <strong>Organic</strong>: μηνιαίο import (αν υπάρχει) ή ημερήσιο organic revenue από το <strong>GA4</strong> sync.
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-4 py-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white border border-emerald-200">
                  <Leaf size={20} className="text-emerald-700" />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800/90">Organic revenue</p>
                  <p className="text-2xl font-bold font-mono tabular-nums text-[#111827]">
                    {formatCurrencyCompact(organicRevenueInPeriod)}
                  </p>
                  <p className="text-[12px] text-[#4B5563] leading-relaxed">
                    {hasOrganic
                      ? 'Οργανικά έσοδα από μηνιαίο import (ομοιόμορφη κατανομή ανά ημέρα)'
                      : 'Οργανικά έσοδα από το τελευταίο GA4 sync (ημερήσια ανά default channel group, όπου δεν υπάρχει μηνιαίο import για τον μήνα)'}
                    {' '}
                    για την περίοδο{' '}
                    <span className="font-medium">
                      {formatPeriodDate(periodDates.fromDate)} — {formatPeriodDate(periodDates.toDate)}
                    </span>
                    . Το ίδιο ποσό αθροίζει τη γραμμή <strong>Organic</strong> στο «Τάση Εσόδων».
                  </p>
                  {!hasOrganic && organicRevenueInPeriod === 0 && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5 mt-2">
                      Δεν υπάρχει organic import και δεν βρέθηκαν ημερήσια organic έσοδα στο GA4 για αυτές τις ημέρες. Συγχρονίστε το GA4 από τις Συνδέσεις ή εισάγετε μηνιαία organic.
                    </p>
                  )}
                  {!hasOrganic && organicRevenueInPeriod > 0 && (
                    <p className="text-[11px] text-emerald-900/90 bg-emerald-100/60 border border-emerald-200/80 rounded-md px-2 py-1.5 mt-2">
                      Πηγή: GA4 (organic channel groups). Αν κάνετε και import ανά μήνα, εκείνο υπερισχύει ανά μήνα για τη γραμμή Organic.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Section 2: Revenue Trend */}
      {trendData.length > 0 && (
        <Card padding="lg">
          <CardHeader
            title="Τάση Εσόδων"
            subtitle={
              <>
                {ecomm.hasData
                  ? `Organic vs Campaign vs e-shop ανά ημέρα (${formatPeriodDate(periodDates.fromDate)} — ${formatPeriodDate(periodDates.toDate)})`
                  : `Organic vs Campaign ανά ημέρα (${formatPeriodDate(periodDates.fromDate)} — ${formatPeriodDate(periodDates.toDate)})`}
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
                    ? 'Organic revenue'
                    : name === 'storeRevenue'
                      ? 'e-shop revenue'
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
                  value === 'organic' ? 'Organic' : value === 'storeRevenue' ? 'e-shop revenue' : 'Καμπάνιες (πλατφόρμα)'
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
            title="Budget Utilization"
            subtitle="Μηνιαίο budget vs πραγματικό spend"
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

