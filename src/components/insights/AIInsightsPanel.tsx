import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  X,
  ChevronRight,
  Lightbulb,
  AlertTriangle,
  Target,
  Zap
} from 'lucide-react';
import { useMemo } from 'react';
import { Badge, Button } from '../common';
import { useSegments, useProducts } from '../../hooks';
import { generateInsightsFromData } from '../../services/insights';
import { aiInsights as staticInsights } from '../../data/mockInsights';
import type { AIInsight } from '../../types';

interface AIInsightsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AIInsightsPanel({ isOpen, onClose }: AIInsightsPanelProps) {
  const { segments, hasImported: hasSegments } = useSegments();
  const { products, count: productsCount, hasImported: hasProducts } = useProducts();
  const [filter, setFilter] = useState<'all' | 'opportunity' | 'warning' | 'recommendation'>('all');

  const aiInsights = useMemo(() => {
    const dynamic = generateInsightsFromData(products, segments);
    if (dynamic.length > 0) return dynamic;
    return staticInsights;
  }, [products, segments]);

  const filteredInsights = aiInsights.filter(
    insight => filter === 'all' || insight.type === filter
  );

  const countByType = {
    all: aiInsights.length,
    opportunity: aiInsights.filter(i => i.type === 'opportunity').length,
    warning: aiInsights.filter(i => i.type === 'warning').length,
    recommendation: aiInsights.filter(i => i.type === 'recommendation').length
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/20 z-40"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed right-0 top-0 h-screen w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
          >
            {/* Header */}
            <div className="p-5 border-b border-[var(--nts-border-gray)]">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-md border border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)] flex items-center justify-center">
                    <Sparkles size={18} className="text-[var(--nts-medium-gray)]" />
                  </div>
                  <div>
                    <h2 className="font-bold text-[var(--nts-charcoal)] text-[15px]">AI Insights</h2>
                    <p className="text-[13px] text-[var(--nts-medium-gray)]">
                      {aiInsights.length} actionable insights
                      {(hasSegments || hasProducts) && (
                        <span className="text-[11px] text-[var(--nts-medium-gray)] block mt-0.5">
                          · {segments.length} segments · {productsCount} products
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 rounded-md hover:bg-[var(--nts-light-gray)] transition-colors"
                >
                  <X size={18} className="text-[var(--nts-medium-gray)]" />
                </button>
              </div>

              {/* Filters */}
              <div className="flex gap-2 mt-4">
                {(['all', 'opportunity', 'warning', 'recommendation'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFilter(type)}
                    className={`
                      px-3 py-1.5 rounded-full text-xs font-medium transition-colors border
                      ${filter === type
                        ? 'bg-white text-[var(--nts-charcoal)] border-[var(--nts-border-gray)]'
                        : 'bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)] border-[var(--nts-border-gray)] hover:bg-white'}
                    `}
                  >
                    {type.charAt(0).toUpperCase() + type.slice(1)} ({countByType[type]})
                  </button>
                ))}
              </div>
            </div>

            {/* Insights List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {filteredInsights.map((insight, index) => (
                <InsightCard key={index} insight={insight} index={index} />
              ))}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-[var(--nts-border-gray)]">
              <Button variant="primary" className="w-full" icon={<Zap size={16} />}>
                Apply All Recommendations
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

interface InsightCardProps {
  insight: AIInsight;
  index: number;
}

const INSIGHT_CONFIG: Record<string, { bgColor: string; borderColor: string; iconColor: string; icon: React.ReactElement }> = {
  opportunity: {
    bgColor: 'var(--nts-light-gray)',
    borderColor: 'var(--nts-border-gray)',
    iconColor: 'var(--nts-medium-gray)',
    icon: <Lightbulb size={18} />
  },
  warning: {
    bgColor: 'var(--nts-light-gray)',
    borderColor: 'var(--nts-border-gray)',
    iconColor: 'var(--nts-medium-gray)',
    icon: <AlertTriangle size={18} />
  },
  recommendation: {
    bgColor: 'var(--nts-light-gray)',
    borderColor: 'var(--nts-border-gray)',
    iconColor: 'var(--nts-medium-gray)',
    icon: <Target size={18} />
  }
};

function InsightCard({ insight, index }: InsightCardProps) {
  const config = INSIGHT_CONFIG[insight.type] ?? INSIGHT_CONFIG.recommendation;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="p-4 rounded-md border"
      style={{
        backgroundColor: config.bgColor,
        borderColor: config.borderColor
      }}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-md border border-[var(--nts-border-gray)] bg-white flex items-center justify-center flex-shrink-0">
          <span style={{ color: config.iconColor }}>{config.icon}</span>
        </div>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-medium text-[var(--nts-charcoal)] text-sm">{insight.title}</h4>
            <Badge
              variant={insight.impact === 'high' ? 'danger' : insight.impact === 'medium' ? 'warning' : 'default'}
              size="sm"
            >
              {insight.impact}
            </Badge>
          </div>
          <p className="text-xs text-[var(--nts-medium-gray)] mt-1">{insight.insight}</p>
          <button
            className="mt-3 flex items-center gap-1 text-xs font-medium hover:underline"
            style={{ color: config.borderColor }}
          >
            {insight.action}
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// Floating Trigger Button
export function AIInsightsTrigger({ onClick, insightCount }: { onClick: () => void; insightCount: number }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="fixed bottom-6 right-6 w-12 h-12 bg-white rounded-full border border-[var(--nts-border-gray)] shadow-sm flex items-center justify-center z-30"
    >
      <Sparkles size={20} className="text-[var(--nts-medium-gray)]" />
      {insightCount > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-[#cf222e] rounded-full text-white text-xs font-bold flex items-center justify-center">
          {insightCount}
        </span>
      )}
    </motion.button>
  );
}

/** Wrapper that computes dynamic insight count from products/segments */
export function AIInsightsTriggerWrapper({ onClick }: { onClick: () => void }) {
  const { products } = useProducts();
  const { segments } = useSegments();
  const insightCount = useMemo(() => {
    const insights = generateInsightsFromData(products, segments);
    return insights.filter((i) => i.impact === 'high').length;
  }, [products, segments]);
  return <AIInsightsTrigger onClick={onClick} insightCount={insightCount} />;
}
