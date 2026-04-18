import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Layers } from 'lucide-react';
import type { Product, SalesBasePresetId, SalesBaseScope } from '../../types';
import {
  SALES_BASE_PRESET_OPTIONS,
  calculateSalesMomentumScore,
  productMatchesSalesBasePreset,
  productMatchesSalesBaseTextFilters,
} from '../../utils/salesBaseScore';

function brandOf(p: Product): string {
  const b = p.brand?.trim();
  if (b) return b;
  return p.supplier?.trim() ?? '';
}

type GroupRow = { label: string; count: number; avgMomentum: number };

function buildBrandGroups(products: Product[]): GroupRow[] {
  const m = new Map<string, { count: number; sumMom: number }>();
  for (const p of products) {
    const label = brandOf(p) || '—';
    const cur = m.get(label) ?? { count: 0, sumMom: 0 };
    const mom = calculateSalesMomentumScore(p);
    cur.count += 1;
    cur.sumMom += mom;
    m.set(label, cur);
  }
  return [...m.entries()]
    .map(([label, v]) => ({ label, count: v.count, avgMomentum: v.sumMom / v.count }))
    .sort((a, b) => b.count - a.count);
}

function buildCategoryGroups(products: Product[]): GroupRow[] {
  const m = new Map<string, { count: number; sumMom: number }>();
  for (const p of products) {
    const label = (p.category ?? '').trim() || '—';
    const cur = m.get(label) ?? { count: 0, sumMom: 0 };
    const mom = calculateSalesMomentumScore(p);
    cur.count += 1;
    cur.sumMom += mom;
    m.set(label, cur);
  }
  return [...m.entries()]
    .map(([label, v]) => ({ label, count: v.count, avgMomentum: v.sumMom / v.count }))
    .sort((a, b) => b.count - a.count);
}

const MAX_GROUP_ROWS = 18;

const defaultScope = (): SalesBaseScope => ({
  preset: 'all',
  brandFilter: '',
  categoryFilter: '',
  search: '',
  selectedProductIds: null,
});

interface SalesBaseSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  initialScope?: SalesBaseScope | null;
  onContinue: (scope: SalesBaseScope) => void;
}

