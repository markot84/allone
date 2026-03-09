import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TrendingUp,
  Users,
  Package,
  Euro,
  Target,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { Tooltip } from '../common';
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
import { Card, CardHeader } from '../common';
import { useSegments, useProducts, useOrganic, useCampaigns, useActiveStrategy } from '../../hooks';
import { ROIAttribution } from '../roi';
import { calculateTotalRevenue, calculateCampaignMetrics, getCampaignDateForMonth } from '../../utils/roiUtils';
import { formatCurrencyCompact, formatNumber, formatMultiplier, formatPercent } from '../../utils/format';
import type { Campaign } from '../../types';
import { generateInsightsFromData } from '../../services/insights';

interface DashboardOverviewProps {
  onSectionChange?: (section: string) => void;
  onOpenInsights?: () => void;
}

// Get default RFM score from segment name (fallback when rfm_score is missing)
function getDefaultRFMScoreFromName(segmentName: string): string | null {
  const name = segmentName.toLowerCase().trim();
  const defaults: Record<string, string> = {
    'champions': '5-5-5',
    'loyal_customers': '4-4-3',
    'loyal': '4-4-3',
    'promising': '4-2-3',
    'potential_loyalists': '4-2-3',
    'potential': '4-2-3',
    'at_risk': '2-3-3',
    'hibernating': '2-2-2',
    'lost': '1-1-1',
    'new_customers': '5-1-1',
    'recent_customers': '5-2-2',
    'cant_lose_them': '3-5-5',
    "can't_lose_them": '3-5-5',
    'customers_needing_attention': '3-3-2',
  };
  
  // Try exact match first
  if (defaults[name]) return defaults[name];
  
  // Try partial match
  for (const [key, value] of Object.entries(defaults)) {
    if (name.includes(key) || key.includes(name)) {
      return value;
    }
  }
  
  return null;
}

// Calculate average RFM score from a segment's rfm_score string
function calculateAvgRFMScore(rfmScore: string | undefined | null, segmentName?: string): number | null {
  let scoreStr = rfmScore;
  
  // If rfm_score is empty, try to get default from segment name
  if ((!scoreStr || !scoreStr.trim()) && segmentName) {
    scoreStr = getDefaultRFMScoreFromName(segmentName);
  }
  
  if (!scoreStr || typeof scoreStr !== 'string') return null;
  
  const trimmed = scoreStr.trim();
  if (!trimmed) return null;
  
  // Extract all digits from the string
  const digits = trimmed.match(/\d/g);
  if (!digits || digits.length === 0) return null;
  
  // Convert to numbers and filter valid RFM scores (1-5)
  const numbers = digits.map(d => parseInt(d, 10)).filter(n => !isNaN(n) && n >= 1 && n <= 5);
  if (numbers.length === 0) return null;
  
  const sum = numbers.reduce((a, b) => a + b, 0);
  return sum / numbers.length;
}

