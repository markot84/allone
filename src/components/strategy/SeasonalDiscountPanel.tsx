import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Percent, Tag, Package, Check, X } from 'lucide-react';
import { useBoundedProductSource } from '../../hooks/useBoundedProductSource';
import { getActiveSeasons, getUpcomingSeason, type SeasonalPeriod } from '../../data/seasonalPeriods';

export interface SeasonalDiscountConfig {
  periodId?: string;
  periodName: string;
  discountPercent: number;
  scope: 'all' | 'categories' | 'products';
  selectedCategories: string[];
  selectedProductIds: string[];
  startDate?: string;
  endDate?: string;
}

interface SeasonalDiscountPanelProps {
  onApply: (config: SeasonalDiscountConfig) => void;
  onClose?: () => void;
  initialConfig?: SeasonalDiscountConfig | null;
}

const DISCOUNT_PRESETS = [5, 10, 15, 20, 25, 30, 40, 50];

export function SeasonalDiscountPanel({ onApply, onClose, initialConfig }: SeasonalDiscountPanelProps) {
  const { products } = useBoundedProductSource();

  const [periodName, setPeriodName] = useState(initialConfig?.periodName ?? '');
  const [discountPercent, setDiscountPercent] = useState(initialConfig?.discountPercent ?? 20);
  const [scope, setScope] = useState<'all' | 'categories' | 'products'>(initialConfig?.scope ?? 'all');
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(initialConfig?.selectedCategories ?? [])
  );
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(
    new Set(initialConfig?.selectedProductIds ?? [])
  );
  const [selectedPeriodId, setSelectedPeriodId] = useState<string | null>(initialConfig?.periodId ?? null);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    products.forEach(p => { if (p.category) cats.add(p.category); });
    return Array.from(cats).sort();
  }, [products]);

  const activeSeasons = useMemo(() => getActiveSeasons(), []);
  const upcomingSeason = useMemo(() => getUpcomingSeason(), []);
  const suggestedPeriods = useMemo(() => {
    const ids = new Set(activeSeasons.map(s => s.id));
    if (upcomingSeason && !ids.has(upcomingSeason.id)) {
      return [...activeSeasons, upcomingSeason];
    }
    return activeSeasons;
  }, [activeSeasons, upcomingSeason]);

  const handlePeriodSelect = useCallback((period: SeasonalPeriod) => {
    setSelectedPeriodId(period.id);
    setPeriodName(period.name);
  }, []);

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  const toggleProduct = useCallback((id: string) => {
    setSelectedProductIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const affectedCount = useMemo(() => {
    if (scope === 'all') return products.length;
    if (scope === 'categories') return products.filter(p => selectedCategories.has(p.category)).length;
    return selectedProductIds.size;
  }, [scope, products, selectedCategories, selectedProductIds]);

  const canApply = periodName.trim().length > 0 && discountPercent > 0 && (
    scope === 'all' || (scope === 'categories' && selectedCategories.size > 0) || (scope === 'products' && selectedProductIds.size > 0)
  );

  const handleApply = useCallback(() => {
    if (!canApply) return;
    onApply({
      periodId: selectedPeriodId ?? undefined,
      periodName: periodName.trim(),
      discountPercent,
      scope,
      selectedCategories: Array.from(selectedCategories),
      selectedProductIds: Array.from(selectedProductIds),
    });
  }, [canApply, onApply, selectedPeriodId, periodName, discountPercent, scope, selectedCategories, selectedProductIds]);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="rounded-xl border border-[#E5E5E5] bg-white overflow-hidden"
      style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}
    >
      <div className="p-5 space-y-5 relative">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-[#F5F5F5] text-[#9CA3AF] hover:text-[#4A4A4A] transition-colors"
            title="Κλείσιμο"
          >
            <X size={18} />
          </button>
        )}
        {/* Period Name + Suggested */}
        <div>
          <label className="text-xs font-semibold text-[#4A4A4A] block mb-2">Όνομα περιόδου</label>
          <input
            type="text"
            value={periodName}
            onChange={e => { setPeriodName(e.target.value); setSelectedPeriodId(null); }}
            placeholder="π.χ. Black Friday, Χριστούγεννα..."
            className="w-full px-3 py-2 rounded-lg border border-[#E5E5E5] text-sm focus:outline-none focus:border-[var(--nts-accent)] transition-colors"
          />
          {suggestedPeriods.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {suggestedPeriods.map(p => (
                <button
                  key={p.id}
                  onClick={() => handlePeriodSelect(p)}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                    selectedPeriodId === p.id
                      ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10 text-[var(--nts-accent)] font-medium'
                      : 'border-[#E5E5E5] text-[#9CA3AF] hover:border-[var(--nts-accent)]/40'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Discount % */}
        <div>
          <label className="text-xs font-semibold text-[#4A4A4A] block mb-2">
            <Percent size={12} className="inline mr-1" />
            Ποσοστό έκπτωσης
          </label>
          <div className="flex flex-wrap gap-2">
            {DISCOUNT_PRESETS.map(pct => (
              <button
                key={pct}
                onClick={() => setDiscountPercent(pct)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  discountPercent === pct
                    ? 'bg-[var(--nts-accent)] text-white'
                    : 'bg-[#F5F5F5] text-[#4A4A4A] hover:bg-[#E5E5E5]'
                }`}
              >
                {pct}%
              </button>
            ))}
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={90}
                value={discountPercent}
                onChange={e => setDiscountPercent(Math.min(90, Math.max(1, parseInt(e.target.value) || 1)))}
                className="w-14 px-2 py-1.5 rounded-lg border border-[#E5E5E5] text-xs text-center focus:outline-none focus:border-[var(--nts-accent)]"
              />
              <span className="text-xs text-[#9CA3AF]">%</span>
            </div>
          </div>
        </div>

        {/* Scope */}
        <div>
          <label className="text-xs font-semibold text-[#4A4A4A] block mb-2">Εφαρμογή σε</label>
          <div className="flex gap-2">
            {([
              { id: 'all' as const, label: 'Όλα τα προϊόντα', icon: Package },
              { id: 'categories' as const, label: 'Κατηγορίες', icon: Tag },
              { id: 'products' as const, label: 'Προϊόντα', icon: Package },
            ]).map(opt => (
              <button
                key={opt.id}
                onClick={() => setScope(opt.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all flex-1 justify-center ${
                  scope === opt.id
                    ? 'bg-[#1A1A1A] text-white'
                    : 'bg-[#F5F5F5] text-[#4A4A4A] hover:bg-[#E5E5E5]'
                }`}
              >
                <opt.icon size={13} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Category Selector */}
        {scope === 'categories' && (
          <div>
            <label className="text-xs font-semibold text-[#4A4A4A] block mb-2">
              Επιλογή κατηγοριών ({selectedCategories.size} επιλεγμένες)
            </label>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs transition-all ${
                    selectedCategories.has(cat)
                      ? 'bg-[var(--nts-accent)] text-white'
                      : 'bg-[#F5F5F5] text-[#4A4A4A] hover:bg-[#E5E5E5]'
                  }`}
                >
                  {selectedCategories.has(cat) && <Check size={10} />}
                  {cat}
                </button>
              ))}
              {categories.length === 0 && (
                <p className="text-xs text-[#9CA3AF]">Δεν βρέθηκαν κατηγορίες στα προϊόντα</p>
              )}
            </div>
          </div>
        )}

        {/* Product Selector */}
        {scope === 'products' && (
          <div>
            <label className="text-xs font-semibold text-[#4A4A4A] block mb-2">
              Επιλογή προϊόντων ({selectedProductIds.size} επιλεγμένα)
            </label>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {products.slice(0, 50).map(p => (
                <button
                  key={p.id}
                  onClick={() => toggleProduct(p.id)}
                  className={`flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs text-left transition-all ${
                    selectedProductIds.has(p.id)
                      ? 'bg-[var(--nts-accent)]/10 text-[var(--nts-accent)] border border-[var(--nts-accent)]/30'
                      : 'bg-[#F5F5F5] text-[#4A4A4A] hover:bg-[#E5E5E5] border border-transparent'
                  }`}
                >
                  {selectedProductIds.has(p.id) ? <Check size={11} /> : <X size={11} className="opacity-0" />}
                  <span className="truncate flex-1">{p.name}</span>
                  <span className="text-[10px] text-[#9CA3AF] flex-shrink-0">{p.category}</span>
                </button>
              ))}
              {products.length === 0 && (
                <p className="text-xs text-[#9CA3AF]">Δεν βρέθηκαν προϊόντα</p>
              )}
              {products.length > 50 && (
                <p className="text-[10px] text-[#9CA3AF] text-center pt-1">Για λόγους ευχρηστίας εμφανίζονται τα πρώτα 50 προϊόντα</p>
              )}
            </div>
          </div>
        )}

        {/* Summary + Apply */}
        <div className="flex items-center justify-between pt-3 border-t border-[#E5E5E5]">
          <span className="text-xs text-[#4A4A4A]">
            <span className="font-semibold">{affectedCount}</span> προϊόντα · <span className="font-semibold text-[#EF4444]">-{discountPercent}%</span>
          </span>
          <button
            onClick={handleApply}
            disabled={!canApply}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              canApply
                ? 'bg-[#1A1A1A] text-white hover:bg-[#333]'
                : 'bg-[#E5E5E5] text-[#9CA3AF] cursor-not-allowed'
            }`}
          >
            Εφαρμογή
          </button>
        </div>
      </div>
    </motion.div>
  );
}
