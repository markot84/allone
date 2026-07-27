import { useMemo, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Layers, Info, RefreshCw } from 'lucide-react';
import type { Product, SalesBaseCategorySource, SalesBasePresetId, SalesBaseScope } from '../../types';
import {
  SALES_BASE_PRESET_OPTIONS,
  calculateSalesMomentumScore,
  categoryForSource,
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

function buildCategoryGroups(products: Product[], source: SalesBaseCategorySource): GroupRow[] {
  const m = new Map<string, { count: number; sumMom: number }>();
  for (const p of products) {
    const label = categoryForSource(p, source) || '—';
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
  excludedCategories: [],
  categorySource: 'product',
});

interface SalesBaseSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  initialScope?: SalesBaseScope | null;
  onContinue: (scope: SalesBaseScope) => void;
  hasConnector?: boolean;
  hasFreshWindowedStats?: boolean;
  /** ISO YYYY-MM-DD — date of the first stock snapshot (lifetime baseline). */
  stockMovementBaselineDate?: string | null;
  /** Windows available from stock movement tracking. */
  hasMovementWindows?: { d7: boolean; d30: boolean; d90: boolean; any: boolean };
  onRefreshStats?: () => Promise<void>;
  /** True while the bounded product source is still loading — shows a loading note instead of a false 0. */
  productsLoading?: boolean;
}