export function DashboardOverview({ onSectionChange, onOpenInsights }: DashboardOverviewProps = {}) {
  const { segments: rfmSegments, hasImported: hasSegments } = useSegments();
  const { count: productsCount, products } = useProducts();
  const { totalOrganicRevenue, byMonth: organicByMonth, hasImported: hasOrganic } = useOrganic();
  const { count: campaignsCount, campaigns, hasImported: hasCampaigns } = useCampaigns();
  const { activeStrategy, getStrategyName } = useActiveStrategy();
  const hasAnyData = hasOrganic || hasSegments || productsCount > 0 || hasCampaigns;
  
  const campaignsTyped = (campaigns ?? []) as Campaign[];
  const campaignMetrics = useMemo(() => calculateCampaignMetrics(campaignsTyped), [campaignsTyped]);
  const dashboardTotalRevenue = useMemo(
    () => calculateTotalRevenue(totalOrganicRevenue || 0, campaignsTyped),
    [totalOrganicRevenue, campaignsTyped]
  );
  const [activeTab, setActiveTab] = useState<'overview' | 'roi'>('overview');

  // Revenue chart data: οργανικά + campaigns ανά μήνα
  const revenueChartData = useMemo(() => {
    const byMonth = new Map<string, { total: number; attributed: number }>();
    organicByMonth.forEach((val, key) => {
      byMonth.set(key, { total: val / 1000, attributed: 0 });
    });
    campaignsTyped.forEach(c => {
      const date = getCampaignDateForMonth(c);
      const key = date ? date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : 'Other';
      const ex = byMonth.get(key) || { total: 0, attributed: 0 };
      byMonth.set(key, {
        total: ex.total + (c.conversion_value || 0) / 1000,
        attributed: ex.attributed + (c.conversion_value || 0) / 1000,
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
    return generateInsightsFromData(products, rfmSegments);
  }, [products, rfmSegments]);

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
          Καλώς ήρθατε στο Performance+
        </p>
      </div>

      {/* KPI Cards - order: Strategy, Προϊόντα, Segments, Campaigns, Σύνολο Εσόδων, ROI */}
      {(hasOrganic || productsCount > 0 || rfmSegments.length > 0 || (hasCampaigns && campaigns.length > 0)) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4 sm:gap-6">
          {/* 1. Strategy */}
          <KPICard
            kpi={{
              label: 'Strategy',
              value: activeStrategy ? getStrategyName(activeStrategy.scenarioId) : '—',
              changeLabel: activeStrategy?.approvalStatus === 'implementing' ? 'ενεργή' : activeStrategy ? 'Ρυθμίσεις' : undefined,
              trend: 'up' as const,
              sparklineData: []
            }}
            index={0}
            onClick={() => onSectionChange?.('strategy')}
          />
          {/* 2. Προϊόντα */}
          {productsCount > 0 && (
            <KPICard
              kpi={{
                label: 'Προϊόντα',
                value: formatNumber(productsCount),
                change: products.length > 0
                  ? (() => {
                      const withStock = products.filter((p) => (p.stock_level ?? 0) >= 10 && (p.stock_age_days ?? 0) <= 180);
                      return Math.round((withStock.length / products.length) * 1000) / 10;
                    })()
                  : undefined,
                  changeLabel: 'υγιή',
                trend: 'up' as const,
                sparklineData: []
              }}
              index={1}
              onClick={() => onSectionChange?.('products')}
            />
          )}
          {rfmSegments.length > 0 && (() => {
            // Calculate average RFM score across all segments
            const scores = rfmSegments
              .map((s) => calculateAvgRFMScore(s.rfm_score, s.name))
              .filter((score): score is number => score !== null && !isNaN(score) && isFinite(score));
            
            const avgScore = scores.length > 0 
              ? (scores.reduce((a, b) => a + b, 0) / scores.length)
              : null;
            
            return (
              <KPICard
                kpi={{
                  label: 'Segments',
                  value: rfmSegments.length.toString(),
                  change: avgScore ? Math.round(avgScore * 10) / 10 : undefined,
                  changeLabel: avgScore ? 'μέσος score' : 'RFM',
                  trend: 'up' as const,
                  sparklineData: []
                }}
                index={2}
                onClick={() => onSectionChange?.('rfm')}
              />
            );
          })()}
          {campaignsCount > 0 && (() => {
            const activeCampaigns = (campaigns as any[]).filter((c) => 
              c.status === 'active' || c.status === 'enabled' || c.status === 'eligible' || !c.status
            ).length;
            return (
              <KPICard
                kpi={{
                  label: 'Campaigns',
                  value: campaignsCount.toString(),
                  change: activeCampaigns,
                  changeLabel: 'ενεργά',
                  trend: 'up' as const,
                  sparklineData: (campaigns as any[]).slice(0, 7).map((c) => c.amount_spent || 0)
                }}
                index={3}
                onClick={() => onSectionChange?.('campaigns')}
              />
            );
          })()}
          {/* 5. Σύνολο Εσόδων */}
          {(hasOrganic || (hasCampaigns && campaigns.length > 0)) && (() => {
            let sparklineData: number[] = [];
            const monthlyData: Record<string, number> = {};
            organicByMonth.forEach((val, key) => {
              monthlyData[key] = (monthlyData[key] || 0) + val / 1000;
            });
            campaignsTyped.forEach(c => {
              const date = getCampaignDateForMonth(c);
              const monthKey = date ? date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : 'Other';
              monthlyData[monthKey] = (monthlyData[monthKey] || 0) + (c.conversion_value || 0) / 1000;
            });
            sparklineData = Object.values(monthlyData).sort((a, b) => a - b);
            return (
              <KPICard
                kpi={{
                  label: 'Σύνολο Εσόδων',
                  value: formatCurrencyCompact(dashboardTotalRevenue),
                  trend: 'up' as const,
                  sparklineData
                }}
                index={4}
                onClick={() => onSectionChange?.('roi')}
              />
            );
          })()}
          {/* 6. ROAS */}
          {hasCampaigns && (
            <KPICard
              kpi={{
                label: 'ROAS',
                value: campaignMetrics.roas > 0 ? formatMultiplier(campaignMetrics.roas, 1) : '—',
                changeLabel: campaignMetrics.roas > 0 ? 'return on ad spend' : undefined,
                trend: 'up' as const,
                sparklineData: []
              }}
              index={5}
              onClick={() => onSectionChange?.('roi')}
            />
          )}
        </div>
      )}

      {/* Tabs for Overview and ROI Attribution */}
      {hasAnyData && (
        <Card padding="none">
          <div className="flex border-b border-[var(--nts-border-gray)]">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex-1 px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === 'overview'
                  ? 'text-[var(--nts-charcoal)] border-b-2 border-[var(--nts-accent)]'
                  : 'text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)]'
              }`}
            >
              Overview
            </button>
            <button
              onClick={() => setActiveTab('roi')}
              className={`flex-1 px-6 py-3 text-sm font-medium transition-colors relative ${
                activeTab === 'roi'
                  ? 'text-[var(--nts-charcoal)] border-b-2 border-[var(--nts-accent)]'
                  : 'text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)]'
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <TrendingUp size={15} className={activeTab === 'roi' ? 'text-[var(--nts-accent)]' : 'text-[var(--nts-medium-gray)]'} />
                ROI & Απόδοση
                {hasCampaigns && campaignMetrics.roas > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-[var(--nts-accent)] text-white leading-none">
                    {formatNumber(campaignMetrics.roas, 1)}x
                  </span>
                )}
              </span>
            </button>
          </div>
        </Card>
      )}

      {/* ROI Attribution Tab Content */}
      {activeTab === 'roi' && (
        <div className="pt-2">
          <ROIAttribution embedded />
        </div>
      )}

      {/* Main Charts Row */}
      {activeTab === 'overview' && (
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

      {/* AI Insights Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* AI Insights */}
        <Card 
          padding="lg"
          hover={!!onOpenInsights}
          onClick={() => onOpenInsights?.()}
          className="h-full flex flex-col"
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

        {/* Quick Stats */}
        <Card 
          padding="lg"
          hover={!!onSectionChange}
          onClick={() => onSectionChange?.('reports')}
          className="h-full"
        >
          <CardHeader
            title="Performance Summary"
            subtitle="Τελευταίες 90 ημέρες"
            icon={<Euro size={18} className="text-[var(--nts-medium-gray)]" />}
          />
          <div className="grid grid-cols-2 gap-5">
            <StatBox
              label="Σύνολο Προϊόντων"
              value={formatNumber(productsCount)}
              icon={<Package size={18} />}
              color="#4A4A4A"
              onClick={(e) => {
                e.stopPropagation();
                onSectionChange?.('products');
              }}
            />
            <StatBox
              label="Ενεργά Campaigns"
              value={formatNumber(campaignsCount)}
              icon={<Target size={18} />}
              color="#22C55E"
              onClick={(e) => {
                e.stopPropagation();
                onSectionChange?.('campaigns');
              }}
            />
            <StatBox
              label="Ad Spend"
              value={hasCampaigns ? formatCurrencyCompact(campaignMetrics.totalSpend) : '€0'}
              icon={<Euro size={18} />}
              color="#8B5CF6"
              tooltip="Συνολικό ποσό διαφημιστικής δαπάνης από campaigns."
            />
            <StatBox
              label="Conversions"
              value={hasCampaigns ? formatNumber(campaignMetrics.totalConversions) : '0'}
              icon={<Target size={18} />}
              color="var(--nts-accent)"
              tooltip="Συνολικές μετατροπές από campaigns."
            />
          </div>

          {/* ROAS Highlight */}
          <div className="mt-6 p-5 bg-white rounded-xl border border-[var(--nts-border-gray)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-[var(--nts-medium-gray)] mb-1">Campaign ROAS</p>
                <p className="text-3xl font-bold tracking-tight text-[var(--nts-charcoal)] mb-1 font-mono">
                  {campaignMetrics.roas > 0 ? formatMultiplier(campaignMetrics.roas, 1) : '—'}
                </p>
                <p className="text-[13px] text-[var(--nts-medium-gray)]">
                  {campaignMetrics.roas > 0
                    ? `Κάθε €1 σε διαφημίσεις → €${formatNumber(campaignMetrics.roas, 1)} revenue`
                    : 'Φόρτωσε campaigns για να δεις το ROAS'}
                </p>
              </div>
              <div className="w-10 h-10 bg-[var(--nts-light-gray)] rounded-md border border-[var(--nts-border-gray)] flex items-center justify-center">
                <TrendingUp size={18} className="text-[var(--nts-medium-gray)]" strokeWidth={2} />
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

interface KPICardProps {
  kpi: { label: string; value: string; change?: number; changeLabel?: string; trend?: 'up' | 'down'; sparklineData?: number[] };
  index: number;
  onClick?: () => void;
}

function KPICard({ kpi, index, onClick }: KPICardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="h-full"
    >
      <Card
        padding="lg"
        hover={!!onClick}
        className="border-l-4 border-l-transparent hover:border-l-[var(--nts-accent)] h-full"
        onClick={onClick}
      >
        <div className="flex items-start justify-between mb-3">
          <p className="text-[13px] font-medium text-[var(--nts-medium-gray)]">{kpi.label}</p>
          {kpi.trend === 'up' ? (
            <div className="p-1.5 bg-[var(--nts-light-gray)] rounded-md border border-[var(--nts-border-gray)]">
              <ArrowUpRight size={16} className="text-[var(--nts-medium-gray)]" />
            </div>
          ) : kpi.trend === 'down' ? (
            <div className="p-1.5 bg-[var(--nts-light-gray)] rounded-md border border-[var(--nts-border-gray)]">
              <ArrowDownRight size={16} className="text-[var(--nts-medium-gray)]" />
            </div>
          ) : null}
        </div>
        <p className="text-3xl font-bold text-[var(--nts-charcoal)] mb-3 font-mono tracking-tight">
          {kpi.value}
        </p>
        {(kpi.change != null || kpi.changeLabel) && (
          <div className="flex items-center gap-2">
            {kpi.change != null && (
              <span
                className={`text-[14px] font-semibold px-2 py-0.5 rounded-lg text-[var(--nts-medium-gray)] bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)]`}
              >
                {(kpi.changeLabel === 'active' || kpi.changeLabel === 'ενεργά' || kpi.changeLabel === 'avg score' || kpi.changeLabel === 'μέσος score' || kpi.changeLabel === 'υγιή')
                  ? `${kpi.change}` 
                  : (kpi.changeLabel === 'attributed')
                  ? `${kpi.change}%`
                  : `${kpi.change > 0 ? '+' : ''}${kpi.change}%`}
              </span>
            )}
            {kpi.changeLabel && (
              <span className="text-[13px] text-[var(--nts-medium-gray)]">{kpi.changeLabel}</span>
            )}
          </div>
        )}
      </Card>
    </motion.div>
  );
}

interface StatBoxProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  onClick?: (e: React.MouseEvent) => void;
  tooltip?: string;
}

function StatBox({ label, value, icon, color, onClick, tooltip }: StatBoxProps) {
  return (
    <div 
      className={`p-4 bg-white rounded-xl border border-[var(--nts-border-gray)] flex flex-col items-center justify-center text-center gap-2 ${onClick ? 'hover:border-[var(--nts-accent)] hover:shadow-sm transition-all cursor-pointer' : ''}`}
      onClick={onClick}
    >
      <div
        className="w-11 h-11 rounded-lg border border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)] flex items-center justify-center"
        aria-hidden="true"
      >
        <span style={{ color }} className="inline-flex items-center justify-center">
          {icon}
        </span>
      </div>
      <p className="text-[12px] font-medium text-[var(--nts-medium-gray)] leading-4">
        {tooltip ? (
          <Tooltip content={tooltip} size={12}>
            {label}
          </Tooltip>
        ) : (
          label
        )}
      </p>
      <p className="text-xl font-semibold text-[var(--nts-dark-gray)] font-mono leading-6">{value}</p>
    </div>
  );
}
