import { motion, AnimatePresence } from 'framer-motion';
import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Minus,
  Package,
  FileText,
  Megaphone,
  X,
  ChevronDown,
  Check,
  Clock,
  Infinity
} from 'lucide-react';
import { Button } from '../common';
import { useProductSource } from '../../hooks/useProductSource';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useContent } from '../../hooks/useContent';
import { calculateCompositeScore, type CompositeScoreContext } from '../../utils/compositeScore';
import { scenarios } from '../../data/mockScenarios';
import type { Product } from '../../types';

interface ImpactBaseProps {
  currentWeights: Record<string, number>;
  newWeights: Record<string, number>;
  currentScenarioId?: string;
  newScenarioId?: string;
  currentDuration?: number | 'ongoing';
  newDuration?: number | 'ongoing';
}

/* ───────── Shared Hooks ───────── */

const WEIGHT_KEYS = ['profit', 'stock', 'strategic', 'revenue', 'fit'];
const WEIGHT_COLORS: Record<string, string> = {
  profit: '#22C55E', stock: '#3B82F6', strategic: '#8B5CF6',
  revenue: '#F59E0B', fit: '#F97316',
};
const WEIGHT_LABELS: Record<string, string> = {
  profit: 'Κερδοφορία', stock: 'Απόθεμα', strategic: 'Στρατηγική',
  revenue: 'Τζίρος', fit: 'Ταίριασμα',
};

function truncateName(name: string, max = 30) {
  if (name.length <= max) return name;
  return name.slice(0, max) + '…';
}

function useProductImpacts(
  products: Product[],
  currentWeights: Record<string, number>,
  newWeights: Record<string, number>,
  currentScenarioId?: string,
  newScenarioId?: string,
  impactProductFilter?: (p: Product) => boolean,
  scoreContext?: CompositeScoreContext,
) {
  return useMemo(() => {
    const scoped = impactProductFilter ? products.filter(impactProductFilter) : products;
    if (scoped.length === 0) {
      return { up: 0, down: 0, same: 0, samplesUp: [] as Product[], samplesDown: [] as Product[] };
    }

    const changes = scoped.map((product) => {
      const currentScore = calculateCompositeScore(
        product,
        currentWeights,
        undefined,
        currentScenarioId,
        undefined,
        currentScenarioId === 'price_benchmark' ? scoreContext : undefined,
      );
      const newScore = calculateCompositeScore(
        product,
        newWeights,
        undefined,
        newScenarioId,
        undefined,
        newScenarioId === 'price_benchmark' ? scoreContext : undefined,
      );
      const diff = newScore - currentScore;
      const threshold = Math.max(1, Math.abs(currentScore) * 0.01);
      return { product, diff, change: diff > threshold ? 'up' : diff < -threshold ? 'down' : 'same' as const };
    });

    const up = changes.filter(c => c.change === 'up');
    const down = changes.filter(c => c.change === 'down');
    const same = changes.filter(c => c.change === 'same');

    up.sort((a, b) => b.diff - a.diff);
    down.sort((a, b) => a.diff - b.diff);

    return {
      up: up.length,
      down: down.length,
      same: same.length,
      samplesUp: up.slice(0, 5).map(c => c.product),
      samplesDown: down.slice(0, 5).map(c => c.product),
    };
  }, [products, currentWeights, newWeights, currentScenarioId, newScenarioId, impactProductFilter, scoreContext]);
}

/* ───────── Layer 1: Inline Summary Card ───────── */

interface StrategyImpactSummaryProps extends ImpactBaseProps {
  onConfirm: (selectedDuration: number | 'ongoing') => void;
  onCancel: () => void;
  onDetails: () => void;
  initialDuration: number | 'ongoing';
  /** Περιορισμός προϊόντων στο impact preview (π.χ. Sales Optimization / sales_base scope). */
  impactProductFilter?: (p: Product) => boolean;
  /** Για Price Benchmarking — lookup GMC benchmark ανά SKU. */
  scoreContext?: CompositeScoreContext;
}

