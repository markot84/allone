import { motion, AnimatePresence } from 'framer-motion';
import { useMemo, useState, useEffect } from 'react';
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
  Infinity as InfinityIcon
} from 'lucide-react';
import { Button } from '../common';
import { useBoundedProductSource } from '../../hooks/useBoundedProductSource';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useContent } from '../../hooks/useContent';
import { calculateCompositeScore, type CompositeScoreContext } from '../../utils/compositeScore';
import { scenarios } from '../../data/mockScenarios';
import type { Product, ProfitMaxScope } from '../../types';

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
  profit: 'var(--success-700)', stock: 'var(--sky-500)', strategic: 'var(--seg-potential)',
  revenue: 'var(--orange-700)', fit: 'var(--orange-500)',
};
const WEIGHT_LABELS: Record<string, string> = {
  profit: 'Κερδοφορία', stock: 'Απόθεμα', strategic: 'Στρατηγική',
  revenue: 'Τζίρος', fit: 'Ταίριασμα',
};

function getImpactModalTitle(newScenarioId?: string): string {
  return newScenarioId === 'price_benchmark' ? 'Άνοιγμα λειτουργίας' : 'Αλλαγή στρατηγικής';
}

function truncateName(name: string, max = 30) {
  if (name.length <= max) return name;
  return name.slice(0, max) + '…';
}

/** Upper SKU bound for impact scoring — avoids UI freeze on large catalogs. */
const IMPACT_SCORE_MAX_PRODUCTS = 2500;

function subsampleProductsEvenly(list: Product[], max: number): Product[] {
  if (list.length <= max) return list;
  const n = list.length;
  const out: Product[] = [];
  for (let k = 0; k < max; k++) {
    const idx = Math.floor((k / Math.max(1, max - 1)) * (n - 1));
    out.push(list[idx]);
  }
  return out;
}

type ProductImpactStats = {
  up: number;
  down: number;
  same: number;
  samplesUp: Product[];
  samplesDown: Product[];
  /** Total SKUs in scope (after the filter, if any). */
  catalogTotal: number;
  /** Actual size of the scored list (≤ catalogTotal). */
  sampleSize: number;
  /** If true, the up/down/same numbers cover only the sample, not the whole catalog. */
  usedSample: boolean;
};

