import { useMemo, useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, ArrowUpDown } from 'lucide-react';
import type { Product, PriceBenchmarkPresetId, PriceBenchmarkStrategyScope } from '../../types';
import type { PriceBenchmark } from '../../hooks/usePriceBenchmarks';
import {
  PRICE_BENCHMARK_PRESET_OPTIONS,
  findBenchmarkForProduct,
  isCheaperThanMarket,
  productMatchesPriceBenchmarkTextFilters,
} from '../../utils/priceBenchmarkStrategy';

const MAX_EXPLICIT_IDS = 2500;

export type PriceBenchmarkSortKey =
  | 'diff'
  | 'yourPrice'
  | 'benchmarkPrice'
  | 'brand'
  | 'category'
  | 'name';

function brandOf(p: Product): string {
  const b = p.brand?.trim();
  if (b) return b;
  return p.supplier?.trim() ?? '';
}

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
  const [sortKey, setSortKey] = useState<PriceBenchmarkSortKey>('diff');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [checked, setChecked] = useState<Record<string, boolean>>({});

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
    setSortKey('diff');
    setSortDir('asc');
    setChecked({});
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

  const matchedRows = useMemo(() => {
    const rows: { product: Product; benchmark: PriceBenchmark }[] = [];
    for (const p of products) {
      const b = findBenchmarkForProduct(p, benchmarks);
      if (!b || b.benchmarkPrice <= 0) continue;
      if (preset === 'below_market' && !isCheaperThanMarket(b)) continue;
      if (!productMatchesPriceBenchmarkTextFilters(p, brandFilter, categoryFilter, search)) continue;
      rows.push({ product: p, benchmark: b });
    }
    return rows;
  }, [products, benchmarks, preset, brandFilter, categoryFilter, search]);

  const sortedRows = useMemo(() => {
    const rows = [...matchedRows];
    const dir = sortDir === 'asc' ? 1 : -1;
    rows.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'diff':
          cmp = a.benchmark.priceDiff - b.benchmark.priceDiff;
          break;
        case 'yourPrice':
          cmp = a.benchmark.yourPrice - b.benchmark.yourPrice;
          break;
        case 'benchmarkPrice':
          cmp = a.benchmark.benchmarkPrice - b.benchmark.benchmarkPrice;
          break;
        case 'brand':
          cmp = brandOf(a.product).localeCompare(brandOf(b.product), 'el');
          break;
        case 'category':
          cmp = (a.product.category ?? '').localeCompare(b.product.category ?? '', 'el');
          break;
        case 'name':
        default:
          cmp = (a.product.name ?? '').localeCompare(b.product.name ?? '', 'el');
      }
      return cmp * dir;
    });
    return rows;
  }, [matchedRows, sortKey, sortDir]);

  useEffect(() => {
    if (!isOpen || sortedRows.length === 0) return;
    setChecked((prev) => {
      const next: Record<string, boolean> = {};
      for (const { product: p } of sortedRows) {
        next[p.id] = prev[p.id] !== false;
      }
      return next;
    });
  }, [isOpen, sortedRows, preset, brandFilter, categoryFilter, search]);

  const toggleSort = useCallback((key: PriceBenchmarkSortKey) => {
    setSortKey((k) => {
      if (k === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return k;
      }
      setSortDir(key === 'name' || key === 'brand' || key === 'category' ? 'asc' : key === 'diff' ? 'asc' : 'desc');
      return key;
    });
  }, []);

  const selectedCount = useMemo(
    () => sortedRows.filter(({ product: p }) => checked[p.id] !== false).length,
    [sortedRows, checked],
  );

  const handleContinue = () => {
    if (sortedRows.length === 0) return;
    const allOn = sortedRows.every(({ product: p }) => checked[p.id] !== false);
    const ids = sortedRows.filter(({ product: p }) => checked[p.id] !== false).map(({ product: p }) => p.id);
    if (ids.length === 0) return;
    if (ids.length > MAX_EXPLICIT_IDS) {
      window.alert(`Επιλέχθηκαν πάνω από ${MAX_EXPLICIT_IDS} SKU. Στενέψτε με φίλτρα.`);
      return;
    }
    onContinue({
      preset,
      brandFilter,
      categoryFilter,
      search,
      selectedProductIds: allOn ? null : ids,
    });
  };

  const hasBenchmarkData = benchmarks.some((b) => b.benchmarkPrice > 0);

  if (!isOpen) return null;

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
              <h2 className="text-base font-bold text-[#1A1A1A]">Price Benchmarking — επιλογή SKU</h2>
              <p className="text-xs text-[#6B7280] mt-1 leading-relaxed">
                Προϊόντα με δεδομένα GMC έναντι αγοράς. Προεπιλογή: φθηνότερα από το benchmark. Μετά ακολουθεί η
                επιλογή διάρκειας στρατηγικής.
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

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1 text-[11px] text-[#6B7280]">
                <ArrowUpDown size={12} />
                <span>
                  {sortedRows.length} SKU · επιλεγμένα {selectedCount}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ['diff', 'Διαφορά %'],
                    ['yourPrice', 'Τιμή σας'],
                    ['benchmarkPrice', 'Αγορά'],
                    ['brand', 'Μάρκα'],
                    ['category', 'Κατηγορία'],
                    ['name', 'Όνομα'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleSort(key)}
                    className={`px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors ${
                      sortKey === key
                        ? 'border-[var(--nts-accent)] bg-[var(--nts-accent)]/10 text-[var(--nts-accent)]'
                        : 'border-[#E5E5E5] text-[#4B5563] hover:border-[var(--nts-accent)]/40'
                    }`}
                  >
                    {label}
                    {sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 text-[11px]">
              <button
                type="button"
                className="px-2 py-1 rounded-md border border-[#E5E5E5] hover:bg-[#F9FAFB]"
                onClick={() => {
                  const next: Record<string, boolean> = {};
                  for (const { product: p } of sortedRows) next[p.id] = true;
                  setChecked(next);
                }}
              >
                Επιλογή όλων (ορατά)
              </button>
              <button
                type="button"
                className="px-2 py-1 rounded-md border border-[#E5E5E5] hover:bg-[#F9FAFB]"
                onClick={() => {
                  const next: Record<string, boolean> = {};
                  for (const { product: p } of sortedRows) next[p.id] = false;
                  setChecked(next);
                }}
              >
                Καμία
              </button>
            </div>

            <div className="border border-[#E5E5E5] rounded-xl overflow-hidden">
              <div className="max-h-[min(40vh,320px)] overflow-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-[#F9FAFB] border-b border-[#E5E5E5] z-[1]">
                    <tr>
                      <th className="w-8 px-2 py-2" />
                      <th className="px-2 py-2 font-semibold text-[#6B7280]">SKU</th>
                      <th className="px-2 py-2 font-semibold text-[#6B7280]">Όνομα</th>
                      <th className="px-2 py-2 font-semibold text-[#6B7280] hidden sm:table-cell">Μάρκα</th>
                      <th className="px-2 py-2 font-semibold text-[#6B7280] text-right">Εσείς</th>
                      <th className="px-2 py-2 font-semibold text-[#6B7280] text-right">Αγορά</th>
                      <th className="px-2 py-2 font-semibold text-[#6B7280] text-right">Διαφορά</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map(({ product: p, benchmark: b }) => (
                      <tr key={p.id} className="border-b border-[#F3F4F6] hover:bg-[#FAFAFA]">
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={checked[p.id] !== false}
                            onChange={(e) => setChecked((c) => ({ ...c, [p.id]: e.target.checked }))}
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono text-[#4B5563] whitespace-nowrap">{p.sku}</td>
                        <td className="px-2 py-1.5 text-[#111827] max-w-[200px] truncate">{p.name}</td>
                        <td className="px-2 py-1.5 text-[#6B7280] hidden sm:table-cell max-w-[100px] truncate">
                          {brandOf(p) || '—'}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono">€{b.yourPrice.toFixed(2)}</td>
                        <td className="px-2 py-1.5 text-right font-mono">€{b.benchmarkPrice.toFixed(2)}</td>
                        <td
                          className={`px-2 py-1.5 text-right font-mono font-medium ${
                            b.priceDiff < 0 ? 'text-emerald-700' : b.priceDiff > 0 ? 'text-rose-700' : 'text-[#6B7280]'
                          }`}
                        >
                          {b.priceDiff > 0 ? '+' : ''}
                          {b.priceDiff}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {sortedRows.length === 0 && (
                  <p className="text-xs text-center text-[#9CA3AF] py-8">
                    {hasBenchmarkData
                      ? 'Δεν ταιριάζει κανένα SKU με τα φίλτρα / preset.'
                      : 'Δεν υπάρχουν benchmarks για εμφάνιση.'}
                  </p>
                )}
              </div>
            </div>
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
              disabled={!hasBenchmarkData || sortedRows.length === 0 || selectedCount === 0}
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
