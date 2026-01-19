import { motion } from 'framer-motion';
import { Zap, Target, DollarSign } from 'lucide-react';
import { Badge } from '../common';
import type { ChannelRecommendation, RFMSegment } from '../../types';

interface ChannelRecommendationsProps {
  recommendations: ChannelRecommendation;
  segment: RFMSegment;
}

export function ChannelRecommendations({
  recommendations,
  segment
}: ChannelRecommendationsProps) {
  if (!recommendations) {
    return (
      <div className="p-8 text-center text-[#4A4A4A]">
        <p>No recommendations available for this segment.</p>
      </div>
    );
  }

  // const totalBudget = Object.values(recommendations.budget_allocation).reduce(
  //   (a, b) => a + b,
  //   0
  // );

  return (
    <div className="space-y-6">
      {/* Segment Info */}
      <div className="flex items-center gap-4 p-4 rounded-lg" style={{ backgroundColor: `${segment.color}15` }}>
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
          style={{ backgroundColor: `${segment.color}25` }}
        >
          {/* no emoji icons in enterprise UI */}
        </div>
        <div className="flex-1">
          <h4 className="font-semibold text-[#1A1A1A]">{segment.name} Segment</h4>
          <p className="text-sm text-[#4A4A4A]">{segment.description}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-[#4A4A4A]">Customers</p>
          <p className="text-lg font-bold text-[#1A1A1A] font-mono">
            {segment.count.toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm text-[#4A4A4A]">Revenue Share</p>
          <p className="text-lg font-bold font-mono" style={{ color: segment.color }}>
            {segment.revenue_share}%
          </p>
        </div>
      </div>

      {/* Channel Mix */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Primary Channels */}
        <div>
          <h5 className="text-sm font-medium text-[#1A1A1A] mb-3 flex items-center gap-2">
            <Zap size={16} className="text-[#FF6B35]" />
            Primary Channels
          </h5>
          <div className="space-y-2">
            {recommendations.primary.map((channel, index) => (
              <motion.div
                key={channel}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className="flex items-center justify-between p-3 bg-[#FFF0EB] rounded-lg border border-[#FF6B35]/20"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-[#FF6B35] rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">
                      {index + 1}
                    </span>
                  </div>
                  <span className="font-medium text-[#1A1A1A]">{channel}</span>
                </div>
                <Badge variant="orange">
                  {recommendations.budget_allocation[channel.toLowerCase().split(' ')[0]] || 30}%
                </Badge>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Secondary Channels */}
        <div>
          <h5 className="text-sm font-medium text-[#1A1A1A] mb-3 flex items-center gap-2">
            <Target size={16} className="text-[#4A4A4A]" />
            Secondary Channels
          </h5>
          <div className="space-y-2">
            {recommendations.secondary.map((channel, index) => (
              <motion.div
                key={channel}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + index * 0.1 }}
                className="flex items-center justify-between p-3 bg-[#F5F5F5] rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-[#4A4A4A] rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm">
                      {recommendations.primary.length + index + 1}
                    </span>
                  </div>
                  <span className="text-[#1A1A1A]">{channel}</span>
                </div>
                <Badge variant="default">
                  {recommendations.budget_allocation[channel.toLowerCase().split(' ')[0]] || 20}%
                </Badge>
              </motion.div>
            ))}
          </div>
        </div>
      </div>

      {/* Rationale */}
      <div className="p-4 bg-gradient-to-r from-[#F5F5F5] to-white rounded-lg border border-[#E5E5E5]">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-[#3B82F6]/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <DollarSign size={16} className="text-[#3B82F6]" />
          </div>
          <div>
            <h5 className="font-medium text-[#1A1A1A] text-sm">AI Rationale</h5>
            <p className="text-sm text-[#4A4A4A] mt-1">{recommendations.rationale}</p>
          </div>
        </div>
      </div>

      {/* Budget Allocation Visualization */}
      <div>
        <h5 className="text-sm font-medium text-[#1A1A1A] mb-3">
          Budget Allocation
        </h5>
        <div className="flex h-4 rounded-full overflow-hidden">
          {Object.entries(recommendations.budget_allocation).map(
            ([channel, percentage], index) => {
              const colors = ['#FF6B35', '#3B82F6', '#22C55E', '#8B5CF6', '#F59E0B'];
              return (
                <motion.div
                  key={channel}
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ delay: 0.5 + index * 0.1 }}
                  className="h-full"
                  style={{ backgroundColor: colors[index % colors.length] }}
                  title={`${channel}: ${percentage}%`}
                />
              );
            }
          )}
        </div>
        <div className="flex flex-wrap gap-4 mt-3">
          {Object.entries(recommendations.budget_allocation).map(
            ([channel, percentage], index) => {
              const colors = ['#FF6B35', '#3B82F6', '#22C55E', '#8B5CF6', '#F59E0B'];
              return (
                <div key={channel} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: colors[index % colors.length] }}
                  />
                  <span className="text-xs text-[#4A4A4A] capitalize">
                    {channel}: {percentage}%
                  </span>
                </div>
              );
            }
          )}
        </div>
      </div>
    </div>
  );
}