function useProductImpacts(
  products: Product[],
  currentWeights: Record<string, number>,
  newWeights: Record<string, number>,
  currentScenarioId?: string,
  newScenarioId?: string,
  impactProductFilter?: (p: Product) => boolean,
  scoreContext?: CompositeScoreContext,
): ProductImpactStats {
  return useMemo(() => {
    const empty = (): ProductImpactStats => ({
      up: 0,
      down: 0,
      same: 0,
      samplesUp: [],
      samplesDown: [],
      catalogTotal: 0,
      sampleSize: 0,
      usedSample: false,
    });

    const scopedRaw = impactProductFilter ? products.filter(impactProductFilter) : products;
    const catalogTotal = scopedRaw.length;
    if (catalogTotal === 0) return empty();

    const scoped =
      catalogTotal > IMPACT_SCORE_MAX_PRODUCTS
        ? subsampleProductsEvenly(scopedRaw, IMPACT_SCORE_MAX_PRODUCTS)
        : scopedRaw;
    const usedSample = scoped.length < catalogTotal;

    const changes = scoped.map((product) => {
      const currentScore = calculateCompositeScore(
        product,
        currentWeights,
        undefined,
        currentScenarioId,
        undefined,
        // scoreContext describes the PENDING scope — the "before" score shares only the benchmark lookup, never the pending inversion.
        currentScenarioId === 'price_benchmark'
          ? { benchmarkLookup: scoreContext?.benchmarkLookup }
          : undefined,
      );
      const newScore = calculateCompositeScore(
        product,
        newWeights,
        undefined,
        newScenarioId,
        undefined,
        scoreContext,
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
      catalogTotal,
      sampleSize: scoped.length,
      usedSample,
    };
  }, [products, currentWeights, newWeights, currentScenarioId, newScenarioId, impactProductFilter, scoreContext]);
}

/* ───────── Layer 1: Inline Summary Card ───────── */

interface StrategyImpactSummaryProps extends ImpactBaseProps {
  onConfirm: (selectedDuration: number | 'ongoing') => void;
  onCancel: () => void;
  onDetails: () => void;
  initialDuration: number | 'ongoing';
  /** Restrict products in the impact preview (e.g. Sales Optimization / sales_base scope). */
  impactProductFilter?: (p: Product) => boolean;
  /** For Price Benchmarking — lookup GMC benchmark per SKU. */
  scoreContext?: CompositeScoreContext;
}

export function StrategyImpactSummary({
  currentWeights, newWeights, currentScenarioId, newScenarioId,
  onConfirm, onCancel, onDetails, initialDuration, impactProductFilter, scoreContext,
}: StrategyImpactSummaryProps) {
  const [duration, setDuration] = useState<number | 'ongoing'>(initialDuration);
  const { products } = useBoundedProductSource();
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex flex-col justify-end pointer-events-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="strategy-impact-summary-title"
    >
      <button
        type="button"
        tabIndex={-1}
        className="absolute inset-0 bg-black/30 cursor-default border-0 p-0"
        aria-label="Κλείσιμο διαλόγου (κλικ εκτός πίνακα)"
        onClick={onCancel}
      />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        className="relative z-[1] w-full max-w-3xl mx-auto px-4 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rounded-2xl border border-[var(--border)] bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.12)] p-4">
        <div className="flex items-start justify-between gap-2">
          <div id="strategy-impact-summary-title" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <span className="font-medium text-[var(--text-primary)] truncate">{fromName}</span>
            <ArrowRight size={14} className="text-[var(--nts-accent-text)] flex-shrink-0" />
            <span className="font-medium text-[var(--text-primary)] truncate">{toName}</span>
          </div>

          <div className="flex items-center gap-3 text-xs text-[var(--text-secondary)] flex-wrap">
            {impacts.up > 0 && (
              <span className="flex items-center gap-1 text-[var(--success-700)] font-medium">
                <ArrowUp size={12} /> {impacts.up} προϊόντα ανεβαίνουν
              </span>
            )}
            {impacts.down > 0 && (
              <span className="flex items-center gap-1 text-[var(--danger-600)] font-medium">
                <ArrowDown size={12} /> {impacts.down} προϊόντα κατεβαίνουν
              </span>
            )}
            {impacts.same > 0 && (
              <span className="flex items-center gap-1 text-[var(--text-muted)]">
                <Minus size={12} /> {impacts.same} ίδια προϊόντα
              </span>
            )}
          </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            aria-label="Ακύρωση (κλείσιμο)"
          >
            <X size={18} />
          </button>
        </div>

        {impacts.usedSample && (
          <p className="text-[10px] text-[var(--text-muted)] mt-2 leading-snug">
            Έλεγχος επίδρασης σε {impacts.sampleSize.toLocaleString('el-GR')} από{' '}
            {impacts.catalogTotal.toLocaleString('el-GR')} SKU (δείγμα για ταχύτητα πωλήσεων· τα ↑/↓/ίδια αφορούν μόνο αυτό το
            υποσύνολο).
          </p>
        )}

        {/* Duration selector */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[var(--surface-2)]">
          <Clock size={13} className="text-[var(--text-muted)] flex-shrink-0" />
          <span className="text-xs text-[var(--text-muted)] flex-shrink-0">Διάρκεια</span>
          <div className="flex items-center gap-1 flex-wrap">
            {[7, 14, 30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDuration(d)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-all ${
                  duration === d
                    ? 'border-[var(--nts-accent)] btn-gold text-white'
                    : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--nts-accent)]/50'
                }`}
              >
                {d}ημ
              </button>
            ))}
            <button
              onClick={() => setDuration('ongoing')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded border transition-all ${
                duration === 'ongoing'
                  ? 'border-[var(--nts-accent)] btn-gold text-white'
                  : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--nts-accent)]/50'
              }`}
            >
              <InfinityIcon size={11} />
            </button>
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto px-4 py-2 text-xs font-medium rounded-lg border border-[var(--navy-100)] text-[var(--text-secondary)] bg-white hover:bg-[var(--surface-2)] transition-colors"
          >
            Ακύρωση
          </button>
          <div className="flex items-center justify-end gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={onDetails}
            className="px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--nts-accent-text)] transition-colors"
          >
            <ChevronDown size={12} className="inline mr-1" />
            Λεπτομέρειες
          </button>
          <button
            type="button"
            onClick={() => onConfirm(duration)}
            className="px-4 py-2 text-xs font-medium btn-gold text-white rounded-lg hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5 flex-1 sm:flex-initial min-w-[120px]"
          >
            <Check size={12} />
            Εφαρμογή
          </button>
          </div>
        </div>
        </div>
      </motion.div>
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
  /** Profit Max scope selects (shown only when provided). */
  profitMaxScope?: ProfitMaxScope | null;
  onProfitMaxScopeChange?: (scope: ProfitMaxScope) => void;
  profitMaxScopeOptions?: { brands: string[]; subcategories: string[]; productTypes: string[] };
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
  profitMaxScope,
  onProfitMaxScopeChange,
  profitMaxScopeOptions,
}: StrategyImpactModalProps) {
  const { products } = useBoundedProductSource();
  const { campaigns: campaignsFromHook } = useCampaigns();
  const { contentItems: contentFromHook } = useContent();
  const campaigns = campaignsFromHook ?? [];
  const contentItems = contentFromHook ?? [];
  const [showProducts, setShowProducts] = useState(true);
  /** Selected application duration — same logic as StrategyImpactSummary (not just default scenario). */
  const [confirmDuration, setConfirmDuration] = useState<number | 'ongoing'>(() =>
    newDuration === undefined ? 'ongoing' : newDuration,
  );

  useEffect(() => {
    if (!isOpen) return;
    setConfirmDuration(newDuration === undefined ? 'ongoing' : newDuration);
  }, [isOpen, newScenarioId, newDuration]);

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

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-[var(--border)]">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-[var(--text-primary)]">{getImpactModalTitle(newScenarioId)}</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="Ακύρωση (κλείσιμο)"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex items-center gap-3 mt-3 p-3 bg-[var(--surface-2)] rounded-lg text-sm">
            <span className="font-medium text-[var(--text-primary)]">{fromName}</span>
            {currentDuration !== undefined && (
              <span className="text-[10px] text-[var(--text-muted)]">{formatDuration(currentDuration)}</span>
            )}
            <ArrowRight size={16} className="text-[var(--nts-accent-text)] flex-shrink-0" />
            <span className="font-medium text-[var(--text-primary)]">{toName}</span>
            <span className="text-[10px] text-[var(--text-muted)]">{formatDuration(confirmDuration)}</span>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Profit Max scope — filters the strategy before applying */}
          {onProfitMaxScopeChange && profitMaxScope && profitMaxScopeOptions && (
            <div>
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Εύρος εφαρμογής</h3>
              <div className="flex flex-wrap gap-2">
                {([
                  ['brandFilter', 'Όλα τα brands', profitMaxScopeOptions.brands],
                  ['subcategoryFilter', 'Όλες οι υποκατηγορίες', profitMaxScopeOptions.subcategories],
                  ['productTypeFilter', 'Όλα τα product types', profitMaxScopeOptions.productTypes],
                ] as const)
                  .filter(([, , options]) => options.length > 0)
                  .map(([key, allLabel, options]) => (
                    <select
                      key={key}
                      value={profitMaxScope[key]}
                      onChange={(e) => onProfitMaxScopeChange({ ...profitMaxScope, [key]: e.target.value })}
                      className="rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-xs text-[var(--text-primary)]"
                    >
                      <option value="">{allLabel}</option>
                      {options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ))}
              </div>
            </div>
          )}

          {/* Weight Diff */}
          {weightDiffs.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Αλλαγές βαρών</h3>
              <div className="flex flex-wrap gap-2">
                {weightDiffs.map(d => (
                  <span key={d.key} className="inline-flex items-center gap-1.5 text-xs bg-[var(--surface-2)] rounded-md px-2 py-1">
                    <span style={{ color: WEIGHT_COLORS[d.key] }}>●</span>
                    <span className="text-[var(--text-secondary)]">{WEIGHT_LABELS[d.key]}</span>
                    <span className="text-[var(--text-muted)]">{d.from}%</span>
                    <span className="text-[var(--text-muted)]">→</span>
                    <span className={d.diff > 0 ? 'text-[var(--success-700)] font-medium' : 'text-[var(--danger-600)] font-medium'}>
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
              <Package size={15} className="text-[var(--text-secondary)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)] flex-1">Προϊόντα</h3>
              <div className="flex items-center gap-3 text-xs">
                {impacts.up > 0 && <span className="text-[var(--success-700)] font-medium">↑{impacts.up}</span>}
                {impacts.down > 0 && <span className="text-[var(--danger-600)] font-medium">↓{impacts.down}</span>}
                <span className="text-[var(--text-muted)]">{impacts.same} ίδια</span>
              </div>
              <ChevronDown size={14} className={`text-[var(--text-muted)] transition-transform ${showProducts ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {showProducts && (impacts.samplesUp.length > 0 || impacts.samplesDown.length > 0) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  {impacts.usedSample && (
                    <p className="text-[10px] text-[var(--text-muted)] mb-2">
                      Δείγμα {impacts.sampleSize.toLocaleString('el-GR')} /{' '}
                      {impacts.catalogTotal.toLocaleString('el-GR')} SKU.
                    </p>
                  )}
                  <div className="space-y-1.5">
                    {impacts.samplesUp.map((p, i) => (
                      <div key={`up-${i}`} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-[var(--success-light)]">
                        <ArrowUp size={11} className="text-[var(--success-700)] flex-shrink-0" />
                        <span className="text-[var(--text-primary)] truncate">{truncateName(p.name)}</span>
                        {p.category && <span className="text-[var(--text-muted)] ml-auto flex-shrink-0">{p.category}</span>}
                      </div>
                    ))}
                    {impacts.samplesDown.map((p, i) => (
                      <div key={`dn-${i}`} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-[var(--danger-light)]">
                        <ArrowDown size={11} className="text-[var(--danger-600)] flex-shrink-0" />
                        <span className="text-[var(--text-primary)] truncate">{truncateName(p.name)}</span>
                        {p.category && <span className="text-[var(--text-muted)] ml-auto flex-shrink-0">{p.category}</span>}
                      </div>
                    ))}
                    {(impacts.up > 5 || impacts.down > 5) && (
                      <p className="text-[10px] text-[var(--text-muted)] text-center pt-1">
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
            <FileText size={15} className="text-[var(--text-secondary)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex-1">Περιεχόμενο</h3>
            {hasContent && contentStats ? (
              <div className="flex items-center gap-3 text-xs">
                <span className="text-[var(--success-700)] font-medium">{contentStats.aligned} ευθυγραμμισμένα</span>
                {contentStats.needsReview > 0 && (
                  <span className="text-[var(--orange-700)] font-medium">{contentStats.needsReview} επανέλεγχος</span>
                )}
              </div>
            ) : (
              <span className="text-[10px] text-[var(--text-muted)]">Εισαγάγετε περιεχόμενο για αναλυτική αποτίμηση</span>
            )}
          </div>

          {/* Campaigns */}
          <div className="flex items-center gap-2">
            <Megaphone size={15} className="text-[var(--text-secondary)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)] flex-1">Καμπάνιες</h3>
            {hasCampaigns && campaignStats ? (
              <span className="text-xs text-[var(--text-muted)] font-medium">{campaignStats.active} ενεργά</span>
            ) : (
              <span className="text-[10px] text-[var(--text-muted)]">Εισαγάγετε καμπάνιες για αναλυτική αποτίμηση</span>
            )}
          </div>

          {/* Duration — must be visible before applying (same UX as the summary layer). */}
          <div className="flex flex-col gap-2 pt-2 border-t border-[var(--surface-2)]">
            <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
              <Clock size={14} className="text-[var(--text-muted)] flex-shrink-0" aria-hidden />
              <span className="font-medium text-[var(--text-primary)]">Διάρκεια νέας πολιτικής</span>
            </div>
            <p className="text-[10px] text-[var(--text-muted)] leading-snug">
              Επιλέξτε πόσες ημέρες ισχύει η πολιτική (ή συνεχής). Η ημερομηνία λήξης υπολογίζεται από την ημέρα ενεργοποίησης.
            </p>
            <div className="flex items-center gap-1 flex-wrap">
              {[7, 14, 30, 60, 90].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setConfirmDuration(d)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                    confirmDuration === d
                      ? 'border-[var(--nts-accent)] btn-gold text-white'
                      : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--nts-accent)]/50'
                  }`}
                >
                  {d} ημ.
                </button>
              ))}
              <button
                type="button"
                onClick={() => setConfirmDuration('ongoing')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                  confirmDuration === 'ongoing'
                    ? 'border-[var(--nts-accent)] btn-gold text-white'
                    : 'border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--nts-accent)]/50'
                }`}
                title="Συνεχής — χωρίς αυτόματη λήξη"
              >
                <InfinityIcon size={12} aria-hidden />
                Συνεχής
              </button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-5 border-t border-[var(--border)] flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Ακύρωση
          </Button>
          <Button variant="primary" icon={<Check size={16} />} onClick={() => onConfirm(confirmDuration)}>
            Εφαρμογή αλλαγής
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
