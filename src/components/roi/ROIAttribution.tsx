import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  Euro,
  TrendingUp,
  Target,
  BarChart3,
  Wallet,
  ShoppingCart,
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
  Tooltip,
  Legend,
} from 'recharts';
import { Card, CardHeader, Badge, Button } from '../common';
import { useOrganic, useCampaigns, useActiveStrategy, useBrand } from '../../hooks';
import { CampaignsService, OrganicService } from '../../services/firestore';
import { useQueryClient } from '@tanstack/react-query';
import {
  calculateTotalRevenue,
  calculateCampaignMetrics,
  calculateChannelPerformance,
  getCampaignDateForMonth,
} from '../../utils/roiUtils';
import { formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import type { Campaign } from '../../types';

const CHANNEL_COLORS: Record<string, string> = {
  'Google Ads': '#4285F4',
  'Meta': '#1877F2',
  'Other': '#78716C',
  'Google Shopping': '#34A853',
  'Facebook': '#1877F2',
  'Instagram': '#E4405F',
  'TikTok': '#000000',
  'Email': '#F59E0B',
  'SMS': '#8B5CF6',
};

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

export function ROIAttribution({ embedded }: ROIAttributionProps = {}) {
  const { totalOrganicRevenue, byMonth: organicByMonth, hasImported: hasOrganic } = useOrganic();
  const { campaigns, hasImported: hasCampaigns } = useCampaigns();
  const { activeStrategy } = useActiveStrategy();
  const { currentBrand } = useBrand();
  const queryClient = useQueryClient();
  const [seeding, setSeeding] = useState(false);
  const campaignsTyped = campaigns as Campaign[];
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
  const totalRevenue = useMemo(
    () => calculateTotalRevenue(totalOrganicRevenue || 0, campaignsTyped),
    [totalOrganicRevenue, campaignsTyped]
  );
  const channelPerf = useMemo(() => calculateChannelPerformance(campaignsTyped), [campaignsTyped]);

  const trendData = useMemo(() => {
    const byMonth = new Map<string, { organic: number; campaigns: number }>();
    organicByMonth.forEach((val, key) => {
      byMonth.set(key, { organic: val, campaigns: 0 });
    });
    campaignsTyped.forEach((c) => {
      const date = getCampaignDateForMonth(c);
      const key = date ? date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : 'Other';
      const ex = byMonth.get(key) || { organic: 0, campaigns: 0 };
      byMonth.set(key, { ...ex, campaigns: ex.campaigns + (c.conversion_value || 0) });
    });
    if (byMonth.size === 0) return [];
    const order = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Array.from(byMonth.entries())
      .sort((a, b) => {
        const [ma, ya] = a[0].split(' ');
        const [mb, yb] = b[0].split(' ');
        if (ya !== yb) return (ya || '').localeCompare(yb || '');
        return order.indexOf(ma) - order.indexOf(mb);
      })
      .map(([month, d]) => ({
        month,
        organic: Math.round(d.organic),
        campaigns: Math.round(d.campaigns),
      }));
  }, [organicByMonth, campaignsTyped]);

  const topCampaigns = useMemo(() => {
    return [...campaignsTyped]
      .filter(c => (c.amount_spent || 0) > 0)
      .sort((a, b) => (b.roas || 0) - (a.roas || 0))
      .slice(0, 10);
  }, [campaignsTyped]);

  const totalSpendForBudget = metrics.totalSpend;
  const budgetUtilization = monthlyBudget > 0 ? (totalSpendForBudget / monthlyBudget) * 100 : 0;

  if (!hasData) {
    return (
      <div className="space-y-6">
        {!embedded && (
          <div>
            <h2 className="text-2xl font-bold text-[var(--nts-charcoal)]">ROI & Απόδοση</h2>
            <p className="text-[var(--nts-medium-gray)] mt-1">Μέτρηση απόδοσης καμπανιών και εσόδων</p>
          </div>
        )}
        <Card padding="lg">
          <div className="text-center py-16">
            <BarChart3 size={48} className="mx-auto text-[var(--nts-medium-gray)] mb-4" />
            <h3 className="text-lg font-semibold text-[var(--nts-charcoal)] mb-2">Δεν υπάρχουν δεδομένα</h3>
            <p className="text-[var(--nts-medium-gray)] max-w-md mx-auto mb-6">
              Φόρτωσε campaigns και organic revenue στο Data Import για να δεις την απόδοση.
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
        <div>
          <h2 className="text-2xl font-bold text-[var(--nts-charcoal)]">ROI & Απόδοση</h2>
          <p className="text-[var(--nts-medium-gray)] mt-1">Μέτρηση απόδοσης καμπανιών και εσόδων</p>
        </div>
      )}

      {/* ROI Hero + Key Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ROI Hero Card */}
        {(() => {
          const roiPercent = metrics.totalSpend > 0
            ? ((metrics.totalRevenue - metrics.totalSpend) / metrics.totalSpend) * 100
            : 0;
          const profit = metrics.totalRevenue - metrics.totalSpend;
          return (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="lg:col-span-1 rounded-2xl bg-gradient-to-br from-[#1A1A1A] to-[#2D2D2D] p-6 flex flex-col justify-between text-white shadow-xl"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">Return on Investment</span>
                <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                  <TrendingUp size={16} className="text-[var(--nts-accent)]" />
                </div>
              </div>
              <p className="text-4xl font-bold tracking-tight font-mono mb-1">
                {roiPercent > 0 ? `+${formatNumber(roiPercent, 0)}%` : '—'}
              </p>
              {profit > 0 && (
                <p className="text-[12px] text-white/40 mt-1">
                  Κέρδος {formatCurrencyCompact(profit)} σε {formatCurrencyCompact(metrics.totalSpend)} spend
                </p>
              )}
            </motion.div>
          );
        })()}

        {/* 4 Metric Cards */}
        <div className="lg:col-span-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={<Euro size={20} />}
            label="Συνολικά Έσοδα"
            value={formatCurrencyCompact(totalRevenue)}
            subtitle={hasOrganic && hasCampaigns ? 'Organic + Campaigns' : hasOrganic ? 'Organic' : 'Campaigns'}
            color="var(--nts-charcoal)"
          />
          <MetricCard
            icon={<Wallet size={20} />}
            label="Ad Spend"
            value={formatCurrencyCompact(metrics.totalSpend)}
            subtitle={`${campaignsTyped.length} campaigns`}
            color="#EF4444"
          />
          <MetricCard
            icon={<TrendingUp size={20} />}
            label="ROAS"
            value={metrics.roas > 0 ? `${formatNumber(metrics.roas, 2)}x` : '—'}
            subtitle="Μέσος σταθμισμένος"
            color="#22C55E"
          />
          <MetricCard
            icon={<ShoppingCart size={20} />}
            label="Conversions"
            value={formatNumber(metrics.totalConversions)}
            subtitle={metrics.cpa > 0 ? `CPA: €${formatNumber(metrics.cpa, 2)}` : ''}
            color="var(--nts-accent)"
          />
        </div>
      </div>

      {/* Section 2: Revenue Trend */}
      {trendData.length > 0 && (
        <Card padding="lg">
          <CardHeader
            title="Τάση Εσόδων"
            subtitle="Organic vs Campaign revenue ανά μήνα"
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
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #d0d7de',
                  borderRadius: '6px',
                  fontSize: '12px',
                  padding: '8px 12px',
                }}
                formatter={(value: any, name?: string) => [
                  formatCurrencyCompact((value as number) || 0),
                  name === 'organic' ? 'Organic Revenue' : 'Campaign Revenue',
                ]}
                labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
              />
              <Legend
                formatter={(value) => (value === 'organic' ? 'Organic' : 'Campaigns')}
                wrapperStyle={{ fontSize: 12 }}
              />
              <Area
                type="monotone"
                dataKey="organic"
                stroke="#3B82F6"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#organicGrad)"
                name="organic"
              />
              <Area
                type="monotone"
                dataKey="campaigns"
                stroke="#F97316"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#campaignGrad)"
                name="campaigns"
              />
            </AreaChart>
          </div>
        </Card>
      )}

      {/* Section 3: Channel ROI Comparison */}
      {channelPerf.length > 0 && (
        <Card padding="lg">
          <CardHeader
            title="Απόδοση ανά Κανάλι"
            subtitle="Σύγκριση ROAS, spend και conversions"
            icon={<BarChart3 size={20} className="text-[var(--nts-accent)]" />}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mt-4">
            {channelPerf.map((ch, i) => (
              <motion.div
                key={ch.channel}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="p-4 rounded-lg border border-[var(--nts-border-gray)] bg-white hover:shadow-sm transition-shadow"
              >
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: CHANNEL_COLORS[ch.channel] || '#78716C' }}
                  />
                  <span className="font-medium text-[var(--nts-charcoal)] text-sm">{ch.channel}</span>
                  <span className="text-xs text-[var(--nts-medium-gray)] ml-auto">
                    {ch.campaignCount} campaign{ch.campaignCount !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">Spend</p>
                    <p className="text-sm font-bold font-mono text-[var(--nts-charcoal)]">
                      {formatCurrencyCompact(ch.spent)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">Revenue</p>
                    <p className="text-sm font-bold font-mono text-[var(--nts-charcoal)]">
                      {formatCurrencyCompact(ch.revenue)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">ROAS</p>
                    <p className={`text-sm font-bold font-mono ${ch.roas >= 1 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                      {ch.roas > 0 ? `${formatNumber(ch.roas, 2)}x` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">Conv.</p>
                    <p className="text-sm font-mono text-[var(--nts-charcoal)]">{formatNumber(ch.conversions)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">CPA</p>
                    <p className="text-sm font-mono text-[var(--nts-charcoal)]">
                      {ch.cpa > 0 ? `€${formatNumber(ch.cpa, 2)}` : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-[var(--nts-medium-gray)] uppercase tracking-wider">CTR</p>
                    <p className="text-sm font-mono text-[var(--nts-charcoal)]">
                      {ch.ctr > 0 ? formatPercent(ch.ctr) : '—'}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
      )}

      {/* Section 4: Campaign Table */}
      {topCampaigns.length > 0 && (
        <Card padding="lg">
          <CardHeader
            title="Top Campaigns"
            subtitle="Ταξινόμηση κατά ROAS"
            icon={<Target size={20} className="text-[var(--nts-accent)]" />}
          />
          <div className="overflow-x-auto mt-2">
            <table className="w-full" style={{ minWidth: 700 }}>
              <thead>
                <tr className="text-left text-xs text-[var(--nts-medium-gray)] border-b border-[var(--nts-border-gray)]">
                  <th className="pb-3 font-medium" style={{ width: '30%' }}>Campaign</th>
                  <th className="pb-3 font-medium" style={{ width: '12%' }}>Κανάλι</th>
                  <th className="pb-3 font-medium text-right" style={{ width: '12%' }}>Spend</th>
                  <th className="pb-3 font-medium text-right" style={{ width: '12%' }}>Revenue</th>
                  <th className="pb-3 font-medium text-right" style={{ width: '10%' }}>ROAS</th>
                  <th className="pb-3 font-medium text-right" style={{ width: '10%' }}>Conv.</th>
                  <th className="pb-3 font-medium text-center" style={{ width: '10%' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.map((c, index) => (
                  <motion.tr
                    key={c.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: index * 0.03 }}
                    className="border-b border-[var(--nts-border-gray)] last:border-0 hover:bg-[var(--nts-light-gray)]"
                  >
                    <td className="py-3 pr-3">
                      <span className="text-sm font-medium text-[var(--nts-charcoal)] truncate block max-w-[280px]" title={c.name}>
                        {c.name}
                      </span>
                    </td>
                    <td className="py-3 pr-3">
                      <Badge variant="default" size="sm">{c.channel}</Badge>
                    </td>
                    <td className="py-3 text-right font-mono text-sm pr-3">
                      {formatCurrencyCompact(c.amount_spent || 0)}
                    </td>
                    <td className="py-3 text-right font-mono text-sm font-bold pr-3">
                      {formatCurrencyCompact(c.conversion_value || 0)}
                    </td>
                    <td className="py-3 text-right pr-3">
                      <span className={`font-mono text-sm font-bold ${(c.roas || 0) >= 1 ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                        {c.roas ? `${formatNumber(c.roas, 2)}x` : '—'}
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono text-sm pr-3">
                      {formatNumber(c.conversions || 0)}
                    </td>
                    <td className="py-3 text-center">
                      <CampaignStatusBadge status={c.status} />
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Section 5: Budget Utilization */}
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

function MetricCard({
  icon, label, value, subtitle, color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle: string;
  color: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <Card padding="md" hover className="h-full">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg border border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)] flex items-center justify-center text-[var(--nts-medium-gray)] flex-shrink-0">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-[var(--nts-medium-gray)]">{label}</p>
            <p className="text-xl font-bold font-mono mt-0.5" style={{ color }}>{value}</p>
            {subtitle && <p className="text-[10px] text-[var(--nts-medium-gray)] mt-0.5">{subtitle}</p>}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function CampaignStatusBadge({ status }: { status?: string }) {
  const s = (status || '').toLowerCase();
  if (s === 'active' || s === 'enabled') return <Badge variant="success" size="sm">Active</Badge>;
  if (s === 'paused') return <Badge variant="warning" size="sm">Paused</Badge>;
  if (s === 'completed' || s === 'removed') return <Badge variant="default" size="sm">Ended</Badge>;
  return <Badge variant="default" size="sm">{status || '—'}</Badge>;
}
