import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Layers } from 'lucide-react';
import type { Product, PriceBenchmarkPresetId, PriceBenchmarkStrategyScope } from '../../types';
import type { PriceBenchmark } from '../../hooks/usePriceBenchmarks';
import {
  buildBenchmarkLookup,
  findBenchmarkForProductInLookup,
  PRICE_BENCHMARK_PRESET_OPTIONS,
  isCheaperThanMarket,
  productMatchesPriceBenchmarkTextFilters,
} from '../../utils/priceBenchmarkStrategy';

function brandOf(p: Product): string {
  const b = p.brand?.trim();
  if (b) return b;
  return p.supplier?.trim() ?? '';
}

type GroupRow = { label: string; count: number; avgDiff: number };

function buildBrandGroups(rows: { product: Product; benchmark: PriceBenchmark }[]): GroupRow[] {
  const m = new Map<string, { count: number; sumDiff: number }>();
  for (const { product: p, benchmark: b } of rows) {
    const label = brandOf(p) || '—';
    const cur = m.get(label) ?? { count: 0, sumDiff: 0 };
    cur.count += 1;
    cur.sumDiff += b.priceDiff;
    m.set(label, cur);
  }
  return [...m.entries()]
    .map(([label, v]) => ({ label, count: v.count, avgDiff: v.sumDiff / v.count }))
    .sort((a, b) => b.count - a.count);
}

function buildCategoryGroups(rows: { product: Product; benchmark: PriceBenchmark }[]): GroupRow[] {
  const m = new Map<string, { count: number; sumDiff: number }>();
  for (const { product: p, benchmark: b } of rows) {
    const label = (p.category ?? '').trim() || '—';
    const cur = m.get(label) ?? { count: 0, sumDiff: 0 };
    cur.count += 1;
    cur.sumDiff += b.priceDiff;
    m.set(label, cur);
  }
  return [...m.entries()]
    .map(([label, v]) => ({ label, count: v.count, avgDiff: v.sumDiff / v.count }))
    .sort((a, b) => b.count - a.count);
}

const MAX_GROUP_ROWS = 18;

export interface PriceBenchmarkSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  benchmarks: PriceBenchmark[];
  initialScope?: PriceBenchmarkStrategyScope | null;
  onContinue: (scope: PriceBenchmarkStrategyScope) => void;
}

