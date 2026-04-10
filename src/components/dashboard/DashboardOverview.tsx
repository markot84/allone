import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TrendingUp,
  Users,
  Target,
  BarChart3,
  ShoppingBag,
  ArrowRight,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, KPICard, Tooltip, AlertsBanner, PageHeader } from '../common';
import { useSegments, useOrganic, useCampaigns, useActiveStrategy, useSuppliers, useProductSource, useBrand, useProductAggregates } from '../../hooks';
import { useDashPeriod, PERIOD_OPTIONS } from '../../hooks/useDashPeriod';
import { useGA4Data } from '../../hooks/useGA4Data';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import {
  calculateTotalRevenue,
  calculateCampaignMetrics,
  getCampaignDateForMonth,
  getCampaignMonthlyAttributedValueInPeriod,
  monthKeyFromDate,
  buildRoiTrendSeries,
  bucketOverlapFraction,
  metaUsesLegacyMonthBuckets,
} from '../../utils/roiUtils';
import { formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import type { Campaign } from '../../types';
import { generateInsightsFromData } from '../../services/insights';
import { useAutomationRunner } from '../../hooks/useAutomationRunner';
import { useAutomationAlerts } from '../../hooks/useAutomation';
import { MorningBriefing } from './MorningBriefing';
import { StrategyBriefingQuickStrip } from '../coordination/StrategyBriefingQuickStrip';

interface DashboardOverviewProps {
  /** Προαιρετικό `hashQuery` για deep link (π.χ. ειδοποιήσεις → `#products?stock=low`) */
  onSectionChange?: (section: string, opts?: { hashQuery?: string }) => void;
  onOpenInsights?: () => void;
}

export function DashboardOverview({ onSectionChange, onOpenInsights }: DashboardOverviewProps = {}) {
  const { currentBrand } = useBrand();
  const { segments: rfmSegments, hasImported: hasSegments } = useSegments();
  const { count: productsCount, products } = useProductSource();
  const { productStats } = useProductAggregates();
  const { suppliers } = useSuppliers();
  const { totalOrganicRevenue, byMonth: organicByMonth, hasImported: hasOrganic } = useOrganic();
  const { count: campaignsCount, campaigns, hasImported: hasCampaigns } = useCampaigns();
  const { activeStrategy, getStrategyName } = useActiveStrategy();
  useAutomationRunner();
  const ga4 = useGA4Data();
  const ecomm = useEcommerceSummary();
  const { alerts: automationAlerts } = useAutomationAlerts();

  const supplierTodMap = useMemo(() => {
    const m = new Map<string, number>();
    suppliers.forEach(s => m.set(s.name, s.tod));
    return m;
  }, [suppliers]);
  const hasAnyData = hasOrganic || hasSegments || productsCount > 0 || hasCampaigns;
  
  const campaignsTyped = (campaigns ?? []) as Campaign[];

  const { period: dashPeriod, setPeriod: setDashPeriod, periodDates } = useDashPeriod();

  // Filter campaigns to the selected period using dailyMetrics for accurate period metrics.
  const periodCampaigns = useMemo(() => {
    const { fromDate, toDate } = periodDates;
    return campaignsTyped.map(c => {
      const dm = (c as any).dailyMetrics as Record<string, any> | undefined;
      if (!dm || Object.keys(dm).length === 0) return c;

      let impressions = 0, clicks = 0, conversions = 0, amount_spent = 0, conversion_value = 0;
      const convActions: Record<string, { conversions: number; value: number }> = {};

      const metaMonthBuckets = metaUsesLegacyMonthBuckets(c);
      for (const [date, m] of Object.entries(dm)) {
        const frac = bucketOverlapFraction(date, fromDate, toDate, { metaMonthBuckets });
        if (frac <= 0) continue;
        impressions += Math.round((m.impressions || 0) * frac);
        clicks += Math.round((m.clicks || 0) * frac);
        conversions += (m.conversions || 0) * frac;
        amount_spent += (m.amount_spent || 0) * frac;
        conversion_value += (m.conversion_value || 0) * frac;
        if (m.conversionActions) {
          for (const [label, vals] of Object.entries(m.conversionActions as Record<string, { conversions: number; value: number }>)) {
            if (!convActions[label]) convActions[label] = { conversions: 0, value: 0 };
            convActions[label].conversions += (vals.conversions || 0) * frac;
            convActions[label].value += (vals.value || 0) * frac;
          }
        }
      }
      const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
      amount_spent = Math.round(amount_spent * 100) / 100;
      return { ...c, impressions, clicks, conversions, amount_spent, conversion_value, ctr, conversionActions: convActions };
    });
  }, [campaignsTyped, periodDates]);

  const campaignMetrics = useMemo(() => calculateCampaignMetrics(periodCampaigns), [periodCampaigns]);
  const dashboardTotalRevenue = useMemo(
    () => calculateTotalRevenue(totalOrganicRevenue || 0, periodCampaigns),
    [totalOrganicRevenue, periodCampaigns]
  );
  

  // Revenue chart: organic + campaign attributed value ανά μήνα (YYYY-MM merge, χρονολογική σειρά)
  const revenueChartData = useMemo(() => {
    const fromYm = periodDates.fromDate.slice(0, 7);
    const toYm = periodDates.toDate.slice(0, 7);
    const rows = buildRoiTrendSeries(organicByMonth, periodCampaigns as Campaign[], [], fromYm, toYm, false, {
      periodClip: { fromDate: periodDates.fromDate, toDate: periodDates.toDate },
    });
    return rows.map((r) => ({
      month: r.month,
      total: (r.organic + r.campaigns) / 1000,
      attributed: r.campaigns / 1000,
    }));
  }, [organicByMonth, periodCampaigns, periodDates.fromDate, periodDates.toDate]);

  // Debug logging
  useEffect(() => {
    if (import.meta.env.MODE === 'development') {
      console.debug('[Dashboard] Organic revenue:', totalOrganicRevenue, 'hasOrganic:', hasOrganic);
    }
  }, [totalOrganicRevenue, hasOrganic]);
  const aiInsights = useMemo(() => {
    return generateInsightsFromData(products, rfmSegments, supplierTodMap, {
      hasData: ecomm.hasData,
      totalRevenue: ecomm.totalRevenue,
      orderCount: ecomm.orderCount,
      aov: ecomm.aov,
      platformBreakdown: ecomm.platformBreakdown,
    });
  }, [products, rfmSegments, supplierTodMap, ecomm.hasData, ecomm.totalRevenue, ecomm.orderCount, ecomm.aov, ecomm.platformBreakdown]);

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
        title={<h2 className="text-xl font-bold tracking-tight text-[var(--nts-charcoal)] sm:text-2xl">Dashboard</h2>}
        description={
          <p className="text-[14px] text-[var(--nts-medium-gray)]">
            {activeStrategy ? (
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
          totalOrganicRevenue={totalOrganicRevenue || 0}
          ga4={{
            totals: ga4.totals,
            weeklyChange: ga4.weeklyChange,
            hasData: ga4.hasData,
          }}
          alerts={automationAlerts}
          supplierTodMap={supplierTodMap}
          ecommerce={{
            hasData: ecomm.hasData,
            totalRevenue: ecomm.totalRevenue,
            orderCount: ecomm.orderCount,
            aov: ecomm.aov,
            connectedPlatforms: ecomm.connectedPlatforms,
            platformBreakdown: ecomm.platformBreakdown,
          }}
          onSectionChange={onSectionChange}
          hasAnyData={hasAnyData}
          period={dashPeriod}
          periodLabel={PERIOD_OPTIONS.find(o => o.key === dashPeriod)?.label ?? 'Τρέχων Μήνας'}
        />
      )}

      {/* Period selector for KPI cards */}
      {(hasOrganic || hasCampaigns) && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 w-fit">
          {PERIOD_OPTIONS.map(opt => (
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

        const aov = campaignMetrics.totalConversions > 0
          ? campaignMetrics.totalRevenue / campaignMetrics.totalConversions
          : 0;
        const prevAov = sortedConvs.length >= 2 && sortedConvs[sortedConvs.length - 2][1] > 0
          ? (sortedConvVal.length >= 2 ? sortedConvVal[sortedConvVal.length - 2][1] : 0) / sortedConvs[sortedConvs.length - 2][1]
          : 0;
        const currAov = sortedConvs.length >= 1 && sortedConvs[sortedConvs.length - 1][1] > 0
          ? (sortedConvVal.length >= 1 ? sortedConvVal[sortedConvVal.length - 1][1] : 0) / sortedConvs[sortedConvs.length - 1][1]
          : 0;
        const aovMoM = prevAov > 0 ? ((currAov - prevAov) / prevAov) * 100 : null;

        const revenueSpark = sortMonthKeys(Object.entries(revenueByMonth)).map(([, v]) => v / 1000);
        const spendSpark = sortMonthKeys(Object.entries(spendByMonth)).map(([, v]) => v / 1000);

        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5">
              <KPICard
                kpi={{
                  label: 'Σύνολο Εσόδων',
                  value: formatCurrencyCompact(dashboardTotalRevenue),
                  change: revenueMoM !== null ? Math.round(revenueMoM) : undefined,
                  changeLabel: revenueMoM !== null ? 'vs προηγ. μήνα' : undefined,
                  trend: revenueMoM !== null ? (revenueMoM >= 0 ? 'up' : 'down') : 'up',
                  sparklineData: revenueSpark,
                  tooltip: 'Συνολικά έσοδα από οργανικές πωλήσεις και campaigns. Περιλαμβάνει conversion value από Google Ads και Meta.',
                }}
                index={0}
                onClick={() => onSectionChange?.('roi')}
              />
              <KPICard
                kpi={{
                  label: 'Δαπάνη διαφημίσεων',
                  value: hasCampaigns ? formatCurrencyCompact(campaignMetrics.totalSpend) : '€0',
                  change: spendMoM !== null ? Math.round(spendMoM) : undefined,
                  changeLabel: spendMoM !== null ? 'vs προηγ. μήνα' : hasCampaigns && campaignMetrics.cpa > 0 ? `CPA €${formatNumber(campaignMetrics.cpa, 1)}` : undefined,
                  trend: spendMoM !== null ? (spendMoM >= 0 ? 'up' : 'down') : hasCampaigns ? 'up' : undefined,
                  sparklineData: spendSpark,
                  tooltip: 'Συνολικό κόστος διαφήμισης σε Google Ads και Meta. CPA = Κόστος ανά μετατροπή.',
                }}
                index={1}
                onClick={() => onSectionChange?.('campaigns')}
              />
              <KPICard
                kpi={{
                  label: 'Μέσο Καλάθι (AOV)',
                  value: aov > 0 ? `€${formatNumber(aov, 1)}` : '—',
                  change: aovMoM !== null ? Math.round(aovMoM) : undefined,
                  changeLabel: aovMoM !== null ? 'vs προηγ. μήνα' : undefined,
                  trend: aov > 0 ? (aovMoM !== null && aovMoM < 0 ? 'down' : 'up') : undefined,
                  tooltip: 'Average Order Value — Μέση αξία παραγγελίας: Αξία Μετατροπών ÷ Αριθμός Μετατροπών.',
                }}
                index={2}
                onClick={() => onSectionChange?.('campaigns')}
              />
            </div>
            <p className="text-[12px] text-[#6B7280] leading-relaxed">
              Για <strong className="text-[#4B5563] font-medium">ROAS</strong>,{' '}
              <strong className="text-[#4B5563] font-medium">True ROAS</strong>, blended απόδοση και σύγκριση με e-shop, ανοίξτε{' '}
              <button
                type="button"
                onClick={() => onSectionChange?.('roi')}
                className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
              >
                ROI &amp; Απόδοση
              </button>
              .
            </p>
          </div>
        );
      })()}

      {/* E-commerce Summary */}
      {ecomm.hasData && (
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
                    {ecomm.connectedPlatforms.length} platform{ecomm.connectedPlatforms.length > 1 ? 's' : ''} · 90 ημέρες
                  </span>
                </div>
              </div>
              <ArrowRight size={16} className="text-[#D1D5DB] group-hover:text-[var(--nts-accent)] transition-colors" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-end">
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <p className="text-[11px] text-[#6B7280]">e-shop Revenue</p>
                  <Tooltip content="Πραγματικά έσοδα e-shop από τις συνδεδεμένες πλατφόρμες για το επιλεγμένο διάστημα." size={12} />
                </div>
                <p className="text-lg font-bold text-[#1A1A1A]">{formatCurrencyCompact(ecomm.totalRevenue)}</p>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <p className="text-[11px] text-[#6B7280]">Παραγγελίες</p>
                  <Tooltip content="Συνολικός αριθμός παραγγελιών από Shopify/WooCommerce/OpenCart/Magento." size={12} />
                </div>
                <p className="text-lg font-bold text-[#1A1A1A]">{formatNumber(ecomm.orderCount)}</p>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <p className="text-[11px] text-[#6B7280]">AOV</p>
                  <Tooltip content="Average Order Value: e-shop Revenue / Παραγγελίες." size={12} />
                </div>
                <p className="text-lg font-bold text-[#1A1A1A]">{formatCurrencyCompact(ecomm.aov)}</p>
              </div>
              <div>
                <p className="text-[11px] text-[#6B7280] mb-0.5">Top Platform</p>
                <p className="text-lg font-bold text-[#1A1A1A]">
                  {ecomm.platformBreakdown[0]
                    ? ({ shopify: 'Shopify', woocommerce: 'WooCommerce', opencart: 'OpenCart', magento: 'Magento' }[ecomm.platformBreakdown[0].platform] || ecomm.platformBreakdown[0].platform)
                    : '—'}
                </p>
              </div>
              {/* Mini sparkline */}
              {ecomm.dailyRevenue.length > 7 && (
                <div className="hidden md:block">
                  <ResponsiveContainer width="100%" height={40}>
                    <AreaChart data={ecomm.dailyRevenue.slice(-30)}>
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
              )}
            </div>
          </div>
        </Card>
      )}

      {/* GA4 Web Analytics Summary */}
      {ga4.hasData && (
        <Card hover onClick={() => onSectionChange?.('analytics')}>
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <BarChart3 size={18} className="text-orange-500" />
                <h4 className="text-sm font-semibold text-[#1A1A1A]">Web Analytics</h4>
                <span className="text-[10px] text-[#9CA3AF] bg-[#F3F4F6] px-1.5 py-0.5 rounded">{ga4.propertyName}</span>
              </div>
              <span className="text-[10px] text-[#9CA3AF]">90 ημέρες</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-[11px] text-[#6B7280] mb-0.5">Sessions</p>
                <p className="text-lg font-bold text-[#1A1A1A]">{ga4.totals.sessions >= 1000 ? `${(ga4.totals.sessions / 1000).toFixed(1)}K` : ga4.totals.sessions.toLocaleString()}</p>
                {ga4.weeklyChange?.sessions != null && (
                  <p className={`text-[10px] font-medium ${ga4.weeklyChange.sessions >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {ga4.weeklyChange.sessions >= 0 ? '+' : ''}{ga4.weeklyChange.sessions.toFixed(1)}% vs prev 7d
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] text-[#6B7280] mb-0.5">Users</p>
                <p className="text-lg font-bold text-[#1A1A1A]">{ga4.totals.users >= 1000 ? `${(ga4.totals.users / 1000).toFixed(1)}K` : ga4.totals.users.toLocaleString()}</p>
                {ga4.weeklyChange?.users != null && (
                  <p className={`text-[10px] font-medium ${ga4.weeklyChange.users >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {ga4.weeklyChange.users >= 0 ? '+' : ''}{ga4.weeklyChange.users.toFixed(1)}% vs prev 7d
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] text-[#6B7280] mb-0.5">Bounce Rate</p>
                <p className="text-lg font-bold text-[#1A1A1A]">{(ga4.totals.bounceRate * 100).toFixed(1)}%</p>
                <p className="text-[10px] text-[#9CA3AF]">μέσος (90d)</p>
              </div>
              <div>
                <p className="text-[11px] text-[#6B7280] mb-0.5">Conversions</p>
                <p className="text-lg font-bold text-[#1A1A1A]">{ga4.totals.conversions.toLocaleString()}</p>
                {ga4.weeklyChange?.conversions != null && (
                  <p className={`text-[10px] font-medium ${ga4.weeklyChange.conversions >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {ga4.weeklyChange.conversions >= 0 ? '+' : ''}{ga4.weeklyChange.conversions.toFixed(1)}% vs prev 7d
                  </p>
                )}
              </div>
            </div>
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
          onClick={() => onSectionChange?.('roi')}
        >
          <CardHeader
            title="Revenue Performance"
            subtitle="Σύνολο vs Campaigns Revenue"
            icon={<TrendingUp size={18} className="text-[var(--nts-medium-gray)]" />}
          />
          {revenueChartData.length > 0 ? (
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
                    <stop offset="5%" stopColor="#9CA3AF" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#9CA3AF" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="attributedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#78716C" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#78716C" stopOpacity={0}/>
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
                  tick={{ fill: '#57606a', fontSize: 12 }}
                  axisLine={{ stroke: '#d0d7de' }}
                  tickLine={{ stroke: '#d0d7de' }}
                  tickFormatter={(value) => `€${formatNumber(value)}K`}
                />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #d0d7de',
                    borderRadius: '6px',
                    fontSize: '12px',
                    padding: '8px 12px'
                  }}
                  formatter={(value: any, name?: string) => [
                    formatCurrencyCompact((value as number) || 0),
                    name === 'total' ? 'Total Revenue' : 'Campaigns Revenue'
                  ]}
                  labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
                />
                <Area
                  type="linear"
                  dataKey="total"
                  stroke="#9CA3AF"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#totalGradient)"
                  name="total"
                  isAnimationActive={false}
                />
                <Area
                  type="linear"
                  dataKey="attributed"
                  stroke="#78716C"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#attributedGradient)"
                  name="attributed"
                  isAnimationActive={false}
                />
              </AreaChart>
            </div>
          ) : (
            <div className="w-full h-[288px] flex items-center justify-center bg-[#F5F5F5] rounded-lg">
              <div className="text-center">
                <TrendingUp size={32} className="text-[#9CA3AF] mx-auto mb-2" />
                <p className="text-sm text-[#4A4A4A] font-medium">Δεν υπάρχουν δεδομένα</p>
                <p className="text-xs text-[#9CA3AF] mt-1">Φόρτωσε Analytics ή Campaigns για να δεις το Revenue Performance</p>
              </div>
            </div>
          )}
          {revenueChartData.length > 0 && (
            <div className="flex items-center gap-6 mt-4 pt-4 border-t border-[var(--nts-border-gray)]">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[#9CA3AF]" />
                <span className="text-sm text-[var(--nts-medium-gray)]">Total Revenue</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-[var(--nts-orange)]" />
                <span className="text-sm text-[var(--nts-medium-gray)]">Campaigns Revenue</span>
              </div>
            </div>
          )}
        </Card>

        {/* Segment Distribution */}
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
            subtitle="Πρακτικές συστάσεις"
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
            title="Strategy & Status"
            subtitle="Ενεργή στρατηγική & δεδομένα"
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
                <p className="text-[11px] text-[var(--nts-medium-gray)]">Campaigns</p>
              </div>
              <div
                className="text-center p-3 rounded-lg bg-white border border-[var(--nts-border-gray)] cursor-pointer hover:border-[var(--nts-accent)] transition-colors"
                onClick={(e) => { e.stopPropagation(); onSectionChange?.('rfm'); }}
              >
                <p className="text-lg font-bold text-[var(--nts-charcoal)] font-mono">{rfmSegments.length}</p>
                <p className="text-[11px] text-[var(--nts-medium-gray)]">Segments</p>
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


