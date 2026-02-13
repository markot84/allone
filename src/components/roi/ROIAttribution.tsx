import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Euro,
  TrendingUp,
  Target,
  PieChart as PieChartIcon,
  Info,
  Download,
  ChevronRight,
  ChevronDown,
  Award,
  HelpCircle
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
  Cell,
  ReferenceLine
} from 'recharts';
import { Card, CardHeader, Badge, Button } from '../common';
import { useAnalytics, useSegments, useProducts } from '../../hooks';
import {
  roiDashboard,
  roiCalculator,
  roiMockData,
  segmentPerformance,
  costSavings,
  attributionMethodology
} from '../../data/mockROI';

const COLORS = ['#22C55E', '#3B82F6', '#FF6B35', '#8B5CF6', '#F59E0B'];

export function ROIAttribution() {
  const { revenueData, hasImported: hasAnalytics } = useAnalytics();
  const { hasImported: hasSegments } = useSegments();
  const { count: productsCount } = useProducts();
  const hasAnyData = hasAnalytics || hasSegments || productsCount > 0;
  const [showMethodology, setShowMethodology] = useState(false);
  const [selectedBreakdown, setSelectedBreakdown] = useState<string | null>(null);
  const trendContainerRef = useRef<HTMLDivElement>(null);
  const breakdownContainerRef = useRef<HTMLDivElement>(null);
  const [chartDimensions, setChartDimensions] = useState({ trend: { width: 800, height: 288 }, breakdown: { width: 400, height: 192 } });

  useEffect(() => {
    const updateDimensions = () => {
      if (trendContainerRef.current) {
        const width = trendContainerRef.current.offsetWidth || 800;
        setChartDimensions(prev => ({
          ...prev,
          trend: { width: Math.max(width, 400), height: 288 }
        }));
      }
      if (breakdownContainerRef.current) {
        const width = breakdownContainerRef.current.offsetWidth || 400;
        setChartDimensions(prev => ({
          ...prev,
          breakdown: { width: Math.max(width, 300), height: 192 }
        }));
      }
    };

    updateDimensions();
    const resizeObserver = new ResizeObserver(updateDimensions);
    if (trendContainerRef.current) resizeObserver.observe(trendContainerRef.current);
    if (breakdownContainerRef.current) resizeObserver.observe(breakdownContainerRef.current);

    return () => resizeObserver.disconnect();
  }, []);

  // Prepare trend data (revenueData from useAnalytics = real or mock)
  const trendData = revenueData.map((r) => ({
    month: r.month,
    total: r.total,
    attributed: r.attributed,
    rate: r.total > 0 ? Math.round((r.attributed / r.total) * 1000) / 10 : 0
  }));

  // Prepare breakdown data (zeros when no imported data)
  const summary = hasAnyData ? roiDashboard.summary : { total_revenue: 0, performance_plus_attributed: 0, attribution_percentage: 0, roi_multiplier: 0 };
  const roiDisplay = hasAnyData ? roiCalculator.display : { headline: '0x ROI', subheadline: 'Φόρτωσε δεδομένα για να δεις το ROI', disclaimer: 'Βάσει conservative attribution methodology' };
  const breakdownData = hasAnyData
    ? [
        { id: 'segment', name: 'Segment Campaigns', value: roiDashboard.breakdown.segment_activation.percentage, amount: roiDashboard.breakdown.segment_activation.revenue, details: roiDashboard.breakdown.segment_activation.details },
        { id: 'inventory', name: 'Stock Clearance', value: roiDashboard.breakdown.inventory_optimization.percentage, amount: roiDashboard.breakdown.inventory_optimization.revenue, details: roiDashboard.breakdown.inventory_optimization.details, costAvoided: roiDashboard.breakdown.inventory_optimization.cost_avoided },
        { id: 'channel', name: 'Channel Optimization', value: roiDashboard.breakdown.channel_optimization.percentage, amount: roiDashboard.breakdown.channel_optimization.revenue, details: roiDashboard.breakdown.channel_optimization.details }
      ]
    : [
        { id: 'segment', name: 'Segment Campaigns', value: 0, amount: 0, details: [] },
        { id: 'inventory', name: 'Stock Clearance', value: 0, amount: 0, details: [], costAvoided: 0 },
        { id: 'channel', name: 'Channel Optimization', value: 0, amount: 0, details: [] }
      ];
  const segmentPerf = hasAnyData ? segmentPerformance : [];
  const costSavingsData = hasAnyData ? costSavings : { period: 'Last 90 Days', items: [], total: 0 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">ROI Attribution</h2>
          <p className="text-[#4A4A4A] mt-1">
            Measure and prove Performance+ impact on your business
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            variant="secondary" 
            icon={<HelpCircle size={16} />}
            onClick={() => setShowMethodology(!showMethodology)}
          >
            Methodology
          </Button>
          <Button variant="primary" icon={<Download size={16} />}>
            Export Report
          </Button>
        </div>
      </div>

      {/* Hero ROI Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card padding="lg" className="bg-white border-2 border-[var(--nts-border-gray)]">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {/* Main ROI Display */}
            <div className="md:col-span-2">
              <p className="text-[var(--nts-medium-gray)] text-sm mb-2 flex items-center gap-2">
                <Euro size={16} className="text-[var(--nts-medium-gray)]" /> Performance+ ROI ({roiDashboard.period})
              </p>
              <div className="flex items-baseline gap-4 flex-wrap">
                <motion.span 
                  className="text-6xl font-bold text-[var(--nts-charcoal)]"
                  initial={{ scale: 0.5 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 200 }}
                >
                  {roiDisplay.headline}
                </motion.span>
                {summary.attribution_percentage > 0 && (
                  <Badge variant="success" size="md">
                    +{summary.attribution_percentage}% attributed
                  </Badge>
                )}
              </div>
              <p className="text-[var(--nts-medium-gray)] mt-4 max-w-md">
                {roiDisplay.subheadline}
              </p>
              <p className="text-xs text-[var(--nts-medium-gray)] mt-2 flex items-center gap-1">
                <Info size={12} />
                {roiDisplay.disclaimer}
              </p>
            </div>

            {/* Key Metrics */}
            <div className="space-y-4">
              <MetricBox 
                icon={<Euro size={20} />}
                label="Σύνολο Εσόδων" 
                value={`€${(summary.total_revenue / 1000).toFixed(1)}K`}
                color="var(--nts-charcoal)"
              />
              <MetricBox 
                icon={<Target size={20} />}
                label="P+ Attributed" 
                value={`€${(summary.performance_plus_attributed / 1000).toFixed(1)}K`}
                color="var(--nts-orange)"
                highlight
              />
            </div>

            <div className="space-y-4">
              <MetricBox 
                icon={<Euro size={20} />}
                label="Κόστος Συνδρομής" 
                value={`€${(hasAnyData ? roiCalculator.subscription_cost_period : 0).toLocaleString()}`}
                color="var(--nts-charcoal)"
              />
              <MetricBox 
                icon={<TrendingUp size={20} />}
                label="ROI Πολλαπλασιαστής" 
                value={`${summary.roi_multiplier}x`}
                color="var(--success)"
              />
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Impact Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ImpactCard
          icon="💶"
          label="Σύνολο Εσόδων"
          value={`€${(summary.total_revenue / 1000).toFixed(1)}K`}
          subtext={hasAnyData ? '+18.2% vs previous period' : 'Φόρτωσε δεδομένα'}
        />
        <ImpactCard
          icon="🎯"
          label="Performance+ Attributed"
          value={`€${(summary.performance_plus_attributed / 1000).toFixed(1)}K`}
          subtext={hasAnyData ? `${summary.attribution_percentage}% of total revenue` : 'Φόρτωσε δεδομένα'}
          highlight
        />
        <ImpactCard
          icon="📈"
          label="ROI Πολλαπλασιαστής"
          value={`${summary.roi_multiplier}x`}
          subtext="Return on subscription cost"
        />
        <ImpactCard
          icon="💰"
          label="Εξοικονομήσεις"
          value={`€${(costSavingsData.total / 1000).toFixed(0)}K`}
          subtext={hasAnyData ? 'Warehousing + Ad efficiency' : 'Φόρτωσε δεδομένα'}
        />
      </div>

      {/* Revenue Trend + Attribution Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" padding="lg">
          <CardHeader
            title="Revenue Attribution Trend"
            subtitle="Σύνολο vs Performance+ attributed revenue"
            icon={<TrendingUp size={20} className="text-[#FF6B35]" />}
          />
          <div 
            ref={trendContainerRef}
            className="w-full" 
            style={{ 
              width: '100%', 
              height: '288px', 
              minHeight: '288px', 
              position: 'relative'
            }}
          >
            <AreaChart 
              width={chartDimensions.trend.width} 
              height={chartDimensions.trend.height} 
              data={trendData} 
              margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
            >
                <defs>
                  <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#E5E5E5" stopOpacity={0.8}/>
                    <stop offset="95%" stopColor="#E5E5E5" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="attrGrad" x1="0" y1="0" x2="0" y2="1">
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
                  tickFormatter={(v) => `€${v}K`} 
                  tick={{ fill: '#57606a', fontSize: 12 }}
                  axisLine={{ stroke: '#d0d7de' }}
                  tickLine={{ stroke: '#d0d7de' }}
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
                    `€${((value as number) || 0).toFixed(0)}K`,
                    name === 'total' ? 'Total Revenue' : 'P+ Attributed'
                  ]}
                  labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
                />
                {/* Milestone annotations */}
                <ReferenceLine x="Sep" stroke="#0969da" strokeDasharray="3 3" label={{ value: 'Launch', position: 'top', fontSize: 10, fill: '#57606a' }} />
                <Area 
                  type="monotone" 
                  dataKey="total" 
                  stroke="#9CA3AF" 
                  strokeWidth={2} 
                  fillOpacity={1}
                  fill="url(#totalGrad)" 
                  name="total" 
                />
                <Area 
                  type="monotone" 
                  dataKey="attributed" 
                  stroke="#0969da" 
                  strokeWidth={2} 
                  fillOpacity={1}
                  fill="url(#attrGrad)" 
                  name="attributed" 
                />
              </AreaChart>
          </div>

          {/* Milestones */}
          {hasAnyData && (
          <div className="mt-4 pt-4 border-t border-[#E5E5E5]">
            <p className="text-sm font-medium text-[#1A1A1A] mb-3">Key Milestones</p>
            <div className="flex flex-wrap gap-2">
              {roiMockData.milestones.map((milestone, index) => (
                <Badge
                  key={index}
                  variant={
                    milestone.type === 'start' ? 'info' :
                    milestone.type === 'peak' ? 'success' :
                    milestone.type === 'milestone' ? 'orange' : 'default'
                  }
                  size="md"
                >
                  {milestone.month}: {milestone.event}
                </Badge>
              ))}
            </div>
          </div>
          )}
        </Card>

        {/* Attribution Breakdown */}
        <Card padding="lg">
          <CardHeader
            title="Attribution Breakdown"
            subtitle="Έσοδα ανά πηγή"
            icon={<PieChartIcon size={20} className="text-[#FF6B35]" />}
          />
          <div 
            ref={breakdownContainerRef}
            className="w-full" 
            style={{ 
              width: '100%', 
              height: '192px', 
              minHeight: '192px', 
              position: 'relative'
            }}
          >
            <PieChart width={chartDimensions.breakdown.width} height={chartDimensions.breakdown.height}>
                <Pie
                  data={breakdownData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={3}
                  dataKey="value"
                  onClick={(data) => setSelectedBreakdown(selectedBreakdown === data.id ? null : data.id)}
                >
                  {breakdownData.map((_, index) => (
                    <Cell 
                      key={index} 
                      fill={COLORS[index]} 
                      stroke={selectedBreakdown === breakdownData[index].id ? '#1A1A1A' : 'transparent'}
                      strokeWidth={2}
                      cursor="pointer"
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: '#fff', border: '1px solid #E5E5E5', borderRadius: '8px' }}
                  formatter={(value) => [`${value || 0}%`, '']}
                />
              </PieChart>
          </div>
          <div className="space-y-3 mt-4">
            {breakdownData.map((item, index) => (
              <button
                key={item.id}
                onClick={() => setSelectedBreakdown(selectedBreakdown === item.id ? null : item.id)}
                className={`w-full flex items-center justify-between p-2 rounded-lg transition-all ${
                  selectedBreakdown === item.id ? 'bg-[#F5F5F5]' : 'hover:bg-[#F5F5F5]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index] }} />
                  <span className="text-sm text-[#4A4A4A]">{item.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[#1A1A1A] font-mono">
                    €{(item.amount / 1000).toFixed(1)}K
                  </span>
                  <ChevronRight 
                    size={14} 
                    className={`text-[#9CA3AF] transition-transform ${selectedBreakdown === item.id ? 'rotate-90' : ''}`}
                  />
                </div>
              </button>
            ))}
          </div>

          {/* Detail Expansion */}
          <AnimatePresence>
            {selectedBreakdown && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4 pt-4 border-t border-[#E5E5E5]"
              >
                <p className="text-xs font-medium text-[#1A1A1A] mb-2">Details</p>
                <div className="space-y-2">
                  {breakdownData.find(b => b.id === selectedBreakdown)?.details.map((detail: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="text-[#4A4A4A]">
                        {detail.segment || detail.type || detail.metric || detail.name}
                      </span>
                      <span className="font-mono text-[#1A1A1A]">
                        {detail.revenue 
                          ? `€${(detail.revenue / 1000).toFixed(1)}K` 
                          : detail.value 
                          ? `€${typeof detail.value === 'number' ? detail.value.toLocaleString() : detail.value}`
                          : detail.before !== undefined && detail.after !== undefined
                          ? `€${detail.before.toFixed(2)} → €${detail.after.toFixed(2)} ${detail.improvement || ''}`
                          : detail.improvement || ''}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>

      {/* Segment Performance */}
      <Card padding="lg">
        <CardHeader
          title="Segment Performance"
          subtitle="Αποτελέσματα campaigns ανά RFM segment"
          icon={<Target size={20} className="text-[#FF6B35]" />}
        />
        {segmentPerf.length === 0 ? (
          <p className="text-sm text-[#4A4A4A] py-8 text-center">
            Φόρτωσε RFM δεδομένα για να δεις την απόδοση ανά segment.
          </p>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-[#4A4A4A] border-b border-[#E5E5E5]">
                <th className="pb-3 font-medium">Segment</th>
                <th className="pb-3 font-medium">Customers</th>
                <th className="pb-3 font-medium">Campaigns</th>
                <th className="pb-3 font-medium">Revenue</th>
                <th className="pb-3 font-medium">AOV</th>
                <th className="pb-3 font-medium">Conv. Rate</th>
                <th className="pb-3 font-medium">vs Benchmark</th>
              </tr>
            </thead>
            <tbody>
              {segmentPerf.map((seg, index) => (
                <motion.tr
                  key={seg.segment}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: index * 0.05 }}
                  className="border-b border-[#E5E5E5] last:border-0 hover:bg-[#F5F5F5]"
                >
                  <td className="py-3">
                    <span className="font-medium text-[#1A1A1A]">{seg.segment}</span>
                  </td>
                  <td className="py-3 font-mono text-sm">
                    {seg.customers_targeted.toLocaleString()}
                  </td>
                  <td className="py-3 font-mono text-sm">
                    {seg.campaigns_run}
                  </td>
                  <td className="py-3">
                    <span className="font-bold text-[#1A1A1A] font-mono">
                      €{(seg.revenue_generated / 1000).toFixed(1)}K
                    </span>
                  </td>
                  <td className="py-3 font-mono text-sm">
                    €{seg.avg_order_value}
                  </td>
                  <td className="py-3">
                    <Badge variant="info">{seg.conversion_rate}</Badge>
                  </td>
                  <td className="py-3">
                    <Badge variant="success">{seg.vs_benchmark}</Badge>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </Card>

      {/* Cost Savings + Methodology */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card padding="lg">
          <CardHeader
            title="Cost Savings"
            subtitle={costSavingsData.period === 'Last 90 Days' ? 'Τελευταίες 90 ημέρες' : costSavingsData.period}
            icon={<Euro size={20} className="text-[#22C55E]" />}
          />
          <div className="space-y-4">
            {costSavingsData.items.map((item, index) => (
              <motion.div
                key={item.category}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-center justify-between p-4 bg-[#F5F5F5] rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{item.icon}</span>
                  <div>
                    <p className="font-medium text-[#1A1A1A]">{item.category}</p>
                    <p className="text-xs text-[#4A4A4A]">{item.description}</p>
                  </div>
                </div>
                <span className="text-lg font-bold text-[#22C55E] font-mono">
                  €{item.amount.toLocaleString()}
                </span>
              </motion.div>
            ))}
            <div className="pt-4 border-t border-[#E5E5E5] flex justify-between items-center">
              <span className="font-medium text-[#1A1A1A]">Total Savings</span>
              <span className="text-2xl font-bold text-[#22C55E] font-mono">
                €{costSavingsData.total.toLocaleString()}
              </span>
            </div>
          </div>
        </Card>

        {/* Attribution Methodology Panel */}
        <Card padding="lg">
          <CardHeader
            title="Attribution Methodology"
            subtitle="Διαφανής προσέγγιση μέτρησης"
            icon={<Info size={20} className="text-[#3B82F6]" />}
            action={
              <button
                onClick={() => setShowMethodology(!showMethodology)}
                className="flex items-center gap-1 text-sm text-[#FF6B35] hover:underline"
              >
                {showMethodology ? 'Collapse' : 'Expand'}
                <ChevronDown size={14} className={`transition-transform ${showMethodology ? 'rotate-180' : ''}`} />
              </button>
            }
          />
          
          <div className="p-4 bg-[#DBEAFE] border border-[#3B82F6]/20 rounded-lg mb-4">
            <p className="text-sm text-[#1E40AF]">
              <strong>Πώς υπολογίζουμε το Impact:</strong> Χρησιμοποιούμε conservative attribution για να διασφαλίσουμε ότι τα αποτελέσματα είναι αξιόπιστα και επαληθεύσιμα.
            </p>
          </div>

          <div className="space-y-3">
            {attributionMethodology.methods.map((method, index) => (
              <motion.div
                key={method.name}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="p-4 border border-[#E5E5E5] rounded-lg"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-medium text-[#1A1A1A] text-sm">{method.name}</h4>
                    <p className="text-xs text-[#4A4A4A] mt-1">{method.description}</p>
                    <AnimatePresence>
                      {showMethodology && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="text-xs text-[#9CA3AF] mt-2"
                        >
                          <span className="font-medium">Tracking:</span> {method.tracking}
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </div>
                  <Badge
                    variant={method.confidence === 'high' ? 'success' : 'warning'}
                    size="sm"
                  >
                    {method.confidence}
                  </Badge>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      </div>

      {/* Executive Summary CTA */}
      <Card padding="lg">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gradient-to-br from-[#FF6B35] to-[#FF8C5A] rounded-xl flex items-center justify-center">
              <Award size={28} className="text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#1A1A1A]">Executive Summary Report</h3>
              <p className="text-[#4A4A4A]">
                Download a one-page PDF report for board/management presentations
              </p>
            </div>
          </div>
          <Button variant="primary" size="lg" icon={<Download size={18} />}>
            Generate PDF Report
          </Button>
        </div>
      </Card>
    </div>
  );
}

// Helper Components
function MetricBox({ icon, label, value, color, highlight = false }: { 
  icon: React.ReactNode; 
  label: string; 
  value: string; 
  color: string;
  highlight?: boolean;
}) {
  return (
    <div className={`p-4 rounded-lg border ${highlight ? 'bg-[var(--nts-orange-light)] border-[var(--nts-orange)]' : 'bg-[var(--nts-light-gray)] border-[var(--nts-border-gray)]'}`}>
      <p className="text-[var(--nts-medium-gray)] text-xs flex items-center gap-2 mb-2">
        <span className="text-[var(--nts-medium-gray)]">{icon}</span> {label}
      </p>
      <p className="text-xl font-bold font-mono" style={{ color }}>{value}</p>
    </div>
  );
}

function ImpactCard({ icon, label, value, subtext, highlight = false }: {
  icon: string;
  label: string;
  value: string;
  subtext: string;
  highlight?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card 
        padding="md" 
        hover 
        className={highlight ? 'bg-[var(--nts-orange-light)] border-[var(--nts-orange)]' : ''}
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <p className={`text-sm ${highlight ? 'text-[var(--nts-charcoal)]' : 'text-[var(--nts-medium-gray)]'}`}>{label}</p>
            <p className={`text-2xl font-bold font-mono ${highlight ? 'text-[var(--nts-orange)]' : 'text-[var(--nts-charcoal)]'}`}>
              {value}
            </p>
            <p className={`text-xs mt-1 text-[var(--nts-medium-gray)]`}>
              {subtext}
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