export function PriceBenchmarkSetupModal({
  isOpen,
  onClose,
  products,
  benchmarks,
  initialScope,
  onContinue,
}: PriceBenchmarkSetupModalProps) {
  const [preset, setPreset] = useState<PriceBenchmarkPresetId>('below_market');
  const [brandFilter, setBrandFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const s = initialScope ?? {
      preset: 'below_market' as const,
      brandFilter: '',
      categoryFilter: '',
      search: '',
      selectedProductIds: null,
    };
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

  const benchmarkLookup = useMemo(() => buildBenchmarkLookup(benchmarks), [benchmarks]);

  const matchedRows = useMemo(() => {
    const rows: { product: Product; benchmark: PriceBenchmark }[] = [];
    for (const p of products) {
      const b = findBenchmarkForProductInLookup(p, benchmarkLookup);
      if (!b || b.benchmarkPrice <= 0) continue;
      if (preset === 'below_market' && !isCheaperThanMarket(b)) continue;
      if (!productMatchesPriceBenchmarkTextFilters(p, brandFilter, categoryFilter, search)) continue;
      rows.push({ product: p, benchmark: b });
    }
    return rows;
  }, [products, benchmarkLookup, preset, brandFilter, categoryFilter, search]);

  const totalMatched = matchedRows.length;
  const brandGroups = useMemo(() => buildBrandGroups(matchedRows), [matchedRows]);
  const categoryGroups = useMemo(() => buildCategoryGroups(matchedRows), [matchedRows]);

  const handleContinue = () => {
    if (matchedRows.length === 0) return;
    onContinue({
      preset,
      brandFilter,
      categoryFilter,
      search,
      selectedProductIds: null,
    });
  };

  const hasBenchmarkData = benchmarks.some((b) => b.benchmarkPrice > 0);

  if (!isOpen) return null;

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
              <th className="px-3 py-2 font-medium text-right">Μέσος Διαφορά %</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((g) => (
              <tr key={g.label} className="border-b border-[#F9FAFB]">
                <td className="px-3 py-1.5 text-[#111827] truncate max-w-[180px]" title={g.label}>
                  {g.label}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-[#4B5563]">{g.count}</td>
                <td
                  className={`px-3 py-1.5 text-right font-mono font-medium ${
                    g.avgDiff < 0 ? 'text-emerald-700' : g.avgDiff > 0 ? 'text-rose-700' : 'text-[#6B7280]'
                  }`}
                >
                  {g.avgDiff > 0 ? '+' : ''}
                  {g.avgDiff.toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {restCount > 0 && (
          <p className="text-[10px] text-[#9CA3AF] px-3 py-2 border-t border-[#F3F4F6]">
            +{restCount} ακόμα ομάδες με λιγότερα SKU (από κοινού στο σύνολο παραπάνω).
          </p>
        )}
      </div>
    </div>
  );

  const sliceGroups = (groups: GroupRow[]) => {
    if (groups.length <= MAX_GROUP_ROWS) return { shown: groups, rest: 0 };
    return { shown: groups.slice(0, MAX_GROUP_ROWS), rest: groups.length - MAX_GROUP_ROWS };
  };

  const brandS = sliceGroups(brandGroups);
  const catS = sliceGroups(categoryGroups);

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
              <h2 className="text-base font-bold text-[#1A1A1A]">Price Benchmarking — εύρος με φίλτρα</h2>
              <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">
                Ορίστε preset και φίλτρα. Η στρατηγική εφαρμόζεται σε <strong>όλα</strong> τα SKU που πληρούν τα κριτήρια.
                Παρακάτω εμφανίζεται συνοπτική εικόνα ανά μάρκα και κατηγορία, χωρίς αναλυτική λίστα SKU.
              </p>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#F5F5F5] text-[#9CA3AF]">
              <X size={18} />
            </button>
          </div>

          <div className="px-5 py-3 space-y-3 overflow-y-auto flex-1 min-h-0">
            {!hasBenchmarkData && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Δεν βρέθηκαν έγκυρα benchmarks. Συνδέστε το Google Merchant Center και εκτελέστε συγχρονισμό από τη
                σελίδα Ανταγωνισμός.
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PRICE_BENCHMARK_PRESET_OPTIONS.map((opt) => (
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
                    name="pb-preset"
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
                  list="pb-brands"
                  value={brandFilter}
                  onChange={(e) => setBrandFilter(e.target.value)}
                  placeholder="Φίλτρο…"
                  className="mt-0.5 w-full text-xs border border-[#E5E5E5] rounded-lg px-2 py-1.5"
                />
                <datalist id="pb-brands">
                  {brandOptions.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">Κατηγορία</label>
                <input
                  list="pb-cats"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  placeholder="Φίλτρο…"
                  className="mt-0.5 w-full text-xs border border-[#E5E5E5] rounded-lg px-2 py-1.5"
                />
                <datalist id="pb-cats">
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
                Στην επόμενη οθόνη επιλέγετε διάρκεια· η στρατηγική θα ισχύει για όλα αυτά τα SKU (όχι επιλογή ανά
                γραμμή).
              </p>
            </div>

            {totalMatched > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {renderGroupTable('Ανά μάρκα / προμηθευτή', brandS.shown, brandS.rest, brandGroups.length)}
                {renderGroupTable('Ανά κατηγορία', catS.shown, catS.rest, categoryGroups.length)}
              </div>
            )}

            {totalMatched === 0 && hasBenchmarkData && (
              <p className="text-xs text-center text-[#9CA3AF] py-6">
                Δεν βρέθηκε κανένα SKU που να ικανοποιεί τα επιλεγμένα φίλτρα ή preset.
              </p>
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
              disabled={!hasBenchmarkData || totalMatched === 0}
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