export function StrategyImpactSummary({
  currentWeights, newWeights, currentScenarioId, newScenarioId,
  onConfirm, onCancel, onDetails, initialDuration, impactProductFilter, scoreContext,
}: StrategyImpactSummaryProps) {
  const [duration, setDuration] = useState<number | 'ongoing'>(initialDuration);
  const { products } = useProductSource();
  const impacts = useProductImpacts(
    products,
    currentWeights,
    newWeights,
    currentScenarioId,
    newScenarioId,
    impactProductFilter,
    scoreContext,
  );

  const fromName = scenarios.find(s => s.id === currentScenarioId)?.name ?? 'Τρέχουσα';
  const toName = scenarios.find(s => s.id === newScenarioId)?.name ?? 'Νέα';

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-4 pointer-events-none"
    >
      <div className="max-w-3xl mx-auto pointer-events-auto rounded-2xl border border-[#E5E5E5] bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.12)] p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="font-medium text-[#1A1A1A] truncate">{fromName}</span>
            <ArrowRight size={14} className="text-[var(--nts-accent)] flex-shrink-0" />
            <span className="font-medium text-[#1A1A1A] truncate">{toName}</span>
          </div>

          <div className="flex items-center gap-3 text-xs text-[#4A4A4A] flex-wrap">
            {impacts.up > 0 && (
              <span className="flex items-center gap-1 text-[#22C55E] font-medium">
                <ArrowUp size={12} /> {impacts.up} προϊόντα ανεβαίνουν
              </span>
            )}
            {impacts.down > 0 && (
              <span className="flex items-center gap-1 text-[#EF4444] font-medium">
                <ArrowDown size={12} /> {impacts.down} προϊόντα κατεβαίνουν
              </span>
            )}
            {impacts.same > 0 && (
              <span className="flex items-center gap-1 text-[#9CA3AF]">
                <Minus size={12} /> {impacts.same} ίδια προϊόντα
              </span>
            )}
          </div>
        </div>

        {/* Duration selector */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#F5F5F5]">
          <Clock size={13} className="text-[#9CA3AF] flex-shrink-0" />
          <span className="text-xs text-[#9CA3AF] flex-shrink-0">Διάρκεια</span>
          <div className="flex items-center gap-1 flex-wrap">
            {[7, 14, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-all ${
                  duration === d
                    ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)] text-white'
                    : 'border-[#E5E5E5] text-[#4A4A4A] hover:border-[var(--nts-accent)]/50'
                }`}
              >
                {d}ημ
              </button>
            ))}
            <button
              onClick={() => setDuration('ongoing')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-all ${
                duration === 'ongoing'
                  ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)] text-white'
                  : 'border-[#E5E5E5] text-[#4A4A4A] hover:border-[var(--nts-accent)]/50'
              }`}
            >
              <Infinity size={11} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            onClick={onDetails}
            className="px-3 py-1.5 text-xs font-medium text-[#4A4A4A] hover:text-[var(--nts-accent)] transition-colors"
          >
            <ChevronDown size={12} className="inline mr-1" />
            Λεπτομέρειες
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium text-[#9CA3AF] hover:text-[#4A4A4A] transition-colors"
          >
            Ακύρωση
          </button>
          <button
            onClick={() => onConfirm(duration)}
            className="px-4 py-1.5 text-xs font-medium bg-[var(--nts-accent)] text-white rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1.5"
          >
            <Check size={12} />
            Εφαρμογή
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ───────── Layer 2: Compact Detail Modal ───────── */

interface StrategyImpactModalProps extends ImpactBaseProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selectedDuration: number | 'ongoing') => void;
  impactProductFilter?: (p: Product) => boolean;
  scoreContext?: CompositeScoreContext;
}

const formatDuration = (d?: number | 'ongoing') =>
  d === undefined ? '' : d === 'ongoing' ? 'Συνεχής' : `${d} ημ.`;

export function StrategyImpactModal({
  isOpen, onClose, onConfirm,
  currentWeights, newWeights,
  currentScenarioId, newScenarioId,
  currentDuration, newDuration,
  impactProductFilter,
  scoreContext,
}: StrategyImpactModalProps) {
  const { products } = useProductSource();
  const { campaigns } = useCampaigns();
  const { contentItems } = useContent();
  const [showProducts, setShowProducts] = useState(true);

  const fromName = scenarios.find(s => s.id === currentScenarioId)?.name ?? 'Τρέχουσα';
  const toName = scenarios.find(s => s.id === newScenarioId)?.name ?? 'Νέα';

  const impacts = useProductImpacts(
    products,
    currentWeights,
    newWeights,
    currentScenarioId,
    newScenarioId,
    impactProductFilter,
    scoreContext,
  );

  const weightDiffs = useMemo(() => {
    return WEIGHT_KEYS.map(key => ({
      key,
      from: currentWeights[key] ?? 0,
      to: newWeights[key] ?? 0,
      diff: (newWeights[key] ?? 0) - (currentWeights[key] ?? 0),
    })).filter(d => d.diff !== 0);
  }, [currentWeights, newWeights]);

  const hasContent = contentItems.length > 0;
  const hasCampaigns = campaigns.length > 0;

  const contentStats = useMemo(() => {
    if (!hasContent) return null;
    const aligned = contentItems.filter(item =>
      item.strategy_match === newScenarioId || item.is_aligned === true || !item.strategy_match
    ).length;
    const needsReview = contentItems.length - aligned;
    return { aligned, needsReview };
  }, [contentItems, newScenarioId, hasContent]);

  const campaignStats = useMemo(() => {
    if (!hasCampaigns) return null;
    const active = campaigns.filter((c: any) => c.status === 'active' || !c.status).length;
    return { active };
  }, [campaigns, hasCampaigns]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-[#E5E5E5]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[#1A1A1A]">Αλλαγή στρατηγικής</h2>
            <button onClick={onClose} className="p-1 rounded hover:bg-[#F5F5F5] text-[#9CA3AF]">
              <X size={16} />
            </button>
          </div>

          <div className="flex items-center gap-3 mt-3 p-3 bg-[#F5F5F5] rounded-lg text-sm">
            <span className="font-medium text-[#1A1A1A]">{fromName}</span>
            {currentDuration !== undefined && (
              <span className="text-[10px] text-[#9CA3AF]">{formatDuration(currentDuration)}</span>
            )}
            <ArrowRight size={16} className="text-[var(--nts-accent)] flex-shrink-0" />
            <span className="font-medium text-[#1A1A1A]">{toName}</span>
            {newDuration !== undefined && (
              <span className="text-[10px] text-[#9CA3AF]">{formatDuration(newDuration)}</span>
            )}
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Weight Diff */}
          {weightDiffs.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[#9CA3AF] uppercase tracking-wide mb-2">Αλλαγές βαρών</h3>
              <div className="flex flex-wrap gap-2">
                {weightDiffs.map(d => (
                  <span key={d.key} className="inline-flex items-center gap-1.5 text-xs bg-[#F5F5F5] rounded-md px-2 py-1">
                    <span style={{ color: WEIGHT_COLORS[d.key] }}>●</span>
                    <span className="text-[#4A4A4A]">{WEIGHT_LABELS[d.key]}</span>
                    <span className="text-[#9CA3AF]">{d.from}%</span>
                    <span className="text-[#9CA3AF]">→</span>
                    <span className={d.diff > 0 ? 'text-[#22C55E] font-medium' : 'text-[#EF4444] font-medium'}>
                      {d.to}%
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Products Impact */}
          <div>
            <button
              onClick={() => setShowProducts(!showProducts)}
              className="flex items-center gap-2 w-full text-left"
            >
              <Package size={15} className="text-[#4A4A4A]" />
              <h3 className="text-sm font-semibold text-[#1A1A1A] flex-1">Προϊόντα</h3>
              <div className="flex items-center gap-3 text-xs">
                {impacts.up > 0 && <span className="text-[#22C55E] font-medium">↑{impacts.up}</span>}
                {impacts.down > 0 && <span className="text-[#EF4444] font-medium">↓{impacts.down}</span>}
                <span className="text-[#9CA3AF]">{impacts.same} ίδια</span>
              </div>
              <ChevronDown size={14} className={`text-[#9CA3AF] transition-transform ${showProducts ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {showProducts && (impacts.samplesUp.length > 0 || impacts.samplesDown.length > 0) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 space-y-1.5">
                    {impacts.samplesUp.map((p, i) => (
                      <div key={`up-${i}`} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-[#F0FDF4]">
                        <ArrowUp size={11} className="text-[#22C55E] flex-shrink-0" />
                        <span className="text-[#1A1A1A] truncate">{truncateName(p.name)}</span>
                        {p.category && <span className="text-[#9CA3AF] ml-auto flex-shrink-0">{p.category}</span>}
                      </div>
                    ))}
                    {impacts.samplesDown.map((p, i) => (
                      <div key={`dn-${i}`} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-[#FEF2F2]">
                        <ArrowDown size={11} className="text-[#EF4444] flex-shrink-0" />
                        <span className="text-[#1A1A1A] truncate">{truncateName(p.name)}</span>
                        {p.category && <span className="text-[#9CA3AF] ml-auto flex-shrink-0">{p.category}</span>}
                      </div>
                    ))}
                    {(impacts.up > 5 || impacts.down > 5) && (
                      <p className="text-[10px] text-[#9CA3AF] text-center pt-1">
                        +{Math.max(0, impacts.up - 5) + Math.max(0, impacts.down - 5)} ακόμα προϊόντα
                      </p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Content */}
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-[#4A4A4A]" />
            <h3 className="text-sm font-semibold text-[#1A1A1A] flex-1">Περιεχόμενο</h3>
            {hasContent && contentStats ? (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-[#22C55E] font-medium">{contentStats.aligned} ευθυγρ.</span>
                {contentStats.needsReview > 0 && (
                  <span className="text-[#F59E0B] font-medium">{contentStats.needsReview} επανέλεγχος</span>
                )}
              </div>
            ) : (
              <span className="text-[10px] text-[#9CA3AF]">Εισάγετε content για αναλυτικό impact</span>
            )}
          </div>

          {/* Campaigns */}
          <div className="flex items-center gap-2">
            <Megaphone size={15} className="text-[#4A4A4A]" />
            <h3 className="text-sm font-semibold text-[#1A1A1A] flex-1">Campaigns</h3>
            {hasCampaigns && campaignStats ? (
              <span className="text-xs text-[#78716C] font-medium">{campaignStats.active} ενεργά</span>
            ) : (
              <span className="text-[10px] text-[#9CA3AF]">Εισάγετε campaigns για αναλυτικό impact</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="p-5 border-t border-[#E5E5E5] flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Ακύρωση
          </Button>
          <Button variant="primary" icon={<Check size={16} />} onClick={() => onConfirm(newDuration ?? 'ongoing')}>
            Εφαρμογή αλλαγής
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