export function SalesBaseSetupModal({
  isOpen,
  onClose,
  products,
  initialScope,
  onContinue,
  hasConnector,
  hasFreshWindowedStats,
  stockMovementBaselineDate,
  hasMovementWindows,
  onRefreshStats,
  productsLoading = false,
}: SalesBaseSetupModalProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [refreshDone, setRefreshDone] = useState(false);
  const [preset, setPreset] = useState<SalesBasePresetId>('all');
  const [brandFilter, setBrandFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  // PER-181: the category source is always the product catalog; the field is still emitted so
  // strategies saved with the old 'procurement' toggle keep round-tripping.
  const categorySource: SalesBaseCategorySource = 'product';

  useEffect(() => {
    if (!isOpen) return;
    const s = initialScope ?? defaultScope();
    setPreset(s.preset);
    setBrandFilter(s.brandFilter);
    setCategoryFilter(s.categoryFilter);
    setSearch(s.search);
    setExcludedCategories(s.excludedCategories ?? []);
  }, [isOpen, initialScope]);

  const toggleExcludedCategory = (cat: string) => {
    setExcludedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  };

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
      const c = categoryForSource(p, categorySource);
      if (c) set.add(c);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'el'));
  }, [products, categorySource]);

  const ruleFiltered = useMemo(() => {
    return products.filter(
      (p) =>
        productMatchesSalesBaseTextFilters(
          p,
          brandFilter,
          categoryFilter,
          search,
          excludedCategories,
          categorySource,
        ) && productMatchesSalesBasePreset(p, preset),
    );
  }, [products, brandFilter, categoryFilter, search, preset, excludedCategories, categorySource]);

  const totalMatched = ruleFiltered.length;
  const brandGroups = useMemo(() => buildBrandGroups(ruleFiltered), [ruleFiltered]);
  const categoryGroups = useMemo(
    () => buildCategoryGroups(ruleFiltered, categorySource),
    [ruleFiltered, categorySource],
  );

  // Detect data limitation: brand has no per-window sales nor last_sale_at anywhere.
  // Time-windowed presets are not meaningful in that case (if there is no movement tracking either).
  const lacksTimeWindowSignals = useMemo(() => {
    if (!products.length) return false;
    for (const p of products) {
      if (
        p.last_sale_at != null ||
        p.qty_sold_last_7d != null ||
        p.qty_sold_last_30d != null ||
        p.qty_sold_last_90d != null
      ) {
        return false;
      }
    }
    return true;
  }, [products]);

  // How many days of movement tracking we already have.
  const movementDaysAvailable = useMemo(() => {
    if (!stockMovementBaselineDate) return null;
    const baseline = new Date(stockMovementBaselineDate + 'T00:00:00Z');
    if (Number.isNaN(baseline.getTime())) return null;
    return Math.max(0, Math.floor((Date.now() - baseline.getTime()) / 86400000));
  }, [stockMovementBaselineDate]);

  const handleContinue = () => {
    onContinue({
      preset,
      brandFilter,
      categoryFilter,
      search,
      selectedProductIds: null,
      excludedCategories,
      categorySource,
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
                Ορίστε preset ρυθμού πωλήσεων και φίλτρα. Η στρατηγική εφαρμόζεται σε <strong>όλα</strong> τα SKU που
                πληρούν τα κριτήρια. Παρακάτω εμφανίζεται συνοπτική εικόνα ανά μάρκα και κατηγορία, χωρίς αναλυτική λίστα προϊόντων.
              </p>
            </div>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#F5F5F5] text-[#9CA3AF]">
              <X size={18} />
            </button>
          </div>

          <div className="px-5 py-3 space-y-3 overflow-y-auto flex-1 min-h-0">
            {hasConnector && !hasFreshWindowedStats && onRefreshStats && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 flex gap-2 items-start">
                <Info size={14} className="text-blue-600 mt-0.5 shrink-0" />
                <div className="text-[11px] text-blue-900 leading-snug flex-1">
                  <strong>Τα στοιχεία πωλήσεων ανά χρονικό παράθυρο δεν είναι πρόσφατα.</strong> Πατήστε «Φρεσκάρισμα» για να
                  επανυπολογιστούν τα σήματα 7/30/90 ημερών και η ημερομηνία τελευταίας πώλησης από τα orders του connector.
                </div>
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={async () => {
                    setRefreshing(true);
                    setRefreshDone(false);
                    try {
                      await onRefreshStats();
                      setRefreshDone(true);
                    } finally {
                      setRefreshing(false);
                    }
                  }}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? 'Φρεσκάρισμα…' : refreshDone ? 'Έτοιμο — ξανανοίξτε' : 'Φρεσκάρισμα'}
                </button>
              </div>
            )}
            {/* Stock movement tracking banner — universal source of truth */}
            {movementDaysAvailable != null && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 flex gap-2 items-start">
                <Info size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                <div className="text-[11px] text-emerald-900 leading-snug flex-1">
                  <strong>Παρακολούθηση κινητικότητας αποθέματος ενεργή.</strong> Καταγραφή από{' '}
                  <code>{stockMovementBaselineDate}</code> ({movementDaysAvailable} ημ.).
                  {' '}Διαθέσιμα windows: {hasMovementWindows?.d7 ? '7d ' : ''}
                  {hasMovementWindows?.d30 ? '30d ' : ''}
                  {hasMovementWindows?.d90 ? '90d ' : ''}
                  {!hasMovementWindows?.any && '— θα ενεργοποιηθούν με την πρώτη ολοκληρωμένη μέρα tracking.'}
                  {hasMovementWindows?.any &&
                    ' Τα φίλτρα μειώσεων αποθέματος αποτυπώνουν πωλήσεις net of επιστροφών/ακυρώσεων.'}
                </div>
              </div>
            )}
            {movementDaysAvailable == null && !hasConnector && lacksTimeWindowSignals && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 flex gap-2 items-start">
                <Info size={14} className="text-amber-600 mt-0.5 shrink-0" />
                <div className="text-[11px] text-amber-900 leading-snug">
                  <strong>Δεν υπάρχουν ημερομηνίες πωλήσεων</strong> για αυτό το brand. Η παρακολούθηση κινητικότητας
                  αποθέματος θα ξεκινήσει αυτόματα στο επόμενο sync — εναλλακτικά συμπεριλάβετε στήλη{' '}
                  <code>last_sale_at</code> στο import ή συνδέστε e-commerce connector.
                </div>
              </div>
            )}
            {(() => {
              const allOpt = SALES_BASE_PRESET_OPTIONS.find((o) => o.group === 'all');
              const zeroOpts = SALES_BASE_PRESET_OPTIONS.filter((o) => o.group === 'zero_window');
              const otherOpts = SALES_BASE_PRESET_OPTIONS.filter((o) => o.group === 'other');

              const renderOpt = (opt: typeof SALES_BASE_PRESET_OPTIONS[number]) => (
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
              );

              return (
                <div className="space-y-2">
                  {allOpt && renderOpt(allOpt)}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] px-1">
                        Μηδενικές πωλήσεις σε χρονικό παράθυρο
                      </p>
                      <div className="space-y-2">{zeroOpts.map(renderOpt)}</div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] px-1">
                        Χωρίς πωλήσεις και στασιμότητα
                      </p>
                      <div className="space-y-2">{otherOpts.map(renderOpt)}</div>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="flex flex-wrap items-end gap-2">
              <div className="flex-1 min-w-[140px]">
                <label className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">Brand / προμηθευτής</label>
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

            {categoryOptions.length > 1 && (
              <div className="rounded-xl border border-[#E5E5E5] bg-[#FAFAFA] px-3 py-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">
                    Εξαίρεση κατηγοριών
                  </label>
                  {excludedCategories.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExcludedCategories([])}
                      className="text-[10px] text-[var(--nts-accent)] hover:underline"
                    >
                      Καθαρισμός
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {categoryOptions.map((c) => {
                    const active = excludedCategories.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleExcludedCategory(c)}
                        className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
                          active
                            ? 'bg-red-50 border-red-300 text-red-700 line-through'
                            : 'bg-white border-[#E5E5E5] text-[#4B5563] hover:border-[var(--nts-accent)]/40'
                        }`}
                        title={active ? 'Κάντε κλικ για επανένταξη' : 'Κάντε κλικ για εξαίρεση'}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-[#9CA3AF] mt-1.5">
                  Χρήσιμο για κατηγορίες-status (π.χ. «Επί παραγγελία», «Προς κατάργηση») που εκ φύσεως δεν έχουν
                  πωλήσεις.
                </p>
              </div>
            )}

            <div className="rounded-lg border border-[var(--nts-accent)]/25 bg-[var(--nts-accent)]/5 px-3 py-2">
              <p className="text-xs font-medium text-[#1A1A1A]">
                {productsLoading && totalMatched === 0 ? (
                  <>Φόρτωση καταλόγου προϊόντων…</>
                ) : (
                  <>
                    Σύνολο <span className="text-[var(--nts-accent)]">{totalMatched.toLocaleString('el-GR')}</span> SKU
                    ταιριάζουν με τα κριτήρια.
                  </>
                )}
                {excludedCategories.length > 0 && (
                  <span className="text-[10px] text-[#6B7280] font-normal ml-1">
                    (εξαιρούνται {excludedCategories.length} κατηγορίες)
                  </span>
                )}
              </p>
              <p className="text-[10px] text-[#6B7280] mt-1">
                Στην επόμενη οθόνη επιλέγετε διάρκεια· η στρατηγική ισχύει για όλα αυτά τα SKU (όχι επιλογή ανά
                γραμμή).
              </p>
            </div>

            {totalMatched > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {renderGroupTable('Ανά Brand / προμηθευτή', brandS.shown, brandS.rest, brandGroups.length)}
                {renderGroupTable('Ανά κατηγορία', catS.shown, catS.rest, categoryGroups.length)}
              </div>
            )}

            {totalMatched === 0 && !productsLoading && (
              <p className="text-xs text-center text-[#9CA3AF] py-6">Δεν βρέθηκε κανένα SKU που να ικανοποιεί τα επιλεγμένα φίλτρα ή preset.</p>
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
