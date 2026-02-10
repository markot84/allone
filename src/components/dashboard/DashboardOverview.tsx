import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  TrendingUp,
  Users,
  Package,
  DollarSign,
  Target,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { Card, CardHeader } from '../common';
import { useSegments, useProducts } from '../../hooks';
import { dashboardKPIs, aiInsights, roiMockData } from '../../data';

const revenueData = roiMockData.months.map((month, i) => ({
  month: month.split(' ')[0],
  total: roiMockData.total_revenue[i] / 1000,
  attributed: roiMockData.attributed_revenue[i] / 1000
}));

export function DashboardOverview() {
  const { segments: rfmSegments } = useSegments();
  const { count: productsCount } = useProducts();
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
          Welcome back to Performance+
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6 gap-4 sm:gap-6">
        {dashboardKPIs.map((kpi, index) => (
          <KPICard key={kpi.label} kpi={kpi} index={index} />
        ))}
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 lg:gap-8">
        {/* Revenue Trend */}
        <Card className="xl:col-span-2" padding="lg">
          <CardHeader
            title="Revenue Performance"
            subtitle="Total vs Performance+ Attributed"
            icon={<TrendingUp size={18} className="text-[var(--nts-medium-gray)]" />}
          />
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
              data={revenueData} 
              margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
            >
                <defs>
                  <linearGradient id="totalGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#9CA3AF" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#9CA3AF" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="attributedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0969da" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#0969da" stopOpacity={0}/>
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
                  tickFormatter={(value) => `€${value}K`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #d0d7de',
                    borderRadius: '6px',
                    fontSize: '12px',
                    padding: '8px 12px'
                  }}
                  formatter={(value: any, name?: string) => [
                    `€${(value || 0).toFixed(0)}K`,
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
                  stroke="#0969da"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#attributedGradient)"
                  name="attributed"
                />
              </AreaChart>
          </div>
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
        </Card>

        {/* Segment Distribution */}
        <Card padding="lg">
          <CardHeader
            title="Customer Segments"
            subtitle="RFM Distribution"
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
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #d0d7de',
                    borderRadius: '6px',
                    fontSize: '12px',
                    padding: '8px 12px'
                  }}
                  formatter={(value: any, _name?: string, props?: any) => [
                    `${(value || 0).toFixed(1)}%`,
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
                  {(segment.percentage ?? 0).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* AI Insights Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AI Insights */}
        <Card padding="lg">
          <CardHeader
            title="AI Insights"
            subtitle="Actionable recommendations"
            icon={<Target size={18} className="text-[var(--nts-medium-gray)]" />}
          />
          <div className="space-y-4">
            {aiInsights.slice(0, 4).map((insight, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`
                  p-4 rounded-md border border-[var(--nts-border-gray)]
                  ${insight.type === 'warning'
                    ? 'bg-[#fff8c5]'
                    : insight.type === 'opportunity'
                    ? 'bg-[#dafbe1]'
                    : 'bg-[var(--nts-light-gray)]'
                  }
                `}
              >
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 text-[var(--nts-medium-gray)]">
                    {insight.type === 'warning' ? <AlertTriangle size={18} /> : insight.type === 'opportunity' ? <TrendingUp size={18} /> : <Target size={18} />}
                  </span>
                  <div className="flex-1">
                    <h4 className="font-semibold text-[var(--nts-charcoal)] text-[14px] mb-1">
                      {insight.title}
                    </h4>
                    <p className="text-[13px] text-[var(--nts-medium-gray)] leading-relaxed line-clamp-2">
                      {insight.insight}
                    </p>
                  </div>
                  <button className="text-[13px] font-semibold text-[var(--nts-orange)] hover:text-[var(--nts-orange-hover)] whitespace-nowrap px-2 py-1 rounded-md hover:bg-white transition-colors">
                    {insight.action}
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>

        {/* Quick Stats */}
        <Card padding="lg">
          <CardHeader
            title="Performance Summary"
            subtitle="Last 90 days"
            icon={<DollarSign size={18} className="text-[var(--nts-medium-gray)]" />}
          />
          <div className="grid grid-cols-2 gap-5">
            <StatBox
              label="Total Products"
              value={productsCount.toLocaleString()}
              icon={<Package size={18} />}
              color="#3B82F6"
            />
            <StatBox
              label="Active Campaigns"
              value="12"
              icon={<Target size={18} />}
              color="#22C55E"
            />
            <StatBox
              label="Stock Clearance"
              value="€89.2K"
              icon={<TrendingUp size={18} />}
              color="#8B5CF6"
            />
            <StatBox
              label="Cost Savings"
              value="€62K"
              icon={<DollarSign size={18} />}
              color="#FF6B35"
            />
          </div>

          {/* ROI Highlight */}
          <div className="mt-6 p-5 bg-white rounded-xl border border-[var(--nts-border-gray)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-[var(--nts-medium-gray)] mb-1">Performance+ ROI</p>
                <p className="text-3xl font-bold tracking-tight text-[var(--nts-charcoal)] mb-1 font-mono">64x</p>
                <p className="text-[13px] text-[var(--nts-medium-gray)]">
                  Κάθε €1 → €64 attributed revenue
                </p>
              </div>
              <div className="w-10 h-10 bg-[var(--nts-light-gray)] rounded-md border border-[var(--nts-border-gray)] flex items-center justify-center">
                <TrendingUp size={18} className="text-[var(--nts-medium-gray)]" strokeWidth={2} />
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

interface KPICardProps {
  kpi: typeof dashboardKPIs[0];
  index: number;
}

function KPICard({ kpi, index }: KPICardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card padding="lg" hover className="border-l-4 border-l-transparent hover:border-l-[#0969da]">
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
        <div className="flex items-center gap-2">
          <span
            className={`text-[14px] font-semibold px-2 py-0.5 rounded-lg ${
              kpi.trend === 'up'
                ? 'text-[var(--nts-medium-gray)] bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)]'
                : kpi.trend === 'down'
                ? 'text-[var(--nts-medium-gray)] bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)]'
                : 'text-[var(--nts-medium-gray)] bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)]'
            }`}
          >
            {kpi.change > 0 ? '+' : ''}
            {kpi.change}%
          </span>
          <span className="text-[13px] text-[var(--nts-medium-gray)]">{kpi.changeLabel}</span>
        </div>
      </Card>
    </motion.div>
  );
}

interface StatBoxProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}

function StatBox({ label, value, icon, color }: StatBoxProps) {
  return (
    <div className="p-4 bg-white rounded-xl border border-[var(--nts-border-gray)] flex flex-col items-center justify-center text-center gap-2">
      <div
        className="w-11 h-11 rounded-lg border border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)] flex items-center justify-center"
        aria-hidden="true"
      >
        <span style={{ color }} className="inline-flex items-center justify-center">
          {icon}
        </span>
      </div>
      <p className="text-[12px] font-medium text-[var(--nts-medium-gray)] leading-4">{label}</p>
      <p className="text-xl font-semibold text-[var(--nts-dark-gray)] font-mono leading-6">{value}</p>
    </div>
  );
}
