import { useState, useMemo } from 'react';
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
import { Card, CardHeader, Badge, Button } from '../common';
import { channelMixByScenario, channelPerformanceHistory } from '../../data/mockChannels';
import { scenarios } from '../../data/mockScenarios';

const COLORS = ['#FF6B35', '#3B82F6', '#22C55E', '#8B5CF6', '#F59E0B'];

export function ChannelActivation() {
  const [selectedScenario, setSelectedScenario] = useState('profit_max');
  const [budgetMultiplier, setBudgetMultiplier] = useState(1);

  const channelMix = useMemo(() => {
    const mix = channelMixByScenario[selectedScenario] || channelMixByScenario.profit_max;
    return {
      ...mix,
      total_budget: mix.total_budget * budgetMultiplier,
      allocation: mix.allocation.map(a => ({
        ...a,
        budget: a.budget * budgetMultiplier
      }))
    };
  }, [selectedScenario, budgetMultiplier]);

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

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Channel Mix Chart */}
        <Card padding="lg">
          <CardHeader
            title="Channel Mix"
            subtitle="Budget allocation"
            icon={<PieChartIcon size={20} className="text-[#FF6B35]" />}
          />
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
                    <Cell key={index} fill={COLORS[index % COLORS.length]} />
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
        </Card>

        {/* Channel Details */}
        <Card className="lg:col-span-2" padding="lg">
          <CardHeader
            title="Channel Recommendations"
            subtitle="Detailed allocation with expected ROAS"
            action={
              <Badge variant="success" size="md">
                Avg ROAS: {weightedROAS}x
              </Badge>
            }
          />
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
        </Card>
      </div>

      {/* Performance History */}
      <Card padding="lg">
        <CardHeader
          title="Channel Performance History"
          subtitle="ROAS trend over last 6 months"
          icon={<TrendingUp size={20} className="text-[#FF6B35]" />}
        />
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={channelPerformanceHistory}>
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
          </ResponsiveContainer>
        </div>
      </Card>

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
                <Badge variant="success" size="sm">Active</Badge>
              </div>
              <div className="space-y-2 text-sm text-[#4A4A4A]">
                <div className="flex justify-between">
                  <span>Products</span>
                  <span className="font-mono">{(1200 + index * 300).toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span>Last sync</span>
                  <span>2h ago</span>
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
