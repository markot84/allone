import { motion } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TrendingUp,
  Users,
  Target,
  ArrowUpRight,
  ArrowDownRight
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
import { Card, CardHeader } from '../common';
import { useSegments, useProducts, useOrganic, useCampaigns, useActiveStrategy, useSuppliers } from '../../hooks';
import { calculateTotalRevenue, calculateCampaignMetrics, getCampaignDateForMonth } from '../../utils/roiUtils';
import { formatCurrencyCompact, formatNumber, formatMultiplier, formatPercent } from '../../utils/format';
import type { Campaign } from '../../types';
import { generateInsightsFromData } from '../../services/insights';

interface DashboardOverviewProps {
  onSectionChange?: (section: string) => void;
  onOpenInsights?: () => void;
}

export function DashboardOverview({ onSectionChange, onOpenInsights }: DashboardOverviewProps = {}) {
  const { segments: rfmSegments, hasImported: hasSegments } = useSegments();
  const { count: productsCount, products } = useProducts();
  const { suppliers } = useSuppliers();
  const { totalOrganicRevenue, byMonth: organicByMonth, hasImported: hasOrganic } = useOrganic();
  const { count: campaignsCount, campaigns, hasImported: hasCampaigns } = useCampaigns();
  const { activeStrategy, getStrategyName } = useActiveStrategy();

  const supplierTodMap = useMemo(() => {
    const m = new Map<string, number>();
    suppliers.forEach(s => m.set(s.name, s.tod));
    return m;
  }, [suppliers]);
  const hasAnyData = hasOrganic || hasSegments || productsCount > 0 || hasCampaigns;
  
  const campaignsTyped = (campaigns ?? []) as Campaign[];
  const campaignMetrics = useMemo(() => calculateCampaignMetrics(campaignsTyped), [campaignsTyped]);
  const dashboardTotalRevenue = useMemo(
    () => calculateTotalRevenue(totalOrganicRevenue || 0, campaignsTyped),
    [totalOrganicRevenue, campaignsTyped]
  );
  

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

      {/* KPI Cards — Financial Overview */}
      {(hasOrganic || hasCampaigns) && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {(() => {
            const md: Record<string, number> = {};
            organicByMonth.forEach((v, k) => { md[k] = (md[k] || 0) + v; });
            campaignsTyped.forEach(c => {
              const d = getCampaignDateForMonth(c);
              const k = d ? d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : 'Other';
              md[k] = (md[k] || 0) + (c.conversion_value || 0);
            });
            const months = Object.entries(md).filter(([k]) => k !== 'Other');
            const sorted = months.length >= 2
              ? months.sort((a, b) => {
                  const order = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const [ma, ya] = a[0].split(' ');
                  const [mb, yb] = b[0].split(' ');
                  return (ya || '').localeCompare(yb || '') || order.indexOf(ma) - order.indexOf(mb);
                })
              : months;
            const prev = sorted.length >= 2 ? sorted[sorted.length - 2][1] : 0;
            const curr = sorted.length >= 1 ? sorted[sorted.length - 1][1] : 0;
            const momChange = prev > 0 ? ((curr - prev) / prev) * 100 : null;
            return (
              <KPICard
                kpi={{
                  label: 'Σύνολο Εσόδων',
                  value: formatCurrencyCompact(dashboardTotalRevenue),
                  change: momChange !== null ? Math.round(momChange) : undefined,
                  changeLabel: momChange !== null ? 'vs προηγ. μήνα' : undefined,
                  trend: momChange !== null ? (momChange >= 0 ? 'up' as const : 'down' as const) : 'up' as const,
                  sparklineData: Object.values(md).map(v => v / 1000)
                }}
                index={0}
                onClick={() => onSectionChange?.('roi')}
              />
            );
          })()}
          {(() => {
            const cpa = campaignMetrics.cpa;
            return (
              <KPICard
                kpi={{
                  label: 'Ad Spend',
                  value: hasCampaigns ? formatCurrencyCompact(campaignMetrics.totalSpend) : '€0',
                  changeLabel: hasCampaigns && cpa > 0
                    ? `CPA €${formatNumber(cpa, 1)} · ${formatNumber(campaignMetrics.totalConversions)} conv.`
                    : undefined,
                  trend: hasCampaigns ? 'up' as const : undefined,
                  sparklineData: campaignsTyped.slice(0, 7).map(c => c.amount_spent || 0)
                }}
                index={1}
                onClick={() => onSectionChange?.('campaigns')}
              />
            );
          })()}
          {(() => {
            const roiPercent = campaignMetrics.totalSpend > 0
              ? ((campaignMetrics.totalRevenue - campaignMetrics.totalSpend) / campaignMetrics.totalSpend) * 100
              : 0;
            return (
              <KPICard
                kpi={{
                  label: 'ROI',
                  value: roiPercent > 0 ? `+${formatNumber(roiPercent, 0)}%` : '—',
                  changeLabel: roiPercent > 0 ? 'return on investment' : undefined,
                  trend: roiPercent > 0 ? 'up' as const : undefined,
                }}
                index={2}
                onClick={() => onSectionChange?.('roi')}
                className="border-2 border-[var(--nts-accent)]/20"
              />
            );
          })()}
          <KPICard
            kpi={{
              label: 'ROAS',
              value: campaignMetrics.roas > 0 ? formatMultiplier(campaignMetrics.roas, 1) : '—',
              changeLabel: campaignMetrics.roas > 0
                ? `€1 → €${formatNumber(campaignMetrics.roas, 1)}`
                : undefined,
              trend: campaignMetrics.roas > 0 ? 'up' as const : undefined,
            }}
            index={3}
            onClick={() => onSectionChange?.('roi')}
          />
        </div>
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
                <p className="text-lg font-bold text-[var(--nts-charcoal)] font-mono">{formatNumber(productsCount)}</p>
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

interface KPICardProps {
  kpi: { label: string; value: string; change?: number; changeLabel?: string; trend?: 'up' | 'down'; sparklineData?: number[] };
  index: number;
  onClick?: () => void;
  className?: string;
}

function KPICard({ kpi, index, onClick, className }: KPICardProps) {
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
        className={`border-l-4 border-l-transparent hover:border-l-[var(--nts-accent)] h-full ${className || ''}`}
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