export function SalesBaseSetupModal({
  isOpen,
  onClose,
  products,
  initialScope,
  onContinue,
}: SalesBaseSetupModalProps) {
  const [preset, setPreset] = useState<SalesBasePresetId>('all');
  const [brandFilter, setBrandFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const s = initialScope ?? defaultScope();
    setPreset(s.preset);
    setBrandFilter(s.brandFilter);
    setCategoryFilter(s.categoryFilter);
    setSearch(s.search);
  }, [isOpen, initialScope]);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const b = brandOf(p);
      if (b) set.add(b);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'el'));
  }, [products]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      const c = (p.category ?? '').trim();
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'el'));
  }, [products]);

  const ruleFiltered = useMemo(() => {
    return products.filter(
      (p) =>
        productMatchesSalesBaseTextFilters(p, brandFilter, categoryFilter, search) &&
        productMatchesSalesBasePreset(p, preset),
    );
  }, [products, brandFilter, categoryFilter, search, preset]);

  const totalMatched = ruleFiltered.length;
  const brandGroups = useMemo(() => buildBrandGroups(ruleFiltered), [ruleFiltered]);
  const categoryGroups = useMemo(() => buildCategoryGroups(ruleFiltered), [ruleFiltered]);

  const handleContinue = () => {
    onContinue({
      preset,
      brandFilter,
      categoryFilter,
      search,
      selectedProductIds: null,
    });
  };

  if (!isOpen) return null;

  const sliceGroups = (groups: GroupRow[]) => {
    if (groups.length <= MAX_GROUP_ROWS) return { shown: groups, rest: 0 };
    return { shown: groups.slice(0, MAX_GROUP_ROWS), rest: groups.length - MAX_GROUP_ROWS };
  };

  const brandS = sliceGroups(brandGroups);
  const catS = sliceGroups(categoryGroups);

  const renderGroupTable = (title: string, shown: GroupRow[], restCount: number, totalGroups: number) => (
    <div className="rounded-xl border border-[#E5E5E5] overflow-hidden">
      <div className="px-3 py-2 bg-[#F9FAFB] border-b border-[#E5E5E5] flex items-center gap-2">
        <Layers size={14} className="text-[#6B7280]" />
        <span className="text-xs font-semibold text-[#374151]">{title}</span>
        <span className="text-[10px] text-[#9CA3AF] ml-auto">{totalGroups} ομάδες</span>
      </div>
      <div className="max-h-[220px] overflow-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="sticky top-0 bg-white border-b border-[#F3F4F6] z-[1]">
            <tr className="text-[#9CA3AF]">
              <th className="px-3 py-2 font-medium">Ομάδα</th>
              <th className="px-3 py-2 font-medium text-right">SKU</th>
              <th className="px-3 py-2 font-medium text-right">Μέσο score</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => (
              <tr key={g.label} className="border-b border-[#F9FAFB]">
                <td className="px-3 py-1.5 text-[#111827] truncate max-w-[180px]" title={g.label}>
                  {g.label}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[#4B5563]">{g.count}</td>
                <td className="px-3 py-1.5 text-right font-mono font-medium text-[var(--nts-accent)]">
                  {g.avgMomentum.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {restCount > 0 && (
          <p className="text-[10px] text-[#9CA3AF] px-3 py-2 border-t border-[#F3F4F6]">
            +{restCount} ακόμα ομάδες με λιγότερα SKU (συμπεριλαμβάνονται στο σύνολο παρακάτω).
          </p>
        )}
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-[#E5E5E5]">
            <div>
              <h2 className="text-base font-bold text-[#1A1A1A]">Sales Optimization — εύρος με φίλτρα</h2>
              <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">
                Ορίστε preset ρυθμού πωλήσεων και φίλτρα· η στρατηγική εφαρμόζεται σε <strong>όλα</strong> τα SKU που
                ταιριάζουν. Σύνοψη ανά μάρκα και κατηγορία (χωρίς αναλυτική λίστα).
              </p>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#F5F5F5] text-[#9CA3AF]">
              <X size={18} />
            </button>
          </div>

          <div className="px-5 py-3 space-y-3 overflow-y-auto flex-1 min-h-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {SALES_BASE_PRESET_OPTIONS.map((opt) => (
                <label
                  key={opt.id}
                  className={`flex gap-2 rounded-xl border p-2.5 cursor-pointer text-left transition-colors ${
                    preset === opt.id
                      ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/5'
                      : 'border-[#E5E5E5] hover:border-[var(--nts-accent)]/40'
                  }`}
                >
                  <input
                    type="radio"
                    name="sales-base-preset"
                    className="mt-0.5"
                    checked={preset === opt.id}
                    onChange={() => setPreset(opt.id)}
                  />
                  <span className="min-w-0">
                    <span className="text-xs font-semibold text-[#1A1A1A] block">{opt.label}</span>
                    <span className="text-[10px] text-[#6B7280] leading-snug">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[140px]">
                <label className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">Μάρκα / προμηθευτής</label>
                <input
                  list="sales-base-brands"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  placeholder="Φίλτρο…"
                  className="mt-0.5 w-full text-xs border border-[#E5E5E5] rounded-lg px-2 py-1.5"
                />
                <datalist id="sales-base-brands">
                  {brandOptions.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">Κατηγορία</label>
                <input
                  list="sales-base-cats"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  placeholder="Φίλτρο…"
                  className="mt-0.5 w-full text-xs border border-[#E5E5E5] rounded-lg px-2 py-1.5"
                />
                <datalist id="sales-base-cats">
                  {categoryOptions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="flex-[2] min-w-[180px]">
                <label className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">Αναζήτηση</label>
                <div className="relative mt-0.5">
                  <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Όνομα ή SKU…"
                    className="w-full text-xs border border-[#E5E5E5] rounded-lg pl-7 pr-2 py-1.5"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--nts-accent)]/25 bg-[var(--nts-accent)]/5 px-3 py-2">
              <p className="text-xs font-medium text-[#1A1A1A]">
                Σύνολο <span className="text-[var(--nts-accent)]">{totalMatched.toLocaleString('el-GR')}</span> SKU
                ταιριάζουν με τα κριτήρια.
              </p>
              <p className="text-[10px] text-[#6B7280] mt-1">
                Στην επόμενη οθόνη επιλέγετε διάρκεια· η στρατηγική ισχύει για όλα αυτά τα SKU (όχι επιλογή ανά
                γραμμή).
              </p>
            </div>

            {totalMatched > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {renderGroupTable('Ανά μάρκα / προμηθευτή', brandS.shown, brandS.rest, brandGroups.length)}
                {renderGroupTable('Ανά κατηγορία', catS.shown, catS.rest, categoryGroups.length)}
              </div>
            )}

            {totalMatched === 0 && (
              <p className="text-xs text-center text-[#9CA3AF] py-6">Δεν ταιριάζει κανένα SKU με τα φίλτρα / preset.</p>
            )}
          </div>

          <div className="flex justify-end gap-2 px-5 py-3 border-t border-[#E5E5E5] bg-[#FAFAFA]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-[#6B7280] hover:text-[#111827]"
            >
              Ακύρωση
            </button>
            <button
              type="button"
              onClick={handleContinue}
              disabled={totalMatched === 0}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-[var(--nts-accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:pointer-events-none"
            >
              Συνέχεια — διάρκεια στρατηγικής
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
