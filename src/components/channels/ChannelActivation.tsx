import { useState, useMemo, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  PieChart as PieChartIcon,
  TrendingUp,
  Download,
  RefreshCw,
  Eye,
  Settings
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend
} from 'recharts';
import { Card, CardHeader, Badge, Button, Spinner } from '../common';
import { useProducts, useCampaigns } from '../../hooks';
import { channelMixByScenario, channelPerformanceHistory } from '../../data/mockChannels';
import { scenarios } from '../../data/mockScenarios';
import type { Campaign } from '../../types';

const COLORS = ['#FF6B35', '#3B82F6', '#22C55E', '#8B5CF6', '#F59E0B'];

interface ChannelActivationProps {
  onSectionChange?: (section: string) => void;
}

export function ChannelActivation({ onSectionChange }: ChannelActivationProps = {}) {
  const { count: productsCount } = useProducts();
  const { campaigns, isLoading: campaignsLoading, hasImported: hasCampaigns } = useCampaigns();
  const [selectedScenario, setSelectedScenario] = useState('profit_max');
  const [budgetMultiplier, setBudgetMultiplier] = useState(1);
  const historyChartRef = useRef<HTMLDivElement>(null);
  const [historyChartSize, setHistoryChartSize] = useState({ width: 800, height: 288 });

  // Calculate real channel performance from imported campaigns
  const realChannelPerformance = useMemo(() => {
    if (!hasCampaigns || campaigns.length === 0) return null;

    const channelStats: Record<string, {
      totalSpent: number;
      totalConversions: number;
      totalConversionValue: number;
      totalImpressions: number;
      totalClicks: number;
      campaignCount: number;
    }> = {};

    (campaigns as Campaign[]).forEach((campaign) => {
      const channel = campaign.channel || 'Other';
      if (!channelStats[channel]) {
        channelStats[channel] = {
          totalSpent: 0,
          totalConversions: 0,
          totalConversionValue: 0,
          totalImpressions: 0,
          totalClicks: 0,
          campaignCount: 0,
        };
      }

      const stats = channelStats[channel];
      stats.totalSpent += campaign.amount_spent || 0;
      stats.totalConversions += campaign.conversions || 0;
      stats.totalConversionValue += campaign.conversion_value || 0;
      stats.totalImpressions += campaign.impressions || 0;
      stats.totalClicks += campaign.clicks || 0;
      stats.campaignCount += 1;
    });

    // Calculate ROAS for each channel
    const channelPerformance: Array<{
      channel: string;
      spent: number;
      roas: number;
      conversions: number;
      conversionValue: number;
      ctr: number;
      cpc: number;
      campaignCount: number;
    }> = Object.entries(channelStats).map(([channel, stats]) => {
      const roas = stats.totalSpent > 0 ? stats.totalConversionValue / stats.totalSpent : 0;
      const ctr = stats.totalImpressions > 0 ? (stats.totalClicks / stats.totalImpressions) * 100 : 0;
      const cpc = stats.totalClicks > 0 ? stats.totalSpent / stats.totalClicks : 0;

      return {
        channel,
        spent: stats.totalSpent,
        roas: roas || 0,
        conversions: stats.totalConversions,
        conversionValue: stats.totalConversionValue,
        ctr,
        cpc,
        campaignCount: stats.campaignCount,
      };
    });

    return channelPerformance.sort((a, b) => b.spent - a.spent);
  }, [campaigns, hasCampaigns]);

  // Calculate monthly performance history from campaigns
  const realPerformanceHistory = useMemo(() => {
    if (!hasCampaigns || campaigns.length === 0) return null;

    const monthlyData: Record<string, {
      google: number;
      meta: number;
      email: number;
      remarketing: number;
      sms: number;
    }> = {};

    (campaigns as Campaign[]).forEach((campaign) => {
      const period = campaign.period || campaign.start_date || '';
      if (!period) return;

      // Extract month from period (e.g., "January 2025" or "2025-01-01")
      let monthKey = '';
      if (period.match(/^\d{4}-\d{2}-\d{2}/)) {
        const date = new Date(period);
        monthKey = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      } else {
        monthKey = period;
      }

      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { google: 0, meta: 0, email: 0, remarketing: 0, sms: 0 };
      }

      const roas = campaign.roas || 0;
      const channel = campaign.channel?.toLowerCase() || 'other';

      if (channel.includes('google')) {
        monthlyData[monthKey].google = Math.max(monthlyData[monthKey].google, roas);
      } else if (channel.includes('meta') || channel.includes('facebook')) {
        monthlyData[monthKey].meta = Math.max(monthlyData[monthKey].meta, roas);
      } else if (channel.includes('email')) {
        monthlyData[monthKey].email = Math.max(monthlyData[monthKey].email, roas);
      } else if (channel.includes('remarketing') || channel.includes('display')) {
        monthlyData[monthKey].remarketing = Math.max(monthlyData[monthKey].remarketing, roas);
      } else if (channel.includes('sms')) {
        monthlyData[monthKey].sms = Math.max(monthlyData[monthKey].sms, roas);
      }
    });

    return Object.entries(monthlyData)
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => {
        const dateA = new Date(a.month);
        const dateB = new Date(b.month);
        return dateA.getTime() - dateB.getTime();
      })
      .slice(-6); // Last 6 months
  }, [campaigns, hasCampaigns]);

  useEffect(() => {
    const update = () => {
      if (historyChartRef.current) {
        const w = historyChartRef.current.offsetWidth || 800;
        setHistoryChartSize({ width: Math.max(w, 400), height: 288 });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (historyChartRef.current) ro.observe(historyChartRef.current);
    return () => ro.disconnect();
  }, []);

  // Calculate real channel mix from campaigns
  const realChannelMix = useMemo(() => {
    if (!hasCampaigns || !realChannelPerformance || realChannelPerformance.length === 0) return null;

    const totalSpent = realChannelPerformance.reduce((sum, ch) => sum + ch.spent, 0);
    if (totalSpent === 0) return null;

    const allocation = realChannelPerformance.map((ch) => {
      const percentage = totalSpent > 0 ? (ch.spent / totalSpent) * 100 : 0;
      return {
        channel: ch.channel,
        budget: ch.spent * budgetMultiplier,
        percentage: Math.round(percentage * 10) / 10,
        target_segments: [] as string[],
        expected_roas: ch.roas,
        priority_products: [] as string[],
        rationale: `${ch.campaignCount} campaigns, ${ch.conversions.toLocaleString()} conversions`,
      };
    });

    return {
      total_budget: totalSpent * budgetMultiplier,
      allocation,
    };
  }, [realChannelPerformance, hasCampaigns, budgetMultiplier]);

  const channelMix = useMemo(() => {
    // Use real data if available, otherwise fallback to mock
    if (realChannelMix) {
      return realChannelMix;
    }
    const mix = channelMixByScenario[selectedScenario] || channelMixByScenario.profit_max;
    return {
      ...mix,
      total_budget: mix.total_budget * budgetMultiplier,
      allocation: mix.allocation.map(a => ({
        ...a,
        budget: a.budget * budgetMultiplier
      }))
    };
  }, [realChannelMix, selectedScenario, budgetMultiplier]);

  const weightedROAS = useMemo(() => {
    const total = channelMix.allocation.reduce((sum, ch) => sum + ch.budget, 0);
    return channelMix.allocation.reduce(
      (sum, ch) => sum + (ch.expected_roas * ch.budget / total),
      0
    ).toFixed(1);
  }, [channelMix]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Channel Activation</h2>
          <p className="text-[#4A4A4A] mt-1">
            AI-powered channel recommendations based on your strategy
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" icon={<RefreshCw size={16} />}>
            Sync Feeds
          </Button>
          <Button variant="primary" icon={<Download size={16} />}>
            Export All
          </Button>
        </div>
      </div>

      {/* Scenario & Budget Selector */}
      {!hasCampaigns && (
        <Card padding="md">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
                Strategy Scenario
              </label>
              <select
                value={selectedScenario}
                onChange={(e) => setSelectedScenario(e.target.value)}
                className="w-full px-4 py-2.5 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[#FF6B35] focus:bg-white transition-all"
              >
                {scenarios.filter(s => s.id !== 'custom').map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </div>

          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium text-[#1A1A1A] mb-2 block">
              Budget Multiplier
            </label>
            <div className="flex items-center gap-3">
              {[0.5, 1, 1.5, 2].map((mult) => (
                <button
                  key={mult}
                  onClick={() => setBudgetMultiplier(mult)}
                  className={`
                    px-4 py-2 rounded-lg text-sm font-medium transition-all
                    ${budgetMultiplier === mult
                      ? 'bg-[#FF6B35] text-white'
                      : 'bg-[#F5F5F5] text-[#4A4A4A] hover:bg-[#E5E5E5]'}
                  `}
                >
                  {mult}x
                </button>
              ))}
            </div>
          </div>

          <div className="text-right">
            <p className="text-sm text-[#4A4A4A]">Total Budget</p>
            <p className="text-2xl font-bold text-[#1A1A1A] font-mono">
              €{channelMix.total_budget.toLocaleString()}
            </p>
          </div>
        </div>
      </Card>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Channel Mix Chart */}
        <Card padding="lg">
          <CardHeader
            title="Channel Mix"
            subtitle={hasCampaigns ? "Πραγματική budget allocation από campaigns" : "Budget allocation"}
            icon={<PieChartIcon size={20} className="text-[#FF6B35]" />}
          />
          {campaignsLoading ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" label="Φόρτωση campaigns…" />
            </div>
          ) : channelMix && channelMix.allocation && channelMix.allocation.length > 0 ? (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={channelMix.allocation}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={85}
                      paddingAngle={2}
                      dataKey="percentage"
                      nameKey="channel"
                    >
                      {channelMix.allocation.map((_, index) => (
                        <Cell key={channelMix.allocation[index].channel} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #E5E5E5',
                        borderRadius: '8px'
                      }}
                      formatter={(value: number | undefined) => [`${value ? value.toFixed(1) : '0'}%`, '']}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 mt-4">
                {channelMix.allocation.map((channel, index) => (
                  <div key={channel.channel} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="text-[#4A4A4A] truncate max-w-[120px]">{channel.channel}</span>
                    </div>
                    <span className="font-mono text-[#1A1A1A]">
                      €{channel.budget.toLocaleString()} ({channel.percentage.toFixed(1)}%)
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : channelMix && channelMix.allocation && channelMix.allocation.length > 0 ? (
            <>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={channelMix.allocation}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={85}
                      paddingAngle={2}
                      dataKey="percentage"
                      nameKey="channel"
                    >
                      {channelMix.allocation.map((_, index) => (
                        <Cell key={channelMix.allocation[index]?.channel || index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #E5E5E5',
                        borderRadius: '8px'
                      }}
                      formatter={(value, name) => [`${value || 0}%`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 mt-4">
                {channelMix.allocation.map((channel, index) => (
                  <div key={channel.channel} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="text-[#4A4A4A] truncate max-w-[120px]">{channel.channel}</span>
                    </div>
                    <span className="font-mono text-[#1A1A1A]">
                      €{channel.budget.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-64">
              <p className="text-sm text-[#4A4A4A]">Δεν υπάρχουν δεδομένα για Channel Mix</p>
            </div>
          )}
        </Card>

        {/* Channel Details */}
        <Card className="lg:col-span-2" padding="lg">
          <CardHeader
            title={hasCampaigns ? "Channel Performance" : "Channel Recommendations"}
            subtitle={hasCampaigns ? "Πραγματικά δεδομένα από imported campaigns" : "Detailed allocation with expected ROAS"}
            action={
              hasCampaigns && realChannelPerformance ? (
                <Badge variant="success" size="md">
                  Avg ROAS: {(
                    realChannelPerformance.reduce((sum, ch) => sum + ch.roas, 0) / realChannelPerformance.length
                  ).toFixed(1)}x
                </Badge>
              ) : (
                <Badge variant="success" size="md">
                  Avg ROAS: {weightedROAS}x
                </Badge>
              )
            }
          />
          {campaignsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner size="lg" label="Φόρτωση campaigns…" />
            </div>
          ) : hasCampaigns && realChannelPerformance && realChannelPerformance.length > 0 ? (
            <div className="space-y-4">
              {realChannelPerformance.map((channel, index) => (
                <motion.div
                  key={channel.channel}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className="p-4 bg-[#F5F5F5] rounded-xl"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      >
                        {index + 1}
                      </div>
                      <div>
                        <h4 className="font-semibold text-[#1A1A1A]">{channel.channel}</h4>
                        <p className="text-sm text-[#4A4A4A] mt-1">
                          {channel.campaignCount} {channel.campaignCount === 1 ? 'campaign' : 'campaigns'}
                        </p>
                        <div className="flex flex-wrap gap-3 mt-3 text-xs text-[#4A4A4A]">
                          <div>
                            <span className="font-medium">Conversions:</span> {channel.conversions.toLocaleString()}
                          </div>
                          <div>
                            <span className="font-medium">CTR:</span> {channel.ctr.toFixed(2)}%
                          </div>
                          <div>
                            <span className="font-medium">CPC:</span> €{channel.cpc.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-[#1A1A1A] font-mono">
                        €{channel.spent.toLocaleString()}
                      </p>
                      <p className="text-sm text-[#4A4A4A]">Spent</p>
                      <Badge variant="success" className="mt-2">
                        ROAS: {channel.roas.toFixed(2)}x
                      </Badge>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {channelMix.allocation.map((channel, index) => (
                <motion.div
                key={channel.channel}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="p-4 bg-[#F5F5F5] rounded-xl"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold"
                      style={{ backgroundColor: COLORS[index % COLORS.length] }}
                    >
                      {index + 1}
                    </div>
                    <div>
                      <h4 className="font-semibold text-[#1A1A1A]">{channel.channel}</h4>
                      <p className="text-sm text-[#4A4A4A] mt-1">{channel.rationale}</p>
                      
                      <div className="flex flex-wrap gap-2 mt-3">
                        <div className="text-xs text-[#4A4A4A]">
                          <span className="font-medium">Segments:</span>{' '}
                          {channel.target_segments.join(', ')}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {channel.priority_products.map((prod) => (
                          <Badge key={prod} variant="default" size="sm">
                            {prod}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-[#1A1A1A] font-mono">
                      €{channel.budget.toLocaleString()}
                    </p>
                    <p className="text-sm text-[#4A4A4A]">{channel.percentage}%</p>
                    <Badge variant="success" className="mt-2">
                      ROAS: {channel.expected_roas}x
                    </Badge>
                  </div>
                </div>
              </motion.div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Performance History */}
      <Card padding="lg">
        <CardHeader
          title="Channel Performance History"
          subtitle="ROAS trend τελευταίων 6 μηνών"
          icon={<TrendingUp size={20} className="text-[#FF6B35]" />}
        />
        <div
          ref={historyChartRef}
          className="w-full"
          style={{ width: '100%', height: 288, minHeight: 288, position: 'relative' }}
        >
          {(realPerformanceHistory && realPerformanceHistory.length > 0) || (channelPerformanceHistory && channelPerformanceHistory.length > 0) ? (
            <LineChart
              width={historyChartSize.width}
              height={historyChartSize.height}
              data={realPerformanceHistory || channelPerformanceHistory || []}
              margin={{ top: 10, right: 10, left: 10, bottom: 10 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
              <XAxis
                dataKey="month"
                tick={{ fill: '#4A4A4A', fontSize: 12 }}
                axisLine={{ stroke: '#E5E5E5' }}
              />
              <YAxis
                tick={{ fill: '#4A4A4A', fontSize: 12 }}
                axisLine={{ stroke: '#E5E5E5' }}
                tickFormatter={(value) => `${value}x`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  border: '1px solid #E5E5E5',
                  borderRadius: '8px'
                }}
                formatter={(value) => [`${value || 0}x`, 'ROAS']}
              />
              <Legend />
              <Line type="monotone" dataKey="email" stroke="#FF6B35" strokeWidth={2} name="Email" dot={{ r: 4 }} />
              <Line type="monotone" dataKey="google" stroke="#3B82F6" strokeWidth={2} name="Google" dot={{ r: 4 }} />
              <Line type="monotone" dataKey="meta" stroke="#8B5CF6" strokeWidth={2} name="Meta" dot={{ r: 4 }} />
              <Line type="monotone" dataKey="remarketing" stroke="#22C55E" strokeWidth={2} name="Remarketing" dot={{ r: 4 }} />
              <Line type="monotone" dataKey="sms" stroke="#F59E0B" strokeWidth={2} name="SMS" dot={{ r: 4 }} />
            </LineChart>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-[#4A4A4A]">Δεν υπάρχουν δεδομένα performance history</p>
            </div>
          )}
        </div>
      </Card>

      {/* Real Campaigns List */}
      {hasCampaigns && campaigns.length > 0 && (
        <Card padding="lg">
          <CardHeader
            title="Active Campaigns"
            subtitle={`${campaigns.length} ${campaigns.length === 1 ? 'campaign' : 'campaigns'} imported`}
            icon={<TrendingUp size={20} className="text-[#FF6B35]" />}
            action={
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => onSectionChange?.('campaigns')}
              >
                View All
              </Button>
            }
          />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
            {(campaigns as Campaign[]).slice(0, 6).map((campaign) => (
              <motion.div
                key={campaign.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 border border-[#E5E5E5] rounded-xl hover:border-[#FF6B35] transition-all"
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-medium text-[#1A1A1A] text-sm truncate flex-1">{campaign.name}</h4>
                  <Badge variant={campaign.status === 'active' || campaign.status === 'enabled' ? 'success' : 'default'} size="sm">
                    {campaign.status || 'Active'}
                  </Badge>
                </div>
                <p className="text-xs text-[#4A4A4A] mb-3">{campaign.channel}</p>
                <div className="space-y-1 text-xs">
                  {campaign.amount_spent && (
                    <div className="flex justify-between">
                      <span className="text-[#4A4A4A]">Spent:</span>
                      <span className="font-mono font-medium">€{campaign.amount_spent.toLocaleString()}</span>
                    </div>
                  )}
                  {campaign.roas && (
                    <div className="flex justify-between">
                      <span className="text-[#4A4A4A]">ROAS:</span>
                      <span className="font-mono font-medium text-[#22C55E]">{campaign.roas.toFixed(2)}x</span>
                    </div>
                  )}
                  {campaign.conversions && (
                    <div className="flex justify-between">
                      <span className="text-[#4A4A4A]">Conversions:</span>
                      <span className="font-mono font-medium">{campaign.conversions.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
          {campaigns.length > 6 && (
            <p className="text-sm text-[#4A4A4A] mt-4 text-center">
              και {campaigns.length - 6} ακόμα campaigns...
            </p>
          )}
        </Card>
      )}

      {/* Feed Preview */}
      <Card padding="lg">
        <CardHeader
          title="Feed Generation"
          subtitle="Preview and export product feeds"
          icon={<Settings size={20} className="text-[#FF6B35]" />}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {['Google Shopping', 'Meta Catalog', 'Email Feed', 'Display Feed'].map((feed, index) => (
            <motion.div
              key={feed}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className="p-4 border border-[#E5E5E5] rounded-xl hover:border-[#FF6B35] hover:shadow-md transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-[#1A1A1A]">{feed}</h4>
                <Badge variant="success" size="sm">Ενεργό</Badge>
              </div>
              <div className="space-y-2 text-sm text-[#4A4A4A]">
                <div className="flex justify-between">
                  <span>Products</span>
                  <span className="font-mono">{productsCount.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last sync</span>
                  <span>πριν 2ω</span>
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <Button variant="ghost" size="sm" icon={<Eye size={14} />} className="flex-1">
                  Preview
                </Button>
                <Button variant="secondary" size="sm" icon={<Download size={14} />} className="flex-1">
                  Export
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      </Card>
    </div>
  );
}
