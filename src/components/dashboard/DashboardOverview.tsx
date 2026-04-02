import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TrendingUp,
  Users,
  Target,
  BarChart3,
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
  Cell
} from 'recharts';
import { Card, CardHeader, KPICard, Tooltip, AlertsBanner } from '../common';
import { useSegments, useOrganic, useCampaigns, useActiveStrategy, useSuppliers, useProductSource, useBrand, useProductAggregates } from '../../hooks';
import { useDashPeriod, PERIOD_OPTIONS } from '../../hooks/useDashPeriod';
import { useGA4Data } from '../../hooks/useGA4Data';
import { calculateTotalRevenue, calculateCampaignMetrics, getCampaignDateForMonth, getEffectiveConversionValue, bucketOverlapFraction } from '../../utils/roiUtils';
import { formatCurrencyCompact, formatNumber, formatMultiplier, formatPercent } from '../../utils/format';
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

      for (const [date, m] of Object.entries(dm)) {
        const frac = bucketOverlapFraction(date, fromDate, toDate);
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
  

  // Revenue chart data: οργανικά + campaigns ανά μήνα
  const revenueChartData = useMemo(() => {
    const byMonth = new Map<string, { total: number; attributed: number }>();
    organicByMonth.forEach((val, key) => {
      byMonth.set(key, { total: val / 1000, attributed: 0 });
    });
    periodCampaigns.forEach(c => {
      const date = getCampaignDateForMonth(c);
      const key = date ? date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : 'Other';
      const ex = byMonth.get(key) || { total: 0, attributed: 0 };
      const cv = getEffectiveConversionValue(c);
      byMonth.set(key, {
        total: ex.total + cv / 1000,
        attributed: ex.attributed + cv / 1000,
      });
    });
    if (byMonth.size === 0) return [];
    const order = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return Array.from(byMonth.entries())
      .sort((a, b) => {
        const [ma, ya] = a[0].split(' ');
        const [mb, yb] = b[0].split(' ');
        const ia = order.indexOf(ma); const ib = order.indexOf(mb);
        return ia !== ib ? ia - ib : (ya || '').localeCompare(yb || '');
      })
      .map(([month, d]) => ({ month, total: d.total, attributed: d.attributed }));
  }, [organicByMonth, campaignsTyped]);

  // Debug logging
  useEffect(() => {
    if (import.meta.env.MODE === 'development') {
      console.debug('[Dashboard] Organic revenue:', totalOrganicRevenue, 'hasOrganic:', hasOrganic);
    }
  }, [totalOrganicRevenue, hasOrganic]);
  const aiInsights = useMemo(() => {
    return generateInsightsFromData(products, rfmSegments, supplierTodMap);
  }, [products, rfmSegments, supplierTodMap]);

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
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-bold text-[var(--nts-charcoal)] tracking-tight">
          Dashboard
        </h2>
        <p className="text-[14px] text-[var(--nts-medium-gray)] mt-1">
          {activeStrategy
            ? <>Στρατηγική: <span className="font-medium text-[var(--nts-charcoal)]">{getStrategyName(activeStrategy.scenarioId)}</span></>
            : 'Καλώς ήρθατε στο Performance+'}
          {activeStrategy?.approvalStatus === 'implementing' && (
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold rounded-full bg-green-100 text-green-700 align-middle">ενεργή</span>
          )}
        </p>
      </div>

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
          onSectionChange={onSectionChange}
          hasAnyData={hasAnyData}
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
        const monthOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const sortMonthKeys = (entries: [string, any][]) =>
          entries
            .filter(([k]) => k !== 'Other')
            .sort((a, b) => {
              const [ma, ya] = a[0].split(' ');
              const [mb, yb] = b[0].split(' ');
              return (ya || '').localeCompare(yb || '') || monthOrder.indexOf(ma) - monthOrder.indexOf(mb);
            });

        const revenueByMonth: Record<string, number> = {};
        const spendByMonth: Record<string, number> = {};
        const convsValueByMonth: Record<string, number> = {};
        const convsByMonth: Record<string, number> = {};

        organicByMonth.forEach((v, k) => { revenueByMonth[k] = (revenueByMonth[k] || 0) + v; });
        periodCampaigns.forEach(c => {
          const d = getCampaignDateForMonth(c);
          const k = d ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : 'Other';
          const cv = getEffectiveConversionValue(c);
          revenueByMonth[k] = (revenueByMonth[k] || 0) + cv;
          spendByMonth[k] = (spendByMonth[k] || 0) + (c.amount_spent || 0);
          convsValueByMonth[k] = (convsValueByMonth[k] || 0) + cv;
          convsByMonth[k] = (convsByMonth[k] || 0) + (c.conversions || 0);
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

        const sortedSpend = sortMonthKeys(Object.entries(spendByMonth));
        const sortedConvVal = sortMonthKeys(Object.entries(convsValueByMonth));
        const sortedConvs = sortMonthKeys(Object.entries(convsByMonth));

        const prevRoas = sortedSpend.length >= 2 && sortedSpend[sortedSpend.length - 2][1] > 0
          ? (sortedConvVal.length >= 2 ? sortedConvVal[sortedConvVal.length - 2][1] : 0) / sortedSpend[sortedSpend.length - 2][1]
          : 0;
        const currRoas = sortedSpend.length >= 1 && sortedSpend[sortedSpend.length - 1][1] > 0
          ? (sortedConvVal.length >= 1 ? sortedConvVal[sortedConvVal.length - 1][1] : 0) / sortedSpend[sortedSpend.length - 1][1]
          : 0;
        const roasMoM = prevRoas > 0 ? ((currRoas - prevRoas) / prevRoas) * 100 : null;

        const roiPercent = campaignMetrics.totalSpend > 0
          ? ((campaignMetrics.totalRevenue - campaignMetrics.totalSpend) / campaignMetrics.totalSpend) * 100
          : 0;

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

        const blendedRoas = campaignMetrics.totalSpend > 0
          ? dashboardTotalRevenue / campaignMetrics.totalSpend
          : 0;

        const revenueSpark = sortMonthKeys(Object.entries(revenueByMonth)).map(([, v]) => v / 1000);
        const spendSpark = sortMonthKeys(Object.entries(spendByMonth)).map(([, v]) => v / 1000);

        return (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
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
                label: 'Ad Spend',
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
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="h-full cursor-pointer"
              onClick={() => onSectionChange?.('roi')}
            >
              <div className="relative h-full rounded-xl bg-gradient-to-br from-[#1A1A2E] to-[#16213E] p-5 overflow-hidden group hover:shadow-lg transition-shadow">
                <div className="absolute inset-0 bg-gradient-to-br from-[var(--nts-accent)]/10 to-transparent" />
                <div className="absolute -right-6 -bottom-6 w-28 h-28 rounded-full bg-[var(--nts-accent)]/10 blur-2xl" />
                <div className="relative z-10">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--nts-accent)]">ROI</span>
                      <Tooltip content="Return on Investment — Ποσοστό κέρδους σε σχέση με το κόστος διαφήμισης: (Έσοδα campaigns − Ad Spend) ÷ Ad Spend × 100." size={13} />
                    </div>
                    {roiPercent > 0 && (
                      <div className="w-7 h-7 rounded-lg bg-[#22C55E]/20 flex items-center justify-center">
                        <TrendingUp size={14} className="text-[#22C55E]" />
                      </div>
                    )}
                  </div>
                  <p className="text-3xl font-bold tracking-tight font-mono text-white mb-1">
                    {roiPercent > 0 ? `+${formatNumber(roiPercent, 0)}%` : '—'}
                  </p>
                  {roiPercent > 0 && (
                    <p className="text-[11px] text-white/50">return on investment</p>
                  )}
                </div>
              </div>
            </motion.div>
            <KPICard
              kpi={{
                label: 'ROAS',
                value: campaignMetrics.roas > 0 ? formatMultiplier(campaignMetrics.roas, 2) : '—',
                change: roasMoM !== null ? Math.round(roasMoM) : undefined,
                changeLabel: roasMoM !== null ? 'vs προηγ. μήνα' : campaignMetrics.roas > 0 ? `€1 → €${formatNumber(campaignMetrics.roas, 1)}` : undefined,
                trend: campaignMetrics.roas > 0 ? (roasMoM !== null && roasMoM < 0 ? 'down' : 'up') : undefined,
                tooltip: 'Return on Ad Spend — Πόσα ευρώ επιστρέφει κάθε 1€ διαφήμισης. ROAS 4x = €4 έσοδα ανά €1 spend.',
              }}
              index={3}
              onClick={() => onSectionChange?.('roi')}
            />
            <KPICard
              kpi={{
                label: 'Blended ROAS',
                value: blendedRoas > 0 ? formatMultiplier(blendedRoas, 2) : '—',
                changeLabel: blendedRoas > 0 ? `€1 → €${formatNumber(blendedRoas, 1)}` : undefined,
                trend: blendedRoas > 0 ? 'up' : undefined,
                tooltip: 'Συνολικά έσοδα (οργανικά + paid) ÷ Ad Spend. Πιο ρεαλιστική μέτρηση απόδοσης γιατί συμπεριλαμβάνει τα οργανικά.',
              }}
              index={4}
              onClick={() => onSectionChange?.('roi')}
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
              index={5}
              onClick={() => onSectionChange?.('campaigns')}
            />
          </div>
        );
      })()}

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
            subtitle="Σύνολο vs Performance+ Attributed"
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
                    name === 'total' ? 'Total Revenue' : 'Performance+ Attributed'
                  ]}
                  labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#9CA3AF"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#totalGradient)"
                  name="total"
                />
                <Area
                  type="monotone"
                  dataKey="attributed"
                  stroke="#78716C"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#attributedGradient)"
                  name="attributed"
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
                <span className="text-sm text-[var(--nts-medium-gray)]">Performance+ Attributed</span>
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


