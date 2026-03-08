import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Zap, Calendar } from 'lucide-react';
import { getActiveSeasons, type SeasonalPeriod } from '../../data/seasonalPeriods';
import { scenarios } from '../../data';

interface SeasonalBannerProps {
  currentScenarioId: string | null;
  currentMixConfig?: { scenarioA: string; scenarioB: string; percentA: number } | null;
  onApplySeason: (period: SeasonalPeriod) => void;
  onManageSeasons: () => void;
}

export function SeasonalBanner({
  currentScenarioId,
  currentMixConfig,
  onApplySeason,
  onManageSeasons,
}: SeasonalBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const activeSeasons = useMemo(() => getActiveSeasons(), []);

  const visibleSeasons = useMemo(() => {
    return activeSeasons.filter(season => {
      if (dismissed.has(season.id)) return false;
      if (
        currentScenarioId === 'mixed' &&
        currentMixConfig &&
        currentMixConfig.scenarioA === season.suggestedMix.scenarioA &&
        currentMixConfig.scenarioB === season.suggestedMix.scenarioB &&
        Math.abs(currentMixConfig.percentA - season.suggestedMix.percentA) <= 5
      ) {
        return false;
      }
      return true;
    });
  }, [activeSeasons, dismissed, currentScenarioId, currentMixConfig]);

  if (visibleSeasons.length === 0) return null;

  const season = visibleSeasons[0];
  const nameA = scenarios.find(s => s.id === season.suggestedMix.scenarioA)?.name ?? season.suggestedMix.scenarioA;
  const nameB = scenarios.find(s => s.id === season.suggestedMix.scenarioB)?.name ?? season.suggestedMix.scenarioB;
  const pctA = season.suggestedMix.percentA;
  const pctB = 100 - pctA;

  return (
    <AnimatePresence>
      <motion.div
        key={season.id}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="relative rounded-xl border border-[var(--nts-accent)]/30 bg-gradient-to-r from-[var(--nts-accent)]/5 to-transparent p-4"
      >
        <div className="flex items-start gap-3">
          <span className="text-xl flex-shrink-0 mt-0.5">{season.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-sm font-semibold text-[#1A1A1A]">{season.name}</h4>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--nts-accent)]/10 text-[var(--nts-accent)] font-medium">
                Εποχιακή πρόταση
              </span>
            </div>
            <p className="text-xs text-[#4A4A4A] mb-2 leading-relaxed">{season.description}</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-[#9CA3AF]">
                Προτεινόμενη: {nameA} {pctA}% / {nameB} {pctB}%
              </span>
              <button
                onClick={() => onApplySeason(season)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--nts-accent)] text-white hover:opacity-90 transition-opacity"
              >
                <Zap size={12} />
                Εφαρμογή
              </button>
              <button
                onClick={onManageSeasons}
                className="flex items-center gap-1 text-[11px] text-[#9CA3AF] hover:text-[var(--nts-accent)] transition-colors"
              >
                <Calendar size={11} />
                Διαχείριση περιόδων
              </button>
            </div>
          </div>
          <button
            onClick={() => setDismissed(prev => new Set(prev).add(season.id))}
            className="p-1 rounded hover:bg-[#F5F5F5] text-[#9CA3AF] hover:text-[#4A4A4A] transition-colors flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
