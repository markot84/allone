import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PieChart as PieChartIcon,
  TrendingUp,
  Download,
  RefreshCw,
  Eye,
  Settings,
  X,
  FileSpreadsheet,
  FileText
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend
} from 'recharts';
import { Card, CardHeader, Badge, Button, Spinner } from '../common';
import { useToast } from '../common/Toast';
import { useProducts, useCampaigns, useBrand } from '../../hooks';
import { getStockAgeDays } from '../../utils/productUtils';
import { safeBrandName } from '../../services/reportExport';
// Removed mock data imports - using only real data
import type { Campaign } from '../../types';

const COLORS = ['#FF6B35', '#3B82F6', '#22C55E', '#8B5CF6', '#F59E0B'];

interface ChannelActivationProps {
  onSectionChange?: (section: string) => void;
}

export function ChannelActivation({ onSectionChange }: ChannelActivationProps = {}) {
  const { currentBrand } = useBrand();
  const { products, count: productsCount } = useProducts();
  const { campaigns, isLoading: campaignsLoading, hasImported: hasCampaigns } = useCampaigns();
  const toast = useToast();
  const [selectedScenario, setSelectedScenario] = useState('profit_max');
  const [budgetMultiplier, setBudgetMultiplier] = useState(1);
  const historyChartRef = useRef<HTMLDivElement>(null);
  const [historyChartSize, setHistoryChartSize] = useState({ width: 800, height: 288 });
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedFeed, setSelectedFeed] = useState<string | null>(null);
  const [showExportAllModal, setShowExportAllModal] = useState(false);

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
      // For debugging: track if campaigns have pre-calculated ROAS
      hasPreCalculatedROAS: boolean;
      sampleCampaigns: Array<{ name: string; amount_spent: number; conversion_value: number; roas?: number }>;
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
          hasPreCalculatedROAS: false,
          sampleCampaigns: [],
        };
      }

      const stats = channelStats[channel];
      stats.totalSpent += campaign.amount_spent || 0;
      stats.totalConversions += campaign.conversions || 0;
      stats.totalConversionValue += campaign.conversion_value || 0;
      stats.totalImpressions += campaign.impressions || 0;
      stats.totalClicks += campaign.clicks || 0;
      stats.campaignCount += 1;
      
      // Track if campaign has pre-calculated ROAS
      if (campaign.roas && campaign.roas > 0) {
        stats.hasPreCalculatedROAS = true;
      }
      
      // Store sample campaigns for debugging (first 2 per channel)
      if (stats.sampleCampaigns.length < 2) {
        stats.sampleCampaigns.push({
          name: campaign.name,
          amount_spent: campaign.amount_spent || 0,
          conversion_value: campaign.conversion_value || 0,
          roas: campaign.roas,
        });
      }
    });

    // Debug logging in development
    if (import.meta.env.MODE === 'development') {
      console.debug('[ChannelActivation] Channel Performance Calculation:', {
        totalCampaigns: campaigns.length,
        channelBreakdown: Object.entries(channelStats).map(([channel, stats]) => ({
          channel,
          totalSpent: stats.totalSpent,
          totalConversionValue: stats.totalConversionValue,
          totalConversions: stats.totalConversions,
          totalImpressions: stats.totalImpressions,
          totalClicks: stats.totalClicks,
          campaignCount: stats.campaignCount,
          hasPreCalculatedROAS: stats.hasPreCalculatedROAS,
          calculatedROAS: stats.totalSpent > 0 ? stats.totalConversionValue / stats.totalSpent : 0,
          sampleCampaigns: stats.sampleCampaigns,
        })),
        sampleCampaignsByChannel: Object.entries(channelStats).map(([channel]) => ({
          channel,
          sampleCampaigns: (campaigns as Campaign[]).filter(c => (c.channel || 'Other') === channel).slice(0, 3).map(c => ({
            name: c.name,
            amount_spent: c.amount_spent,
            conversion_value: c.conversion_value,
            roas: c.roas,
            period: c.period,
          })),
        })),
      });
    }

    // Calculate ROAS for each channel
    // If campaigns have pre-calculated ROAS, we can use weighted average
    // Otherwise, calculate from total conversion_value / total spent
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
      // Calculate ROAS: prefer pre-calculated if available, otherwise calculate from totals
      let roas = 0;
      if (stats.hasPreCalculatedROAS && stats.totalSpent > 0) {
        // Weighted average ROAS based on spend
        const campaignsWithROAS = (campaigns as Campaign[]).filter(
          c => (c.channel || 'Other') === channel && c.roas && c.roas > 0 && c.amount_spent && c.amount_spent > 0
        );
        if (campaignsWithROAS.length > 0) {
          const weightedROAS = campaignsWithROAS.reduce((sum, c) => {
            return sum + ((c.roas || 0) * (c.amount_spent || 0));
          }, 0) / stats.totalSpent;
          roas = weightedROAS;
        } else {
          // Fallback to calculated ROAS
          roas = stats.totalSpent > 0 ? stats.totalConversionValue / stats.totalSpent : 0;
        }
      } else {
        // Calculate ROAS from totals
        roas = stats.totalSpent > 0 ? stats.totalConversionValue / stats.totalSpent : 0;
      }
      
      // CTR: use pre-calculated if available, otherwise calculate from totals
      let ctr = 0;
      const campaignsWithCTR = (campaigns as Campaign[]).filter(
        c => (c.channel || 'Other') === channel && c.ctr && c.ctr > 0
      );
      if (campaignsWithCTR.length > 0 && stats.totalImpressions > 0) {
        // Weighted average CTR based on impressions
        const weightedCTR = campaignsWithCTR.reduce((sum, c) => {
          return sum + ((c.ctr || 0) * (c.impressions || 0));
        }, 0) / stats.totalImpressions;
        ctr = weightedCTR;
      } else {
        // Calculate CTR from totals
        ctr = stats.totalImpressions > 0 ? (stats.totalClicks / stats.totalImpressions) * 100 : 0;
      }
      
      // CPC: use pre-calculated if available, otherwise calculate from totals
      let cpc = 0;
      const campaignsWithCPC = (campaigns as Campaign[]).filter(
        c => (c.channel || 'Other') === channel && c.cpc && c.cpc > 0 && c.clicks && c.clicks > 0
      );
      if (campaignsWithCPC.length > 0 && stats.totalClicks > 0) {
        // Weighted average CPC based on clicks
        const weightedCPC = campaignsWithCPC.reduce((sum, c) => {
          return sum + ((c.cpc || 0) * (c.clicks || 0));
        }, 0) / stats.totalClicks;
        cpc = weightedCPC;
      } else {
        // Calculate CPC from totals
        cpc = stats.totalClicks > 0 ? stats.totalSpent / stats.totalClicks : 0;
      }

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

    const sorted = channelPerformance.sort((a, b) => b.spent - a.spent);
    
    // Debug logging for final results
    if (import.meta.env.MODE === 'development') {
      console.debug('[ChannelActivation] Final Channel Performance:', sorted);
    }
    
    return sorted;
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
    // Use only real data - no mock fallback
    if (realChannelMix) {
      return realChannelMix;
    }
    // Return empty mix when no real data
    return {
      google_ads: 0,
      meta_ads: 0,
      email: 0,
      sms: 0,
      other: 0,
      total_budget: 0,
      allocation: []
    };
  }, [realChannelMix]);

  const weightedROAS = useMemo(() => {
    if (!channelMix.allocation || channelMix.allocation.length === 0) return '0.0';
    const total = channelMix.allocation.reduce((sum, ch) => sum + ch.budget, 0);
    if (total === 0) return '0.0';
    return channelMix.allocation.reduce(
      (sum, ch) => sum + (ch.expected_roas * ch.budget / total),
      0
    ).toFixed(1);
  }, [channelMix]);

  // Export functions for different feed types
  const exportFeed = async (feedType: string, format: 'csv' | 'xlsx') => {
    if (products.length === 0) {
      toast.error('Δεν υπάρχουν προϊόντα για export');
      return;
    }

    // Format products based on feed type
    let headers: string[] = [];
    let rows: any[][] = [];

    switch (feedType) {
      case 'Google Shopping':
        headers = ['id', 'title', 'description', 'link', 'image_link', 'price', 'availability', 'brand', 'condition', 'google_product_category'];
        rows = products.map(p => [
          p.sku || p.id,
          p.name || '',
          `${p.name || ''} - ${p.category || ''}`,
          `https://yoursite.com/products/${p.sku || p.id}`,
          '', // image_link - would need image URL
          `${(p.price || 0).toFixed(2)} EUR`,
          (p.stock_level || 0) > 0 ? 'in stock' : 'out of stock',
          '', // brand - would need brand field
          'new',
          p.category || ''
        ]);
        break;
      case 'Meta Catalog':
        headers = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];
        rows = products.map(p => [
          p.sku || p.id,
          p.name || '',
          `${p.name || ''} - ${p.category || ''}`,
          (p.stock_level || 0) > 0 ? 'in stock' : 'out of stock',
          'new',
          `${(p.price || 0).toFixed(2)} EUR`,
          `https://yoursite.com/products/${p.sku || p.id}`,
          '', // image_link
          '' // brand
        ]);
        break;
      case 'Email Feed':
      case 'Display Feed':
      default:
        headers = ['SKU', 'Name', 'Category', 'Price', 'Margin %', 'Stock Level', 'Stock Capacity', 'Stock Age Days', 'Priority Tag'];
        rows = products.map(p => [
          p.sku || '',
          p.name || '',
          p.category || '',
          (p.price || 0).toFixed(2),
          (p.margin_percentage || 0).toFixed(1),
          p.stock_level || 0,
          p.stock_capacity || 0,
          getStockAgeDays(p),
          p.priority_tag || ''
        ]);
        break;
    }

    const brand = safeBrandName(currentBrand?.name);
    const date = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
      const csvContent = [
        ['Brand', currentBrand?.name || '—'].join(','),
        ['Generated', date].join(','),
        ['Feed Type', feedType].join(','),
        '',
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      ].join('\n');

      const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${brand}_${feedType.toLowerCase().replace(/\s+/g, '_')}_export_${date}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else if (format === 'xlsx') {
      try {
        const XLSX = await import('xlsx');
        const metaRows = [['Brand', currentBrand?.name || '—'], ['Generated', date], ['Feed Type', feedType], [''], headers];
        const ws = XLSX.utils.aoa_to_sheet([...metaRows, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Products');
        XLSX.writeFile(wb, `${brand}_${feedType.toLowerCase().replace(/\s+/g, '_')}_export_${date}.xlsx`);
      } catch (error) {
        console.error('Excel export error:', error);
        alert('Σφάλμα κατά την εξαγωγή Excel. Δοκιμάστε CSV.');
      }
    }
  };

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
          <Button 
            variant="secondary" 
            icon={<RefreshCw size={16} />}
            onClick={() => {
              alert('Feed sync functionality coming soon!');
            }}
          >
            Sync Feeds
          </Button>
          <Button 
            variant="primary" 
            icon={<Download size={16} />}
            onClick={() => {
              setShowExportAllModal(true);
            }}
          >
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
                <option value="profit_max">Profit Maximization</option>
                <option value="stock_clearance">Stock Clearance</option>
                <option value="revenue_growth">Revenue Growth</option>
                <option value="brand_positioning">Brand Positioning</option>
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
              <div 
                className="w-full flex items-center justify-center"
                style={{ width: '100%', height: '256px', minHeight: '256px', position: 'relative' }}
              >
                <PieChart width={300} height={256}>
                  <Pie
                    data={channelMix.allocation}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={85}
                    paddingAngle={2}
                    dataKey="percentage"
                    nameKey="channel"
                    labelLine={false}
                  >
                    {channelMix.allocation.map((channel, index) => (
                      <Cell key={channel.channel || index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #E5E5E5',
                      borderRadius: '8px',
                      padding: '8px 12px'
                    }}
                    formatter={(value: number | string | undefined, name: string | undefined) => [
                      `${typeof value === 'number' ? value.toFixed(1) : value || '0'}%`,
                      name || 'Channel'
                    ]}
                    labelFormatter={(label) => `Channel: ${label || 'Unknown'}`}
                  />
                </PieChart>
              </div>
              <div className="space-y-2 mt-4">
                {channelMix.allocation.map((channel, index) => (
                  <div key={channel.channel || index} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                      />
                      <span className="text-[#4A4A4A] truncate max-w-[120px]">{channel.channel || 'Unknown'}</span>
                    </div>
                    <span className="font-mono text-[#1A1A1A]">
                      €{channel.budget?.toLocaleString() || '0'} ({channel.percentage?.toFixed(1) || '0'}%)
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
          {realPerformanceHistory && realPerformanceHistory.length > 0 ? (
            <LineChart
              width={historyChartSize.width}
              height={historyChartSize.height}
              data={realPerformanceHistory}
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
                <Button 
                  variant="ghost" 
                  size="sm" 
                  icon={<Eye size={14} />} 
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    alert(`Preview για ${feed}:\n${productsCount.toLocaleString()} products\n\nΘα εμφανιστεί preview modal σύντομα.`);
                  }}
                >
                  Preview
                </Button>
                <Button 
                  variant="secondary" 
                  size="sm" 
                  icon={<Download size={14} />} 
                  className="flex-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFeed(feed);
                    setShowExportModal(true);
                  }}
                >
                  Export
                </Button>
              </div>
            </motion.div>
          ))}
        </div>
      </Card>

      {/* Export Format Modal */}
      <AnimatePresence>
        {showExportModal && selectedFeed && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => {
              setShowExportModal(false);
              setSelectedFeed(null);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-6 border-b border-[#E5E5E5] flex items-center justify-between">
                <h2 className="text-xl font-bold text-[#1A1A1A]">Επιλογή Format</h2>
                <button
                  onClick={() => {
                    setShowExportModal(false);
                    setSelectedFeed(null);
                  }}
                  className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
                >
                  <X size={20} className="text-[#4A4A4A]" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-3">
                <p className="text-sm text-[#4A4A4A] mb-4">
                  Επιλέξτε format για <strong>{selectedFeed}</strong>
                </p>

                <button
                  onClick={() => {
                    exportFeed(selectedFeed, 'xlsx');
                    setShowExportModal(false);
                    setSelectedFeed(null);
                  }}
                  className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[#FF6B35] hover:bg-[#FFF0EB] transition-all text-left flex items-center gap-4 group"
                >
                  <div className="p-3 bg-[#22C55E]/10 rounded-lg group-hover:bg-[#22C55E]/20 transition-colors">
                    <FileSpreadsheet size={24} className="text-[#22C55E]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-[#1A1A1A]">Excel (.xlsx)</h3>
                    <p className="text-xs text-[#4A4A4A]">Download as Excel file</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    exportFeed(selectedFeed, 'csv');
                    setShowExportModal(false);
                    setSelectedFeed(null);
                  }}
                  className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[#FF6B35] hover:bg-[#FFF0EB] transition-all text-left flex items-center gap-4 group"
                >
                  <div className="p-3 bg-[#3B82F6]/10 rounded-lg group-hover:bg-[#3B82F6]/20 transition-colors">
                    <FileText size={24} className="text-[#3B82F6]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-[#1A1A1A]">CSV (.csv)</h3>
                    <p className="text-xs text-[#4A4A4A]">Download as CSV file</p>
                  </div>
                </button>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-[#E5E5E5] flex justify-end">
                <Button 
                  variant="ghost" 
                  onClick={() => {
                    setShowExportModal(false);
                    setSelectedFeed(null);
                  }}
                >
                  Ακύρωση
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Export All Format Modal */}
      <AnimatePresence>
        {showExportAllModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={() => {
              setShowExportAllModal(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="p-6 border-b border-[#E5E5E5] flex items-center justify-between">
                <h2 className="text-xl font-bold text-[#1A1A1A]">Export All Feeds</h2>
                <button
                  onClick={() => {
                    setShowExportAllModal(false);
                  }}
                  className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
                >
                  <X size={20} className="text-[#4A4A4A]" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-3">
                <p className="text-sm text-[#4A4A4A] mb-4">
                  Επιλέξτε format για όλα τα feeds (Google Shopping, Meta Catalog, Email Feed, Display Feed)
                </p>

                <button
                  onClick={() => {
                    ['Google Shopping', 'Meta Catalog', 'Email Feed', 'Display Feed'].forEach((feed, index) => {
                      setTimeout(() => {
                        exportFeed(feed, 'xlsx');
                      }, index * 500); // Stagger exports to avoid browser blocking
                    });
                    setShowExportAllModal(false);
                    toast.success('Export όλων των feeds ξεκίνησε');
                  }}
                  className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[#FF6B35] hover:bg-[#FFF0EB] transition-all text-left flex items-center gap-4 group"
                >
                  <div className="p-3 bg-[#22C55E]/10 rounded-lg group-hover:bg-[#22C55E]/20 transition-colors">
                    <FileSpreadsheet size={24} className="text-[#22C55E]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-[#1A1A1A]">Excel (.xlsx)</h3>
                    <p className="text-xs text-[#4A4A4A]">Export όλα τα feeds ως Excel files</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    ['Google Shopping', 'Meta Catalog', 'Email Feed', 'Display Feed'].forEach((feed, index) => {
                      setTimeout(() => {
                        exportFeed(feed, 'csv');
                      }, index * 500); // Stagger exports to avoid browser blocking
                    });
                    setShowExportAllModal(false);
                    toast.success('Export όλων των feeds ξεκίνησε');
                  }}
                  className="w-full p-4 border-2 border-[#E5E5E5] rounded-xl hover:border-[#FF6B35] hover:bg-[#FFF0EB] transition-all text-left flex items-center gap-4 group"
                >
                  <div className="p-3 bg-[#3B82F6]/10 rounded-lg group-hover:bg-[#3B82F6]/20 transition-colors">
                    <FileText size={24} className="text-[#3B82F6]" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-[#1A1A1A]">CSV (.csv)</h3>
                    <p className="text-xs text-[#4A4A4A]">Export όλα τα feeds ως CSV files</p>
                  </div>
                </button>
              </div>

              {/* Footer */}
              <div className="p-6 border-t border-[#E5E5E5] flex justify-end">
                <Button 
                  variant="ghost" 
                  onClick={() => {
                    setShowExportAllModal(false);
                  }}
                >
                  Ακύρωση
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
