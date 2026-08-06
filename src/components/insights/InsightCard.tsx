import { motion } from 'framer-motion';
import { ChevronRight, Lightbulb, AlertTriangle, Target } from 'lucide-react';
import { Badge, FormattedProse } from '../common';
import type { AIInsight } from '../../types';

const INSIGHT_CONFIG: Record<
  string,
  { borderAccent: string; bg: string; iconColor: string; icon: React.ReactElement }
> = {
  opportunity: {
    borderAccent: 'border-l-emerald-500',
    bg: 'bg-white',
    iconColor: 'text-emerald-600',
    icon: <Lightbulb size={18} />,
  },
  warning: {
    borderAccent: 'border-l-amber-500',
    bg: 'bg-white',
    iconColor: 'text-amber-600',
    icon: <AlertTriangle size={18} />,
  },
  recommendation: {
    borderAccent: 'border-l-sky-500',
    bg: 'bg-white',
    iconColor: 'text-sky-600',
    icon: <Target size={18} />,
  },
};

interface InsightCardProps {
  insight: AIInsight;
  index: number;
  onAction: () => void;
  canNavigate: boolean;
}

export function InsightCard({ insight, index, onAction, canNavigate }: InsightCardProps) {
  const config = INSIGHT_CONFIG[insight.type] ?? INSIGHT_CONFIG.recommendation;
  const impactLabel =
    insight.impact === 'high' ? 'Υψηλή' : insight.impact === 'medium' ? 'Μεσαία' : 'Χαμηλή';

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`rounded-xl border border-[#E8E8ED] ${config.bg} shadow-sm hover:shadow-md transition-shadow border-l-4 ${config.borderAccent}`}
    >
      <div className="p-5 md:p-6">
        <div className="flex items-start gap-4">
          <div
            className="w-11 h-11 rounded-xl bg-[#F5F5F7] border border-[#E8E8ED] flex items-center justify-center flex-shrink-0"
            aria-hidden
          >
            <span className={config.iconColor}>{config.icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-semibold text-[var(--text-primary)] text-base leading-snug">{insight.title}</h3>
              <Badge
                variant={insight.impact === 'high' ? 'danger' : insight.impact === 'medium' ? 'warning' : 'default'}
                size="sm"
                className="shrink-0"
              >
                {impactLabel}
              </Badge>
            </div>
            <div className="mt-2 text-sm text-[#4A5568] [&_p]:text-sm [&_strong]:font-semibold [&_strong]:text-[var(--text-primary)] leading-relaxed">
              <FormattedProse content={insight.insight} variant="compact" />
            </div>
            <button
              type="button"
              onClick={onAction}
              disabled={!canNavigate}
              className={`mt-4 inline-flex items-center gap-1.5 text-sm font-medium transition-colors ${
                canNavigate
                  ? 'text-[var(--nts-accent-text)] hover:underline cursor-pointer'
                  : 'text-[var(--text-muted)] cursor-not-allowed opacity-60'
              }`}
            >
              {insight.action}
              <ChevronRight size={16} className="shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </motion.article>
  );
}
