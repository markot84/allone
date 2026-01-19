import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  ArrowRight,
  Zap
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { Card, CardHeader, Badge, Button } from '../common';
import { rfmSegments, segmentCategoryMatrix, segmentMigration, totalCustomers } from '../../data';
import type { RFMSegment } from '../../types';

export function RFMAnalysis() {
  const [selectedSegment, setSelectedSegment] = useState<RFMSegment | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-[#1A1A1A]">RFM Analysis</h2>
        <p className="text-[#4A4A4A] mt-1">
          Analyze customer segments based on Recency, Frequency, and Monetary value
        </p>
      </div>

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#FFF0EB] rounded-lg flex items-center justify-center">
              <Users size={20} className="text-[#FF6B35]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]">Total Customers</p>
              <p className="text-xl font-bold text-[#1A1A1A] font-mono">
                {totalCustomers.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#DCFCE7] rounded-lg flex items-center justify-center">
              <TrendingUp size={20} className="text-[#22C55E]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]">Active Segments</p>
              <p className="text-xl font-bold text-[#1A1A1A]">
                {rfmSegments.filter(s => s.id !== 'lost').length}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#DBEAFE] rounded-lg flex items-center justify-center">
              <Zap size={20} className="text-[#3B82F6]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]">Avg Segment Score</p>
              <p className="text-xl font-bold text-[#1A1A1A] font-mono">78.4</p>
            </div>
          </div>
        </Card>
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#FEF3C7] rounded-lg flex items-center justify-center">
              <TrendingDown size={20} className="text-[#F59E0B]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]">At Risk Rate</p>
              <p className="text-xl font-bold text-[#F59E0B] font-mono">
                {rfmSegments.find(s => s.id === 'at_risk')?.percentage}%
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Segment Cards + Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Segment Cards */}
        <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
          {rfmSegments.map((segment, index) => (
            <SegmentCard
              key={segment.id}
              segment={segment}
              index={index}
              isSelected={selectedSegment?.id === segment.id}
              onSelect={() => setSelectedSegment(
                selectedSegment?.id === segment.id ? null : segment
              )}
            />
          ))}
        </div>

        {/* Distribution Chart */}
        <Card padding="lg">
          <CardHeader
            title="Revenue Distribution"
            subtitle="By segment"
          />
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rfmSegments as any}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="revenue_share"
                >
                  {rfmSegments.map((segment) => (
                    <Cell
                      key={segment.id}
                      fill={segment.color}
                      stroke={selectedSegment?.id === segment.id ? '#1A1A1A' : 'none'}
                      strokeWidth={2}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #E5E5E5',
                    borderRadius: '8px'
                  }}
                  formatter={(value) => [`${value || 0}%`, 'Revenue']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-2">
            {rfmSegments.map((segment) => (
              <div
                key={segment.id}
                className={`
                  flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all
                  ${selectedSegment?.id === segment.id ? 'bg-[#F5F5F5]' : 'hover:bg-[#F5F5F5]'}
                `}
                onClick={() => setSelectedSegment(
                  selectedSegment?.id === segment.id ? null : segment
                )}
              >
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: segment.color }}
                  />
                  <span className="text-sm text-[#4A4A4A]">{segment.name}</span>
                </div>
                <span className="text-sm font-medium font-mono" style={{ color: segment.color }}>
                  {segment.revenue_share}%
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Segment Detail Panel */}
      <AnimatePresence>
        {selectedSegment && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <SegmentDetail segment={selectedSegment} onClose={() => setSelectedSegment(null)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Migration Flow */}
      <Card padding="lg">
        <CardHeader
          title="Segment Migration"
          subtitle={segmentMigration.period}
          icon={<ArrowRight size={20} className="text-[#FF6B35]" />}
        />
        <div className="space-y-3">
          {segmentMigration.flows.slice(0, 6).map((flow, index) => {
            const fromSegment = rfmSegments.find(s => s.id === flow.from);
            const toSegment = rfmSegments.find(s => s.id === flow.to);
            const isPositive = ['champions', 'loyal', 'potential'].includes(flow.to) && 
                              ['at_risk', 'lost'].includes(flow.from);
            
            return (
              <motion.div
                key={`${flow.from}-${flow.to}`}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.05 }}
                className="flex items-center gap-4 p-3 bg-[#F5F5F5] rounded-lg"
              >
                <div className="flex items-center gap-2 flex-1">
                  <Badge
                    variant={flow.from === 'lost' ? 'danger' : flow.from === 'at_risk' ? 'warning' : 'default'}
                  >
                    {fromSegment?.icon} {fromSegment?.name}
                  </Badge>
                  <ArrowRight size={16} className="text-[#9CA3AF]" />
                  <Badge
                    variant={flow.to === 'champions' ? 'success' : flow.to === 'loyal' ? 'info' : 'default'}
                  >
                    {toSegment?.icon} {toSegment?.name}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className={`font-bold font-mono ${isPositive ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}>
                    {flow.count.toLocaleString()}
                  </p>
                  <p className="text-xs text-[#4A4A4A]">{flow.percentage}%</p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

interface SegmentCardProps {
  segment: RFMSegment;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}

function SegmentCard({ segment, index, isSelected, onSelect }: SegmentCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card
        padding="md"
        hover
        onClick={onSelect}
        className={isSelected ? 'ring-2 ring-[#FF6B35]' : ''}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
              style={{ backgroundColor: `${segment.color}20` }}
            >
              {/* no emoji icons */}
            </div>
            <div>
              <h3 className="font-semibold text-[#1A1A1A]">{segment.name}</h3>
              <p className="text-xs text-[#4A4A4A]">{segment.rfm_score}</p>
            </div>
          </div>
          <ChevronRight
            size={18}
            className={`text-[#9CA3AF] transition-transform ${isSelected ? 'rotate-90' : ''}`}
          />
        </div>

        <p className="text-sm text-[#4A4A4A] mt-3">{segment.description}</p>

        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#E5E5E5]">
          <div>
            <p className="text-xs text-[#4A4A4A]">Customers</p>
            <p className="font-bold text-[#1A1A1A] font-mono">
              {segment.count.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#4A4A4A]">% of Base</p>
            <p className="font-bold font-mono" style={{ color: segment.color }}>
              {segment.percentage}%
            </p>
          </div>
          <div>
            <p className="text-xs text-[#4A4A4A]">Revenue</p>
            <p className="font-bold text-[#1A1A1A] font-mono">
              {segment.revenue_share}%
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

interface SegmentDetailProps {
  segment: RFMSegment;
  onClose: () => void;
}

function SegmentDetail({ segment, onClose }: SegmentDetailProps) {
  const categoryData = segmentCategoryMatrix[segment.id];

  return (
    <Card padding="lg">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl"
            style={{ backgroundColor: `${segment.color}20` }}
          >
            {/* no emoji icons */}
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#1A1A1A]">{segment.name}</h3>
            <p className="text-[#4A4A4A]">{segment.description}</p>
          </div>
        </div>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Affinity */}
        <div>
          <h4 className="font-medium text-[#1A1A1A] mb-4">Category Preferences</h4>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={categoryData?.categories || []}
                layout="vertical"
                margin={{ left: 100 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                <XAxis
                  type="number"
                  domain={[0, 1]}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}%`}
                  tick={{ fill: '#4A4A4A', fontSize: 12 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: '#4A4A4A', fontSize: 12 }}
                  width={95}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #E5E5E5',
                    borderRadius: '8px'
                  }}
                  formatter={(value) => [`${(((value as number) || 0) * 100).toFixed(0)}%`, 'Affinity']}
                />
                <Bar dataKey="affinity" fill={segment.color} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Segment Details */}
        <div className="space-y-4">
          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Preferred Brands</h5>
            <div className="flex flex-wrap gap-2">
              {categoryData?.brands.map((brand) => (
                <Badge key={brand} variant="default">{brand}</Badge>
              ))}
            </div>
          </div>

          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Price Sensitivity</h5>
            <Badge
              variant={
                categoryData?.price_sensitivity === 'low' ? 'success' :
                categoryData?.price_sensitivity === 'medium' ? 'warning' : 'danger'
              }
              size="md"
            >
              {categoryData?.price_sensitivity?.toUpperCase()}
            </Badge>
          </div>

          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Preferred Channels</h5>
            <div className="flex flex-wrap gap-2">
              {categoryData?.preferred_channels.map((channel) => (
                <Badge key={channel} variant="info">{channel}</Badge>
              ))}
            </div>
          </div>

          <Button variant="primary" className="w-full" icon={<Zap size={16} />}>
            Create Campaign for {segment.name}
          </Button>
        </div>
      </div>
    </Card>
  );
}
