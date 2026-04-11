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
import { useOrganic, useCampaigns, useActiveStrategy, useBrand } from '../../hooks';
import { useDashPeriod } from '../../hooks/useDashPeriod';
import { useGlobalDate, GLOBAL_PERIOD_OPTIONS } from '../../contexts/GlobalDateContext';
import { DateRangePicker } from '../ui/DateRangePicker';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { CampaignsService, OrganicService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import {
  calculateTotalRevenue,
  calculateCampaignMetrics,
  bucketOverlapFraction,
  metaUsesLegacyMonthBuckets,
  buildRoiTrendSeries,
  ROI_PERCENT_CALC_TOOLTIP,
} from '../../utils/roiUtils';
import { formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import type { Campaign } from '../../types';

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

type KpiTabId = 'roi' | 'revenue' | 'adsRevenue' | 'conversionsRate';

/** Σειρά εμφάνισης — ίδιο visual language με Campaigns / Competitive Intelligence (segmented strip). */
const KPI_ORDER: KpiTabId[] = ['roi', 'revenue', 'adsRevenue', 'conversionsRate'];

export function ROIAttribution({ embedded }: ROIAttributionProps = {}) {
  const { totalOrganicRevenue, byMonth: organicByMonth, hasOrganicRevenue: hasOrganic } = useOrganic();
  const { campaigns, hasImported: hasCampaigns } = useCampaigns();
  const campaignsAll = campaigns as Campaign[];
  const { activeStrategy } = useActiveStrategy();
  const ecomm = useEcommerceSummary();
  const { currentBrand } = useBrand();
  const queryClient = useQueryClient();
  const [seeding, setSeeding] = useState(false);
  const { period: dashPeriod, setPeriod: setDashPeriod, periodDates } = useDashPeriod();
  const { customFrom, customTo, setCustomRange } = useGlobalDate();

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

  const metrics = useMemo(() => calculateCampaignMetrics(campaignsTyped), [campaignsTyped]);
  const totalClicks = useMemo(
    () => campaignsTyped.reduce((sum, c) => sum + (c.clicks || 0), 0),
    [campaignsTyped],
  );
  const totalRevenue = useMemo(
    () => calculateTotalRevenue(totalOrganicRevenue || 0, campaignsTyped),
    [totalOrganicRevenue, campaignsTyped]
  );

  const kpiPanelConfig = useMemo(() => {
    const cvr = totalClicks > 0 ? (metrics.totalConversions / totalClicks) * 100 : 0;
    const roiPct =
      metrics.totalSpend > 0 ? ((metrics.totalRevenue - metrics.totalSpend) / metrics.totalSpend) * 100 : null;
    const revenueSubtitle =
      hasOrganic && hasCampaigns
        ? 'Organic + ads'
        : hasOrganic
          ? 'Organic'
          : 'Ads conversion value';
    return {
      roi: {
        icon: <TrendingUp size={22} strokeWidth={2} />,
        label: 'ROI',
        value:
          roiPct != null && !Number.isNaN(roiPct)
            ? `${roiPct > 0 ? '+' : ''}${formatNumber(roiPct, 1)}%`
            : '—',
        subtitle: '',
        color:
          roiPct != null && !Number.isNaN(roiPct)
            ? roiPct >= 0
              ? '#059669'
              : '#EF4444'
            : '#111827',
        iconWrapClass: 'bg-emerald-50 text-emerald-600',
        tooltip:
          'ROI %: (έσοδα καμπανιών − ad spend) ÷ ad spend. Ο πολλαπλασιαστής ROAS (×) και οι υπόλοιπες εκδοχές απόδοσης είναι στον πίνακα «Ανάλυση απόδοσης (ROAS & ROI)» παρακάτω.',
      },
      revenue: {
        icon: <Euro size={22} strokeWidth={2} />,
        label: 'Revenue',
        value: formatCurrencyCompact(totalRevenue),
        subtitle: revenueSubtitle,
        color: '#111827',
        iconWrapClass: 'bg-slate-100 text-slate-600',
        tooltip:
          'Σύνολο: οργανικά έσοδα (import) + conversion value από Google Ads / Meta κ.λπ. Το organic μπορεί να είναι 0 αν δεν έχει εισαχθεί.',
      },
      adsRevenue: {
        icon: <BarChart3 size={22} strokeWidth={2} />,
        label: 'Ads Revenue',
        value: formatCurrencyCompact(metrics.totalRevenue),
        subtitle: `${campaignsTyped.length} campaigns · conversion value`,
        color: '#111827',
        iconWrapClass: 'bg-green-50 text-green-700',
        tooltip:
          'Έσοδα που αποδίδουν οι πλατφόρμες διαφήμισης (conversion value) στο επιλεγμένο διάστημα.',
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
  }, [metrics, totalRevenue, totalClicks, hasOrganic, hasCampaigns, campaignsTyped]);
  const trendData = useMemo(() => {
    const fromYm = periodDates.fromDate.slice(0, 7);
    const toYm = periodDates.toDate.slice(0, 7);
    return buildRoiTrendSeries(
      organicByMonth,
      campaignsAll,
      ecomm.monthlyRevenue,
      fromYm,
      toYm,
      ecomm.hasData
    );
  }, [organicByMonth, campaignsAll, ecomm.hasData, ecomm.monthlyRevenue, periodDates.fromDate, periodDates.toDate]);

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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {KPI_ORDER.map((id) => (
          <RoiKpiTabCard key={id} {...kpiPanelConfig[id]} />
        ))}
      </div>

      {/* ROAS Analysis — όλες οι εκδοχές απόδοσης σε ένα block */}
      <div id="roas-analysis" className="scroll-mt-4">
      <Card padding="lg" className="border border-[var(--nts-border-gray)]">
        <CardHeader
          title="Ανάλυση απόδοσης (ROAS & ROI)"
          subtitle="Όλες οι μετρήσεις απόδοσης διαφήμισης σε ένα σημείο — αποφεύγεται η σύγχυση με πολλαπλά KPI στον πίνακα ελέγχου."
          icon={<BarChart3 size={20} className="text-[var(--nts-accent)]" />}
        />
        {(() => {
          const campaignsRoas = metrics.roas;
          const blendedRoas = metrics.totalSpend > 0 ? totalRevenue / metrics.totalSpend : 0;
          const trueRoas = ecomm.hasData && metrics.totalSpend > 0 ? ecomm.totalRevenue / metrics.totalSpend : null;
          const roiPct =
            metrics.totalSpend > 0 ? ((metrics.totalRevenue - metrics.totalSpend) / metrics.totalSpend) * 100 : null;
          const profit = metrics.totalRevenue - metrics.totalSpend;
          const rows: { k: string; v: string; note: string }[] = [
            {
              k: 'Campaigns ROAS',
              v: campaignsRoas > 0 ? `${formatNumber(campaignsRoas, 2)}x` : '—',
              note: 'Έσοδα καμπανιών (conversion value από platforms) ÷ Ad Spend. Χρήσιμο για βελτιστοποίηση ανά καμπάνια.',
            },
            {
              k: 'Blended ROAS',
              v: blendedRoas > 0 ? `${formatNumber(blendedRoas, 2)}x` : '—',
              note: 'Συνολικά έσοδα (organic + campaigns revenue) ÷ Ad Spend. Ευρύτερη εικόνα από τον Campaigns ROAS.',
            },
            ...(trueRoas != null && trueRoas > 0
              ? [
                  {
                    k: 'True ROAS',
                    v: `${formatNumber(trueRoas, 2)}x`,
                    note: 'Πραγματικά έσοδα e-shop ÷ Ad Spend. Σύγκριση με τα δεδομένα παραγγελιών, όχι μόνο attribution.',
                  } as const,
                ]
              : []),
            {
              k: 'ROI % (κέρδος vs spend)',
              v: roiPct != null && roiPct !== 0 ? `${roiPct > 0 ? '+' : ''}${formatNumber(roiPct, 0)}%` : '—',
              note: '(Έσοδα καμπανιών − Ad Spend) ÷ Ad Spend. Δεν είναι ROAS — μετρά το περιθώριο κέρδους από τις διαφημίσεις.',
            },
          ];
          return (
            <div className="mt-4 space-y-3">
              <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#F9FAFB] text-left text-[11px] uppercase tracking-wide text-[#6B7280]">
                      <th className="px-3 py-2 font-semibold">Μέτρηση</th>
                      <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">Τιμή</th>
                      <th className="px-3 py-2 font-semibold min-w-[200px]">Ερμηνεία</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F3F4F6]">
                    {rows.map((row) => (
                      <tr key={row.k} className="hover:bg-[#FAFAFA]">
                        <td className="px-3 py-2.5 font-medium text-[var(--nts-charcoal)]">{row.k}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-semibold text-[var(--nts-charcoal)]">{row.v}</td>
                        <td className="px-3 py-2.5 text-[#6B7280] text-[12px] leading-snug">{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
            </div>
          );
        })()}
      </Card>
      </div>

      {/* E-commerce vs Campaigns Revenue */}
      {ecomm.hasData && ecomm.totalRevenue > 0 && (
        <Card padding="lg">
          <div className="flex items-center gap-2 mb-4">
            <ShoppingBag size={18} className="text-[var(--nts-accent)]" />
            <h3 className="text-sm font-semibold text-[#1A1A1A]">e-shop vs Campaigns Revenue</h3>
            <span className="text-[10px] text-[#9CA3AF] bg-[#F3F4F6] px-1.5 py-0.5 rounded ml-auto">90 ημέρες</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard
              icon={<ShoppingBag size={20} />}
              label="e-shop Revenue"
              value={formatCurrencyCompact(ecomm.totalRevenue)}
              subtitle="Πραγματικά έσοδα e-shop"
              color="#10B981"
              tooltip="Καθαρά έσοδα παραγγελιών από τις e-commerce πλατφόρμες."
            />
            <MetricCard
              icon={<Euro size={20} />}
              label="Campaigns Revenue"
              value={formatCurrencyCompact(totalRevenue)}
              subtitle="Organic + Campaign value"
              color="var(--nts-charcoal)"
              tooltip="Έσοδα που προκύπτουν από organic import + conversion values από καμπάνιες (platforms)."
            />
            <MetricCard
              icon={<BarChart3 size={20} />}
              label="Revenue Gap"
              value={(() => {
                const gap = ecomm.totalRevenue - totalRevenue;
                return gap >= 0 ? `+${formatCurrencyCompact(gap)}` : formatCurrencyCompact(gap);
              })()}
              subtitle="e-shop − Campaigns Revenue"
              color={ecomm.totalRevenue >= totalRevenue ? '#22C55E' : '#EF4444'}
              tooltip="Διαφορά πραγματικού e-shop revenue από campaigns revenue."
            />
          </div>
          <p className="text-[11px] text-[#9CA3AF] mt-3 leading-relaxed">
            Οι εκδοχές <strong>ROAS</strong> (συμπεριλαμβανομένου του <strong>True ROAS</strong> από e-shop) εξηγούνται στο παραπάνω block «Ανάλυση απόδοσης (ROAS & ROI)».
          </p>
        </Card>
      )}

      {/* Section 2: Revenue Trend */}
      {trendData.length > 0 && (
        <Card padding="lg">
          <CardHeader
            title="Τάση Εσόδων"
            subtitle={ecomm.hasData ? 'Organic vs Campaign vs e-shop Revenue ανά μήνα' : 'Organic vs Campaign revenue ανά μήνα'}
            icon={<TrendingUp size={20} className="text-[var(--nts-accent)]" />}
          />
          <div ref={chartRef} className="w-full" style={{ minHeight: 320, position: 'relative' }}>
            <AreaChart width={chartWidth} height={300} data={trendData} margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
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
                dataKey="month"
                tick={{ fill: '#57606a', fontSize: 12 }}
                axisLine={{ stroke: '#d0d7de' }}
                tickLine={{ stroke: '#d0d7de' }}
              />
              <YAxis
                tickFormatter={(v) => `€${(v / 1000).toFixed(0)}K`}
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
                  name === 'organic' ? 'Organic Revenue' : name === 'storeRevenue' ? 'e-shop Revenue' : 'Campaign Revenue',
                ]}
                labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
              />
              <Legend
                formatter={(value) => value === 'organic' ? 'Organic' : value === 'storeRevenue' ? 'e-shop Revenue' : 'Campaigns'}
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

