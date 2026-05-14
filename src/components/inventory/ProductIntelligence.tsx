import React, { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package,
  AlertTriangle,
  AlertCircle,
  Info,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  FileSpreadsheet,
  Filter,
  TrendingUp,
  TrendingDown,
  Trash2,
  Loader2
} from 'lucide-react';
import { Card, Badge, Button, ProgressBar, Tooltip, useToast, AlertsBanner, PageHeader, DataSourcePill } from '../common';
import { useProducts } from '../../hooks/useProducts';
import { useProductSource } from '../../hooks/useProductSource';
import { useBrand } from '../../hooks/useBrand';
import { useSuppliers } from '../../hooks/useSuppliers';
import { usePlan } from '../../hooks/usePlan';
import { useProcurement } from '../../hooks/useProcurement';
import { useProductAggregates } from '../../hooks/useAggregates';
import { usePriceBenchmarks } from '../../hooks/usePriceBenchmarks';
import { useProductIntelligenceAggregate } from '../../hooks/useProductIntelligenceAggregate';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import { FirestoreService } from '../../services/firestore';
import {
  getDaysOfStock,
  getEffectiveStockLevel,
  getProductYmdForFilter,
  resolveStockHealth,
} from '../../utils/productUtils';
import { classifyProcurementInventoryRow } from '../../utils/procurementInventoryClassify';
import { DateRangePicker } from '../ui/DateRangePicker';
import { ExportModal } from './ExportModal';
import { ProductCharts } from './ProductCharts';
import { downloadProductIntelligenceCsv, downloadProductIntelligenceXlsx } from '../../utils/productIntelligenceExport';
import type { Product, InventorySummary, InventoryAlert } from '../../types';
import type { ProductIntelligenceBucket } from '../../services/productIntelligenceAggregate';

type SortField = 'name' | 'margin_percentage' | 'stock_level' | 'stock_age_days' | 'price';
type SortDirection = 'asc' | 'desc';

const PRODUCT_INTELLIGENCE_ROW_LIMIT = 5000;
const PRODUCT_INTELLIGENCE_BENCHMARK_LIMIT = 5000;
const LARGE_CATALOG_ALERT_THRESHOLD = 10000;

const EMPTY_CATEGORY_ID = '__EMPTY_CAT__';
const EMPTY_TAG_ID = '__EMPTY_TAG__';
/** Σταθερές τιμές priority_tag (inventory intelligence) — εμφανίζονται πάντα στο φίλτρο ακόμη κι αν το client catalog δεν φέρει το πεδίο. */
const STOCK_INTELLIGENCE_TAG_IDS = ['healthy', 'low', 'excess', 'dead'] as const;

function categoryIdForProduct(p: Product): string {
  const c = (p.category ?? '').trim();
  return c || EMPTY_CATEGORY_ID;
}

function tagIdForProduct(p: Product): string {
  const t = (p.priority_tag ?? '').trim();
  return t || EMPTY_TAG_ID;
}

type ExcelFilterOption = { id: string; label: string };

interface ColumnExcelFilterProps {
  label: string;
  options: ExcelFilterOption[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
  /** excel: null = όλα τσεκαρισμένα. additive: null/[] = κανένα τσέκ = χωρίς φίλτρο (όλες οι γραμμές). */
  selectionMode?: 'excel' | 'additive';
}

function ColumnExcelFilter({
  label,
  options,
  value,
  onChange,
  selectionMode = 'excel',
}: ColumnExcelFilterProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = React.useRef<HTMLDivElement>(null);
  const allIds = useMemo(() => options.map((o) => o.id), [options]);
  const selected = useMemo(() => {
    if (selectionMode === 'additive') {
      if (value == null || value.length === 0) return new Set<string>();
      const allow = new Set(allIds);
      return new Set(value.filter((id) => allow.has(id)));
    }
    if (value == null) return new Set(allIds);
    if (value.length === 0) return new Set<string>();
    const allow = new Set(allIds);
    return new Set(value.filter((id) => allow.has(id)));
  }, [value, allIds, selectionMode]);

  useEffect(() => {
    if (!open) {
      setQ('');
      return;
    }
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filteredOpts = useMemo(
    () =>
      options.filter(
        (o) =>
          o.label.toLowerCase().includes(q.toLowerCase()) ||
          o.id.toLowerCase().includes(q.toLowerCase()),
      ),
    [options, q],
  );

  const toggle = (id: string) => {
    if (selectionMode === 'additive') {
      const startSelected =
        value != null && value.length > 0 ? new Set(value.filter((x) => allIds.includes(x))) : new Set<string>();
      const next = new Set(startSelected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0 || next.size === allIds.length) onChange(null);
      else onChange([...next]);
      return;
    }
    const startSelected =
      value == null || value.length === 0
        ? new Set(allIds)
        : new Set(value.filter((x) => allIds.includes(x)));
    const next = new Set(startSelected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    if (next.size === 0) {
      onChange([]);
      return;
    }
    if (next.size === allIds.length) onChange(null);
    else onChange([...next]);
  };

  const selectedCount = value == null || value.length === 0 ? allIds.length : selected.size;
  const summary =
    selectionMode === 'additive'
      ? value == null || value.length === 0
        ? 'Όλα'
        : `${selected.size}/${allIds.length}`
      : value === null
        ? 'Όλα'
        : value.length === 0
          ? 'Καμία'
          : `${selectedCount}/${allIds.length}`;

  if (options.length === 0) {
    return (
      <div className="flex flex-col gap-1 min-w-[140px] opacity-60">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{label}</span>
        <span className="text-xs text-[#9CA3AF] py-2">—</span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative flex flex-col gap-1 min-w-[160px]">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between gap-2 px-3 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm hover:border-[var(--nts-accent)] transition-all text-left w-full"
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="truncate flex items-center gap-1.5 min-w-0">
          <Filter size={14} className="text-[#9CA3AF] shrink-0" aria-hidden />
          <span className="text-[#374151]">{summary}</span>
        </span>
        <ChevronDown size={14} className="text-[#9CA3AF] shrink-0" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-[#E5E5E5] rounded-lg shadow-lg max-h-72 flex flex-col min-w-[260px] w-max max-w-[min(100vw-2rem,320px)]">
          <div className="p-2 border-b border-[#E5E5E5]">
            <input
              type="search"
              placeholder="Αναζήτηση στη λίστα…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-[#E5E7EB] rounded-md focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/30"
            />
          </div>
          <div className="overflow-y-auto max-h-52 p-1">
            {filteredOpts.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#F9FAFB] cursor-pointer text-sm text-[#374151]"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o.id)}
                  onChange={() => toggle(o.id)}
                  className="rounded border-[#D1D5DB] text-[var(--nts-accent)] focus:ring-[var(--nts-accent)]/30"
                />
                <span className="truncate">{o.label}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-center p-2.5 border-t border-[#E5E5E5] bg-[#FAFAFA]/90">
            <button
              type="button"
              className="text-xs font-medium text-[var(--nts-accent)] hover:underline whitespace-nowrap px-2 py-1 rounded-md hover:bg-[#FFF7ED]"
              onClick={() => {
                onChange(null);
                setQ('');
              }}
            >
              Επαναφορά φίλτρου (όλα)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function computeInventorySummary(
  products: Product[],
  supplierTodMap?: Map<string, number>,
  useProcurementRowModel?: boolean
): InventorySummary {
  const total = products.length;
  if (total === 0) {
    return {
      total_skus: 0,
      total_value: 0,
      healthy_stock: { count: 0, percentage: 0 },
      excess_stock: { count: 0, percentage: 0, value: 0 },
      dead_stock: { count: 0, percentage: 0, value: 0 },
      low_stock: { count: 0, percentage: 0 },
    };
  }

  let totalValue = 0;
  let healthyCount = 0;
  let excessCount = 0;
  let excessValue = 0;
  let deadCount = 0;
  let deadValue = 0;
  let lowCount = 0;

  for (const p of products) {
    const level = getEffectiveStockLevel(p);
    const price = p.price ?? 0;
    totalValue += level * price;

    const health = resolveStockHealth(p, supplierTodMap, useProcurementRowModel);
    switch (health) {
      case 'dead':
        deadCount++;
        deadValue += level * price;
        break;
      case 'excess':
        excessCount++;
        excessValue += level * price;
        break;
      case 'low':
        lowCount++;
        break;
      default:
        healthyCount++;
    }
  }

  return {
    total_skus: total,
    total_value: Math.round(totalValue),
    healthy_stock: { count: healthyCount, percentage: total ? Math.round((healthyCount / total) * 1000) / 10 : 0 },
    excess_stock: { count: excessCount, percentage: total ? Math.round((excessCount / total) * 1000) / 10 : 0, value: Math.round(excessValue) },
    dead_stock: { count: deadCount, percentage: total ? Math.round((deadCount / total) * 1000) / 10 : 0, value: Math.round(deadValue) },
    low_stock: { count: lowCount, percentage: total ? Math.round((lowCount / total) * 1000) / 10 : 0 },
  };
}

function computeInventoryAlerts(
  products: Product[],
  supplierTodMap?: Map<string, number>,
  useProcurementRowModel?: boolean
): InventoryAlert[] {
  const alerts: InventoryAlert[] = [];
  const classify = (p: Product) => resolveStockHealth(p, supplierTodMap, useProcurementRowModel);
  const deadStock = products.filter((p) => classify(p) === 'dead');
  const excessStock = products.filter((p) => classify(p) === 'excess');
  const highMarginLowStock = products.filter(
    (p) => (p.margin_tier === 'high' || (p.margin_percentage ?? 0) > 25) && classify(p) === 'low'
  );
  if (deadStock.length > 0) {
    const deadMsg = useProcurementRowModel
      ? `${deadStock.length} SKU(s) dead stock (ανενεργό status / αξιολόγηση C / μηδενικό απόθεμα).`
      : `${deadStock.length} SKU(s) χωρίς πωλήσεις (dead stock)`;
    alerts.push({ type: 'critical', message: deadMsg, action: 'Ελέγξτε για clearance' });
  }
  if (excessStock.length > 0) alerts.push({ type: 'warning', message: `${excessStock.length} SKU(s) με πλεόνασμα αποθέματος`, action: 'Δημιουργήστε προσφορές' });
  if (highMarginLowStock.length > 0) alerts.push({ type: 'info', message: `${highMarginLowStock.length} high-margin items με low stock`, action: 'Πρόταση αναπλήρωσης' });
  return alerts.length > 0 ? alerts : [];
}

/** Skeleton: ίδια δομή με τη σελίδα (κάρτες + πίνακας) — όχι κενή οθόνη κατά τη φόρτωση. */
function ProductIntelligenceSkeleton() {
  return (
    <div className="space-y-6">
      <div
        className="rounded-xl border border-[var(--nts-accent)]/25 bg-gradient-to-r from-orange-50/90 via-amber-50/50 to-white px-4 py-3.5 flex flex-wrap items-center gap-3 text-sm shadow-sm"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-5 w-5 animate-spin text-[var(--nts-accent)] flex-shrink-0" aria-hidden />
        <span className="font-semibold text-[#9A3412]">Φόρτωση δεδομένων προϊόντων…</span>
        <span className="text-[#78716C] text-xs sm:text-sm">
          Εμφανίζεται το layout· τα νούμερα ενημερώνονται όταν ολοκληρωθεί το sync.
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-[#E8E8E8] bg-white p-4 h-[108px] shadow-sm"
          >
            <div className="h-3 w-28 bg-[#E5E7EB] rounded-md mb-4 animate-pulse" />
            <div className="h-8 w-24 bg-[#E5E7EB] rounded-md animate-pulse" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-[88px] rounded-xl border border-[#E8E8E8] bg-[#FAFAFA] animate-pulse" />
        ))}
      </div>

      <Card padding="none" className="overflow-hidden border-[#E8E8E8] shadow-sm">
        <div className="p-4 border-b border-[#E5E5E5] flex flex-wrap gap-3">
          <div className="h-10 flex-1 min-w-[200px] max-w-md bg-[#F3F4F6] rounded-lg animate-pulse" />
          <div className="h-10 w-36 bg-[#F3F4F6] rounded-lg animate-pulse hidden sm:block" />
          <div className="h-10 w-36 bg-[#F3F4F6] rounded-lg animate-pulse hidden md:block" />
        </div>
        <div className="overflow-x-auto max-h-[min(52vh,480px)]">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F5F5F5]">
                {['Προϊόν', 'Margin', 'Stock', 'DOS', 'Τιμή'].map((label, i) => (
                  <th key={label + i} className="px-3 py-2.5 text-left">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                      {label}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 14 }).map((_, row) => (
                <tr key={row} className="border-b border-[#F3F4F6]">
                  <td className="px-3 py-3">
                    <div className="h-4 bg-[#E5E7EB] rounded animate-pulse w-[min(100%,14rem)]" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-4 w-12 bg-[#E5E7EB] rounded animate-pulse" />
                  </td>
                  <td className="px-3 py-3 hidden sm:table-cell">
                    <div className="h-4 w-10 bg-[#E5E7EB] rounded animate-pulse" />
                  </td>
                  <td className="px-3 py-3 hidden md:table-cell">
                    <div className="h-4 w-8 bg-[#E5E7EB] rounded animate-pulse" />
                  </td>
                  <td className="px-3 py-3 hidden sm:table-cell">
                    <div className="h-4 w-16 bg-[#E5E7EB] rounded animate-pulse" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-[#E5E5E5] flex justify-between">
          <div className="h-4 w-48 bg-[#F3F4F6] rounded animate-pulse" />
          <div className="h-9 w-56 bg-[#F3F4F6] rounded-lg animate-pulse" />
        </div>
      </Card>
    </div>
  );
}

interface ProductIntelligenceProps {
  onSectionChange?: (section: string) => void;
}

export function ProductIntelligence({ onSectionChange }: ProductIntelligenceProps = {}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryInclude, setCategoryInclude] = useState<string[] | null>(null);
  const [tagInclude, setTagInclude] = useState<string[] | null>(null);
  const [marginFilter, setMarginFilter] = useState<string>('all');
  const [stockAgeFilter, setStockAgeFilter] = useState<'all' | 'dead' | 'near-dead' | 'high-margin-low-stock'>('all');
  const [stockCardFilter, setStockCardFilter] = useState<'all' | 'healthy' | 'excess' | 'dead' | 'low'>('all');
  const [sortField, setSortField] = useState<SortField>('margin_percentage');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showExportModal, setShowExportModal] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 150;
  /** Φίλτρο περιόδου (εισαγωγή / πρώτη διαθεσιμότητα) — μόνο για εισαγόμενα SKU, όχι ERP procurement */
  const [productDateFrom, setProductDateFrom] = useState('');
  const [productDateTo, setProductDateTo] = useState('');
  const [productDateMode, setProductDateMode] = useState<'imported' | 'first_available'>('imported');

  /** Deep link: `#products?stock=low|dead|excess|healthy` ή `#products?filter=high-margin-low-stock` */
  useEffect(() => {
    const applyFromHash = () => {
      const raw = window.location.hash.replace('#', '');
      const [path, queryString] = raw.split('?');
      if (path !== 'products') return;
      const params = new URLSearchParams(queryString || '');
      const stock = params.get('stock');
      if (stock === 'low' || stock === 'dead' || stock === 'excess' || stock === 'healthy') {
        setStockCardFilter(stock);
        setCurrentPage(1);
      }
      const filter = params.get('filter');
      if (filter === 'high-margin-low-stock') {
        setStockAgeFilter('high-margin-low-stock');
        setCurrentPage(1);
      }
    };
    applyFromHash();
    window.addEventListener('hashchange', applyFromHash);
    return () => window.removeEventListener('hashchange', applyFromHash);
  }, []);

  const { currentBrand } = useBrand();
  const { products: rawProducts, hasImported: rawHasImported, totalCount: rawTotalCount } = useProducts({ maxDocs: PRODUCT_INTELLIGENCE_ROW_LIMIT });
  const {
    products: sourceProducts,
    totalCount: sourceTotalCount,
    hasImported,
    usingProcurement,
    sourceLabel: productDataSourceLabel,
    sourceKind: productSourceKind,
    isLoading: sourceLoading,
  } = useProductSource({ maxProducts: PRODUCT_INTELLIGENCE_ROW_LIMIT });
  const { suppliers } = useSuppliers();
  const { isEnterprise } = usePlan();
  const { data: procData } = useProcurement();
  const { productStats } = useProductAggregates();
  const { benchmarks, count: benchmarkCount } = usePriceBenchmarks({ maxDocs: PRODUCT_INTELLIGENCE_BENCHMARK_LIMIT });
  const serverBucket: ProductIntelligenceBucket =
    stockCardFilter === 'healthy' || stockCardFilter === 'excess' || stockCardFilter === 'dead' || stockCardFilter === 'low'
      ? stockCardFilter
      : 'all';
  const serverIntelligence = useProductIntelligenceAggregate(serverBucket, currentPage);
  const queryClient = useQueryClient();
  const toast = useToast();

  const benchmarkMap = useMemo(() => {
    const m = new Map<string, { priceDiff: number; benchmarkPrice: number }>();
    for (const b of benchmarks) {
      const val = { priceDiff: b.priceDiff, benchmarkPrice: b.benchmarkPrice };
      // Index by GTIN
      if (b.gtin) m.set(b.gtin.toLowerCase(), val);
      // Index by full productId (online:en:GR:SKU)
      if (b.productId) {
        m.set(b.productId.toLowerCase(), val);
        // Extract the last segment (actual SKU) from Merchant-style IDs
        const lastSeg = b.productId.split(':').pop();
        if (lastSeg) m.set(lastSeg.toLowerCase(), val);
      }
      // Index by title (fallback fuzzy)
      if (b.title) m.set(b.title.toLowerCase(), val);
    }
    return m;
  }, [benchmarks]);
  const [isDeleting, setIsDeleting] = useState(false);

  const supplierTodMap = useMemo(() => {
    const m = new Map<string, number>();
    suppliers.forEach(s => m.set(s.name, s.tod));
    return m;
  }, [suppliers]);

  const hasDateFilter = Boolean(productDateFrom && productDateTo);
  const serverFiltersSupported =
    !usingProcurement &&
    !hasDateFilter &&
    !searchQuery.trim() &&
    marginFilter === 'all' &&
    stockAgeFilter === 'all' &&
    categoryInclude === null &&
    (tagInclude == null || tagInclude.length === 0);
  const useServerIntelligence =
    serverFiltersSupported &&
    !!serverIntelligence.aggregate &&
    !!serverIntelligence.page;
  const hasServerAggregate = serverFiltersSupported && !!serverIntelligence.aggregate;
  const totalCatalogCount = usingProcurement
    ? sourceProducts.length
    : (serverIntelligence.aggregate?.totalCount ?? sourceTotalCount ?? rawTotalCount ?? productStats?.totalSkus ?? rawProducts.length);
  const isCatalogTruncated = !usingProcurement && !hasServerAggregate && totalCatalogCount > sourceProducts.length;
  const effectiveSourceLoading = hasServerAggregate ? serverIntelligence.isLoading && !serverIntelligence.page : sourceLoading;

  useEffect(() => {
    if (useServerIntelligence && serverIntelligence.safePage !== currentPage) {
      setCurrentPage(serverIntelligence.safePage);
    }
  }, [useServerIntelligence, serverIntelligence.safePage, currentPage]);

  const productsScopedByDate = useMemo(() => {
    if (hasServerAggregate) return serverIntelligence.page?.products ?? [];
    if (usingProcurement) return sourceProducts;
    if (!hasDateFilter) return sourceProducts;
    return sourceProducts.filter((p) => {
      const ymd = getProductYmdForFilter(p, productDateMode);
      if (!ymd) return false;
      return ymd >= productDateFrom && ymd <= productDateTo;
    });
  }, [hasServerAggregate, serverIntelligence.page, sourceProducts, usingProcurement, hasDateFilter, productDateFrom, productDateTo, productDateMode]);

  /** Σταθερό σύνολο για λίστες φίλτρου (όχι σελιδοποιημένη server σελίδα) — αποφεύγει κατάρρευση Tag/Κατηγορίας όταν αλλάζει το server. */
  const filterOptionsProductScope = useMemo(() => {
    if (usingProcurement) return sourceProducts;
    if (!hasDateFilter) return sourceProducts;
    return sourceProducts.filter((p) => {
      const ymd = getProductYmdForFilter(p, productDateMode);
      if (!ymd) return false;
      return ymd >= productDateFrom && ymd <= productDateTo;
    });
  }, [usingProcurement, sourceProducts, hasDateFilter, productDateFrom, productDateTo, productDateMode]);

  const inventorySummary = useMemo(() => {
    if (usingProcurement) return computeInventorySummary(sourceProducts, supplierTodMap, true);
    if (hasDateFilter) {
      const base = rawProducts.filter((p) => {
        const ymd = getProductYmdForFilter(p, productDateMode);
        if (!ymd) return false;
        return ymd >= productDateFrom && ymd <= productDateTo;
      });
      return computeInventorySummary(base, supplierTodMap, false);
    }
    return computeInventorySummary(rawProducts, supplierTodMap, false);
  }, [rawProducts, sourceProducts, usingProcurement, supplierTodMap, hasDateFilter, productDateFrom, productDateTo, productDateMode]);

  const inventoryAlerts = useMemo(() => {
    if (usingProcurement) return computeInventoryAlerts(sourceProducts, supplierTodMap, true);
    if (!hasDateFilter && totalCatalogCount > LARGE_CATALOG_ALERT_THRESHOLD) return [];
    if (hasDateFilter) {
      const base = rawProducts.filter((p) => {
        const ymd = getProductYmdForFilter(p, productDateMode);
        if (!ymd) return false;
        return ymd >= productDateFrom && ymd <= productDateTo;
      });
      return computeInventoryAlerts(base, supplierTodMap, false);
    }
    return computeInventoryAlerts(rawProducts, supplierTodMap, false);
  }, [rawProducts, sourceProducts, usingProcurement, supplierTodMap, hasDateFilter, productDateFrom, productDateTo, productDateMode, totalCatalogCount]);

  // Procurement-based inventory summary (replaces product-based when available)
  const procInventorySummary = useMemo((): InventorySummary | null => {
    if (!isEnterprise) return null;
    const invRows = (procData.inventory ?? []) as Record<string, unknown>[];
    if (!invRows.length) return null;

    const findCol = (rows: Record<string, unknown>[], keyword: string) => {
      if (!rows.length) return keyword;
      const kUp = keyword.toUpperCase();
      return Object.keys(rows[0]).find(k => k.toUpperCase().includes(kUp)) ?? keyword;
    };
    const parseNum = (v: unknown) => {
      if (v == null || v === '') return 0;
      if (typeof v === 'number') return isNaN(v) ? 0 : v;
      const s = String(v).trim().replace(/\s/g, '');
      if (!s) return 0;
      if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
      return parseFloat(s) || 0;
    };

    const total = invRows.length;
    const stockCol = findCol(invRows, 'ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ');
    const costCol = findCol(invRows, 'ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ');
    const evalCol = findCol(invRows, 'ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ');
    const refillCol = findCol(invRows, 'ΑΝΑΤΡΟΦΟΔΟΣΙΑ');
    const statusCol = findCol(invRows, 'STATUS ΚΩΔΙΚΟΥ');

    let totalValue = 0;
    let healthyCount = 0;
    let excessCount = 0;
    let excessValue = 0;
    let deadCount = 0;
    let deadValue = 0;
    let lowCount = 0;

    for (const row of invRows) {
      const stock = parseNum(row[stockCol]);
      const cost = parseNum(row[costCol]);
      const evalGrade = String(row[evalCol] ?? '').trim().toUpperCase();
      const needsRefill = parseNum(row[refillCol]) > 0;
      const status = String(row[statusCol] ?? '').trim().toUpperCase();
      const itemValue = stock * cost;
      totalValue += itemValue;

      const bucket = classifyProcurementInventoryRow({
        stock,
        evalGrade,
        needsRefill,
        statusUpper: status,
      });
      if (bucket === 'dead') {
        deadCount++;
        deadValue += itemValue;
      } else if (bucket === 'low') {
        lowCount++;
      } else if (bucket === 'healthy') {
        healthyCount++;
      } else {
        excessCount++;
        excessValue += itemValue;
      }
    }

    return {
      total_skus: total,
      total_value: Math.round(totalValue),
      healthy_stock: { count: healthyCount, percentage: total ? Math.round((healthyCount / total) * 1000) / 10 : 0 },
      excess_stock: { count: excessCount, percentage: total ? Math.round((excessCount / total) * 1000) / 10 : 0, value: Math.round(excessValue) },
      dead_stock: { count: deadCount, percentage: total ? Math.round((deadCount / total) * 1000) / 10 : 0, value: Math.round(deadValue) },
      low_stock: { count: lowCount, percentage: total ? Math.round((lowCount / total) * 1000) / 10 : 0 },
    };
  }, [isEnterprise, procData.inventory]);

  const procFiscalTurnover = useMemo(() => {
    if (!isEnterprise) return 0;
    const fiscalRows = (procData.fiscal_year ?? []) as Record<string, unknown>[];
    if (!fiscalRows.length) return 0;
    const findCol = (rows: Record<string, unknown>[], keyword: string) => {
      if (!rows.length) return keyword;
      return Object.keys(rows[0]).find(k => k.toUpperCase().includes(keyword.toUpperCase())) ?? keyword;
    };
    const parseNum = (v: unknown) => {
      if (v == null || v === '') return 0;
      if (typeof v === 'number') return isNaN(v) ? 0 : v;
      const s = String(v).trim().replace(/\s/g, '');
      if (s.includes(',')) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
      return parseFloat(s) || 0;
    };
    const turnoverCol = findCol(fiscalRows, 'ΤΖΙΡΟΣ');
    return Math.round(fiscalRows.reduce((s, r) => s + parseNum(r[turnoverCol]), 0));
  }, [isEnterprise, procData.fiscal_year]);

  const aggregateInventorySummary = useMemo((): InventorySummary | null => {
    if (usingProcurement || hasDateFilter || !productStats || productStats.totalSkus !== totalCatalogCount) return null;
    const total = productStats.totalSkus || 0;
    const percentage = (count: number) => total ? Math.round((count / total) * 1000) / 10 : 0;

    return {
      total_skus: total,
      total_value: Math.round(productStats.totalInventoryValue || 0),
      healthy_stock: {
        count: productStats.healthyStock?.count ?? 0,
        percentage: percentage(productStats.healthyStock?.count ?? 0),
      },
      excess_stock: {
        count: productStats.excessStock?.count ?? 0,
        percentage: percentage(productStats.excessStock?.count ?? 0),
        value: Math.round(productStats.excessStock?.value ?? 0),
      },
      dead_stock: {
        count: productStats.deadStock?.count ?? 0,
        percentage: percentage(productStats.deadStock?.count ?? 0),
        value: Math.round(productStats.deadStock?.value ?? 0),
      },
      low_stock: {
        count: productStats.lowStock?.count ?? 0,
        percentage: percentage(productStats.lowStock?.count ?? 0),
      },
    };
  }, [usingProcurement, hasDateFilter, productStats, totalCatalogCount]);

  // Use procurement data when available, then precomputed aggregates for large imports.
  const displaySummary = procInventorySummary ?? (hasServerAggregate ? serverIntelligence.aggregate?.summary ?? null : null) ?? aggregateInventorySummary ?? inventorySummary;

  const categoryOptions = useMemo((): ExcelFilterOption[] => {
    const map = new Map<string, string>();
    for (const p of filterOptionsProductScope) {
      const id = categoryIdForProduct(p);
      const label =
        id === EMPTY_CATEGORY_ID ? '(Κενή κατηγορία)' : (p.category ?? '').trim() || '(Κενή κατηγορία)';
      if (!map.has(id)) map.set(id, label);
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'el'));
  }, [filterOptionsProductScope]);

  const tagOptions = useMemo((): ExcelFilterOption[] => {
    const map = new Map<string, string>();
    for (const id of STOCK_INTELLIGENCE_TAG_IDS) {
      map.set(id, id);
    }
    let hasEmpty = false;
    for (const p of filterOptionsProductScope) {
      const id = tagIdForProduct(p);
      if (id === EMPTY_TAG_ID) {
        hasEmpty = true;
        continue;
      }
      if (!map.has(id)) {
        const raw = (p.priority_tag ?? '').trim();
        map.set(id, raw || id);
      }
    }
    const core: ExcelFilterOption[] = STOCK_INTELLIGENCE_TAG_IDS.map((id) => ({ id, label: map.get(id)! }));
    const known = new Set<string>([...STOCK_INTELLIGENCE_TAG_IDS]);
    const extras = [...map.entries()]
      .filter(([id]) => !known.has(id))
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'el'));
    const emptyOpt: ExcelFilterOption[] = hasEmpty ? [{ id: EMPTY_TAG_ID, label: '(Χωρίς tag)' }] : [];
    return [...core, ...extras, ...emptyOpt];
  }, [filterOptionsProductScope]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    const matchesCategory = (p: Product) => {
      if (categoryInclude == null) return true;
      if (categoryInclude.length === 0) return false;
      return categoryInclude.includes(categoryIdForProduct(p));
    };
    const matchesTag = (p: Product) => {
      if (tagInclude == null || tagInclude.length === 0) return true;
      return tagInclude.includes(tagIdForProduct(p));
    };

    const applyExcel = (list: Product[]) =>
      list.filter((p) => matchesCategory(p) && matchesTag(p));

    if (hasServerAggregate) {
      return applyExcel(productsScopedByDate);
    }

    return applyExcel(
      productsScopedByDate.filter((p) => {
        const matchesSearch =
          (p.name ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
          (p.sku ?? '').toLowerCase().includes(searchQuery.toLowerCase());
        const matchesMargin = marginFilter === 'all' || p.margin_tier === marginFilter;

        const health = resolveStockHealth(p, supplierTodMap, usingProcurement);
        let matchesStockAge = true;
        if (stockAgeFilter === 'dead') {
          matchesStockAge = health === 'dead';
        } else if (stockAgeFilter === 'near-dead') {
          const dos = getDaysOfStock(p);
          matchesStockAge = health === 'excess' && (usingProcurement ? true : dos !== Infinity);
        } else if (stockAgeFilter === 'high-margin-low-stock') {
          const isHighMargin = p.margin_tier === 'high' || (p.margin_percentage ?? 0) > 25;
          matchesStockAge = isHighMargin && health === 'low';
        }

        let matchesStockCard = true;
        if (stockCardFilter !== 'all') {
          matchesStockCard = health === stockCardFilter;
        }

        return matchesSearch && matchesMargin && matchesStockAge && matchesStockCard;
      }),
    ).sort((a, b) => {
        const aVal = sortField === 'stock_age_days' ? getDaysOfStock(a) : a[sortField];
        const bVal = sortField === 'stock_age_days' ? getDaysOfStock(b) : b[sortField];
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortDirection === 'asc'
            ? aVal.localeCompare(bVal)
            : bVal.localeCompare(aVal);
        }
        return sortDirection === 'asc'
          ? (aVal as number) - (bVal as number)
          : (bVal as number) - (aVal as number);
      });
  }, [
    hasServerAggregate,
    productsScopedByDate,
    searchQuery,
    categoryInclude,
    tagInclude,
    marginFilter,
    stockAgeFilter,
    stockCardFilter,
    sortField,
    sortDirection,
    supplierTodMap,
    usingProcurement,
  ]);

  const serverFilteredTotal = hasServerAggregate ? (serverIntelligence.page?.totalRows ?? filteredProducts.length) : filteredProducts.length;
  const totalPages = hasServerAggregate
    ? Math.max(1, serverIntelligence.aggregate?.pagesByBucket?.[serverBucket] ?? 1)
    : Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const paginatedProducts = hasServerAggregate
    ? filteredProducts
    : filteredProducts.slice(
        (currentPage - 1) * PAGE_SIZE,
        currentPage * PAGE_SIZE
      );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryInclude, tagInclude, marginFilter, stockAgeFilter, stockCardFilter, sortField, sortDirection, productDateFrom, productDateTo, productDateMode]);

  const handleQuickExportCsv = () => {
    if (filteredProducts.length === 0) {
      toast.error('Δεν υπάρχουν γραμμές για εξαγωγή.');
      return;
    }
    downloadProductIntelligenceCsv(filteredProducts, currentBrand?.name);
    toast.success(`Έγινε λήψη CSV (${formatNumber(filteredProducts.length)} γραμμές).`);
  };

  const handleQuickExportXlsx = async () => {
    if (filteredProducts.length === 0) {
      toast.error('Δεν υπάρχουν γραμμές για εξαγωγή.');
      return;
    }
    try {
      await downloadProductIntelligenceXlsx(filteredProducts, currentBrand?.name);
      toast.success(`Έγινε λήψη Excel (${formatNumber(filteredProducts.length)} γραμμές).`);
    } catch (e) {
      console.error(e);
      toast.error('Σφάλμα εξαγωγής Excel. Δοκιμάστε CSV.');
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleDeleteProducts = async () => {
    if (!currentBrand?.id) return;
    if (!window.confirm(`Διαγραφή όλων των προϊόντων (${formatNumber(totalCatalogCount)}) για το brand "${currentBrand.name}"; Αυτή η ενέργεια δεν αναιρείται.`)) return;
    setIsDeleting(true);
    try {
      await FirestoreService.deleteCollection('products', currentBrand.id);
      queryClient.invalidateQueries({ queryKey: ['products', currentBrand.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Τα προϊόντα διαγράφηκαν επιτυχώς.');
    } catch (e) {
      toast.error(`Σφάλμα διαγραφής: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!effectiveSourceLoading && !hasImported && !usingProcurement && !serverIntelligence.aggregate && !serverIntelligence.isBuilding) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Product Intelligence</h2>}
          description={
            <p className="text-sm text-[#4A4A4A] sm:text-base">Παρακολούθηση αποθέματος και απόδοσης προϊόντων</p>
          }
        />
        <Card padding="lg" className="text-center py-12">
          <p className="text-[#4A4A4A] mb-4">
            Δεν υπάρχουν imported προϊόντα ακόμα.
          </p>
          <p className="text-sm text-[#4A4A4A]">
            Ανεβάστε αρχείο ή συνδέστε πλατφόρμα από την{' '}
            <button
              type="button"
              onClick={() => onSectionChange?.('data-products')}
              className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
            >
              καρτέλα εισαγωγής προϊόντων
            </button>
            .
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        toolbarAriaLabel="Εξαγωγή και διαγραφή προϊόντων"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Product Intelligence</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
            Παρακολούθηση αποθέματος και απόδοσης προϊόντων
          </p>
        }
        meta={
          effectiveSourceLoading ? (
            <p className="text-xs font-medium text-[var(--nts-accent)] sm:text-sm flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" aria-hidden />
              Φόρτωση inventory…
            </p>
          ) : sourceProducts.length > 0 || hasServerAggregate ? (
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#22C55E] sm:text-sm">
              <span>
                {hasServerAggregate
                  ? `Showing ${formatNumber(totalCatalogCount)} ${serverIntelligence.aggregate?.sourceLabel === 'ERP' ? 'ERP' : 'catalog'} product(s)`
                  : `Showing ${isCatalogTruncated ? `${sourceProducts.length} of ${totalCatalogCount}` : sourceProducts.length} ${usingProcurement ? 'procurement' : productSourceKind === 'erp' ? 'ERP' : 'imported'} product(s)`}
              </span>
              <DataSourcePill
                label="Source"
                value={hasServerAggregate ? serverIntelligence.aggregate?.sourceLabel ?? productDataSourceLabel : productDataSourceLabel}
                tone={(hasServerAggregate ? serverIntelligence.aggregate?.sourceLabel === 'ERP' : productSourceKind === 'erp') ? 'warning' : 'success'}
              />
            </div>
          ) : null
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={handleDeleteProducts}
              disabled={effectiveSourceLoading || isDeleting || !rawHasImported}
              className="min-h-[36px] flex-1 basis-[calc(50%-0.1875rem)] text-[#DC2626] hover:bg-[#FEE2E2] sm:flex-initial sm:basis-auto"
            >
              {isDeleting ? (
                'Διαγραφή…'
              ) : (
                <>
                  <span className="sm:hidden">Διαγραφή</span>
                  <span className="hidden sm:inline">Διαγραφή δεδομένων</span>
                </>
              )}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Download size={14} />}
              onClick={() => setShowExportModal(true)}
              disabled={effectiveSourceLoading}
              className="min-h-[36px] flex-1 basis-[calc(50%-0.1875rem)] sm:flex-initial sm:basis-auto"
            >
              <span className="hidden min-[380px]:inline">Εξαγωγή αναφοράς</span>
              <span className="min-[380px]:hidden">Εξαγωγή</span>
            </Button>
          </>
        }
      />

      {effectiveSourceLoading ? (
        <ProductIntelligenceSkeleton />
      ) : (
        <>
      {/* Inventory Alerts */}
      <AlertsBanner filterGroup="inventory" maxAlerts={2} compact onNavigate={onSectionChange} />

      {usingProcurement && procInventorySummary && (
        <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3 text-[13px] text-[#374151] shadow-sm">
          <div className="font-semibold text-[#111827] flex items-center gap-2 mb-1.5">
            <Info size={16} className="text-[#6B7280] shrink-0" aria-hidden />
            Κατάσταση αποθέματος από Procurement (ERP)
          </div>
          <p className="leading-relaxed text-[#4B5563]">
            Οι παρακάτω κάρτες και ειδοποιήσεις βασίζονται <strong>απευθείας</strong> στο φύλλο διαχείρισης αποθέματος
            (αξιολόγηση είδους, status κωδικού, ανατροφοδότηση, απόθεμα × κόστος).             Στην <strong>Στρατηγική</strong>, η <strong>«Διάγνωση προτεραιοτήτων»</strong> δείχνει{' '}
            <strong>πλήθη ανά εμπορική ομάδα/bucket</strong> (κατάλογος + πωλήσεις/ζήτηση/κίνηση όπου υπάρχουν). Αυτά τα
            νούμερα <strong>δεν</strong> είναι τα ίδια με τα πλήθη των καρτών dead / excess / low <strong>εδώ</strong>· δεν
            στοχεύουν σε ταύτιση 1-1.
          </p>
        </div>
      )}

      {(isCatalogTruncated || hasServerAggregate) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900 shadow-sm">
          <div className="font-semibold flex items-center gap-2 mb-1">
            <Info size={16} className="shrink-0" aria-hidden />
            Συνοπτική προβολή καταλόγου
          </div>
          <p className="leading-relaxed">
            Τα KPI χρησιμοποιούν τα precomputed aggregates για όλο τον κατάλογο ({formatNumber(totalCatalogCount)} SKUs).
            Ο πίνακας εμφανίζει {formatNumber(hasServerAggregate ? (serverIntelligence.page?.products.length ?? 0) : sourceProducts.length)} προϊόντα στην τρέχουσα προβολή.
          </p>
        </div>
      )}

      {/* Summary Cards — uses procurement data when available */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard
          label="Total SKUs"
          value={formatNumber(displaySummary.total_skus)}
          icon={<Package size={20} />}
          color="#78716C"
          tooltip={procInventorySummary ? 'Σύνολο SKU από Procurement inventory.' : 'Συνολικός αριθμός προϊόντων (SKU) στο inventory.'}
          active={stockCardFilter === 'all'}
          onClick={() => setStockCardFilter('all')}
        />
        <SummaryCard
          label="Healthy Stock"
          value={`${displaySummary.healthy_stock.percentage}%`}
          subValue={formatNumber(displaySummary.healthy_stock.count)}
          icon={<TrendingUp size={20} />}
          color="#22C55E"
          tooltip={procInventorySummary ? 'SKUs αξιολόγησης A — υγιές απόθεμα.' : 'Προϊόντα με διάρκεια αποθέματος μεταξύ TOD/2 και TOD×2.'}
          active={stockCardFilter === 'healthy'}
          onClick={() => setStockCardFilter(stockCardFilter === 'healthy' ? 'all' : 'healthy')}
        />
        <SummaryCard
          label="Excess Stock"
          value={displaySummary.excess_stock.value >= 1000
            ? formatCurrencyCompact(displaySummary.excess_stock.value)
            : `€${formatCurrency(displaySummary.excess_stock.value)}`}
          subValue={`${displaySummary.excess_stock.count} SKUs`}
          icon={<AlertTriangle size={20} />}
          color="#F59E0B"
          tooltip={procInventorySummary ? 'SKUs αξιολόγησης B χωρίς ανάγκη ανατροφοδότησης — πιθανό πλεόνασμα.' : 'Προϊόντα με διάρκεια αποθέματος > TOD×2 (πλεόνασμα).'}
          active={stockCardFilter === 'excess'}
          onClick={() => setStockCardFilter(stockCardFilter === 'excess' ? 'all' : 'excess')}
        />
        <SummaryCard
          label="Dead Stock"
          value={displaySummary.dead_stock.value >= 1000
            ? formatCurrencyCompact(displaySummary.dead_stock.value)
            : `€${formatCurrency(displaySummary.dead_stock.value)}`}
          subValue={`${displaySummary.dead_stock.count} SKUs`}
          icon={<AlertCircle size={20} />}
          color="#EF4444"
          tooltip={procInventorySummary ? 'SKUs ανενεργά ή αξιολόγησης C — δεσμεύουν κεφάλαιο.' : 'Προϊόντα χωρίς πωλήσεις — δεσμεύουν κεφάλαιο.'}
          active={stockCardFilter === 'dead'}
          onClick={() => setStockCardFilter(stockCardFilter === 'dead' ? 'all' : 'dead')}
        />
        <SummaryCard
          label="Low Stock"
          value={`${displaySummary.low_stock.percentage}%`}
          subValue={`${displaySummary.low_stock.count} SKUs`}
          icon={<TrendingDown size={20} />}
          color="#8B5CF6"
          tooltip={procInventorySummary ? 'SKUs σε ανατροφοδότηση — χρειάζονται παραγγελία.' : 'Προϊόντα με διάρκεια αποθέματος ≤ TOD/2 — κίνδυνος εξάντλησης.'}
          active={stockCardFilter === 'low'}
          onClick={() => setStockCardFilter(stockCardFilter === 'low' ? 'all' : 'low')}
        />
      </div>

      {/* Enterprise Procurement Fiscal KPIs */}
      {isEnterprise && procInventorySummary && (
        <div className="flex items-center gap-4 px-4 py-3 bg-gradient-to-r from-[#7C3AED]/5 to-[#2563EB]/5 border border-[#7C3AED]/15 rounded-xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[#7C3AED]/10 text-[#7C3AED] border border-[#7C3AED]/20">
            <Package size={12} /> Procurement
          </span>
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-[#6B7280] flex items-center gap-1">Αξία αποθέματος: <Tooltip content="Σύνολο αξίας (stock × κόστος) από Procurement." size={12} /></span>
              <strong className="text-[#111827]">{formatCurrencyCompact(displaySummary.total_value)}</strong>
            </div>
            {procFiscalTurnover > 0 && (
              <div>
                <span className="text-[#6B7280] flex items-center gap-1">Απολογιστικός τζίρος: <Tooltip content="Σύνολο τζίρου από Procurement fiscal year." size={12} /></span>
                <strong className="text-[#111827]">{formatCurrencyCompact(procFiscalTurnover)}</strong>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {inventoryAlerts.map((alert, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
          >
            <Card
              padding="md"
              className={`
                border-l-4
                ${alert.type === 'critical' ? 'border-l-[#EF4444] bg-[#FEE2E2]' :
                  alert.type === 'warning' ? 'border-l-[#F59E0B] bg-[#FEF3C7]' :
                  'border-l-[#78716C] bg-[#F3F4F6]'}
              `}
            >
              <div className="flex items-start gap-3">
                {alert.type === 'critical' ? (
                  <AlertCircle size={20} className="text-[#EF4444] flex-shrink-0" />
                ) : alert.type === 'warning' ? (
                  <AlertTriangle size={20} className="text-[#F59E0B] flex-shrink-0" />
                ) : (
                  <Info size={20} className="text-[#78716C] flex-shrink-0" />
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#1A1A1A]">{alert.message}</p>
                  <button 
                    className="text-xs font-medium text-[var(--nts-accent)] mt-1 hover:underline cursor-pointer"
                    onClick={() => {
                      // Set filter based on alert type
                      if (alert.type === 'critical') {
                        setStockAgeFilter('dead');
                        setSortField('stock_age_days');
                        setSortDirection('desc');
                      } else if (alert.type === 'warning') {
                        setStockAgeFilter('near-dead');
                        setSortField('stock_age_days');
                        setSortDirection('desc');
                      } else if (alert.type === 'info') {
                        setStockAgeFilter('high-margin-low-stock');
                        setSortField('margin_percentage');
                        setSortDirection('desc');
                      }
                      // Scroll to table
                      setTimeout(() => {
                        const tableElement = document.querySelector('[data-product-table]');
                        tableElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 100);
                    }}
                  >
                    {alert.action} →
                  </button>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Product Table */}
      <Card padding="none" data-product-table>
        {/* Περίοδος ημερομηνίας (εισαγόμενα προϊόντα) */}
        {!usingProcurement && (
          <div className="px-4 pt-4 pb-3 border-b border-[#E5E5E5] flex flex-wrap items-end gap-3 bg-[#FAFAFA]/60">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Βάση ημερομηνίας</span>
              <select
                value={productDateMode}
                onChange={(e) => setProductDateMode(e.target.value as 'imported' | 'first_available')}
                className="min-w-[200px] rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#374151] focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]"
                aria-label="Βάση ημερομηνίας για φίλτρο"
              >
                <option value="imported">Ημερομηνία εισαγωγής</option>
                <option value="first_available">Πρώτη διαθεσιμότητα (SKU)</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Περίοδος</span>
              <DateRangePicker
                from={productDateFrom}
                to={productDateTo}
                onChange={(f, t) => {
                  setProductDateFrom(f);
                  setProductDateTo(t);
                }}
                onClear={() => {
                  setProductDateFrom('');
                  setProductDateTo('');
                }}
              />
            </div>
            {productDateFrom && productDateTo && (
              <p className="text-xs text-[#78716C] max-w-md pb-1">
                Εμφανίζονται SKU με {productDateMode === 'imported' ? 'ημερομηνία εισαγωγής' : 'πρώτη διαθεσιμότητα'} εντός της περιόδου. Προϊόντα χωρίς ημερομηνία αποκλείονται.
              </p>
            )}
          </div>
        )}
        {usingProcurement && (
          <div className="px-4 pt-3 pb-2 border-b border-[#E5E5E5] flex items-start gap-2 text-xs text-[#78716C] bg-amber-50/40">
            <Info size={14} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
            <span>
              Προβολή ERP: η επιλογή περιόδου ημερομηνίας ισχύει για <strong className="font-medium text-[#57534E]">εισαγόμενα</strong> προϊόντα. Στο Enterprise εμφανίζονται τα δεδομένα procurement χωρίς φίλτρο ημερομηνίας.
            </span>
          </div>
        )}
        {/* Filters — φίλτρα τύπου Excel (λίστα τιμών) + εξαγωγή */}
        <div className="p-4 border-b border-[#E5E5E5]">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="relative flex-1 min-w-[200px]">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF] mb-1 block">Προϊόν / SKU</label>
              <Search size={18} className="absolute left-3 top-[26px] text-[#9CA3AF]" />
              <input
                type="text"
                placeholder="Όνομα ή SKU…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all"
              />
            </div>
            <ColumnExcelFilter
              label="Κατηγορία"
              options={categoryOptions}
              value={categoryInclude}
              onChange={setCategoryInclude}
            />
            <ColumnExcelFilter
              label="Tag"
              options={tagOptions}
              value={tagInclude}
              onChange={setTagInclude}
              selectionMode="additive"
            />
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Margin tier</span>
              <DropdownFilter
                value={marginFilter}
                onChange={setMarginFilter}
                options={[
                  { value: 'all', label: 'Όλα τα margins' },
                  { value: 'high', label: 'Υψηλό margin' },
                  { value: 'medium', label: 'Μέτριο margin' },
                  { value: 'low', label: 'Χαμηλό margin' },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-end gap-2 sm:ml-auto">
              <div className="text-sm text-[#4A4A4A] min-w-[120px]">
                {formatNumber(serverFilteredTotal)} γραμμές
                {isCatalogTruncated ? ` (loaded ${formatNumber(sourceProducts.length)})` : ''}
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<FileText size={14} />}
                onClick={handleQuickExportCsv}
                disabled={effectiveSourceLoading || filteredProducts.length === 0}
                className="shrink-0"
                title="Εξαγωγή φιλτραρισμένων σε CSV"
              >
                CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<FileSpreadsheet size={14} />}
                onClick={() => void handleQuickExportXlsx()}
                disabled={effectiveSourceLoading || filteredProducts.length === 0}
                className="shrink-0"
                title="Εξαγωγή φιλτραρισμένων σε Excel"
              >
                Excel
              </Button>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-[#F5F5F5]">
                <th className="px-3 py-2 text-left text-[11px] font-medium text-[#4A4A4A]">
                  <button
                    onClick={() => handleSort('name')}
                    className="flex items-center gap-1 hover:text-[#1A1A1A]"
                  >
                    Product
                    <SortIcon field="name" current={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-[#4A4A4A] hidden lg:table-cell">
                  <span className="inline-flex items-center gap-1">
                    Category
                    <Tooltip content="Κατηγορία προϊόντος (π.χ. από DSS: Προμηθευτής)." size={12} />
                  </span>
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-[#4A4A4A]">
                  <button
                    onClick={() => handleSort('margin_percentage')}
                    className="flex items-center gap-1 hover:text-[#1A1A1A]"
                  >
                    Margin
                    <SortIcon field="margin_percentage" current={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-[#4A4A4A] hidden sm:table-cell">
                  <button
                    onClick={() => handleSort('stock_level')}
                    className="flex items-center gap-1 hover:text-[#1A1A1A]"
                  >
                    <Tooltip content="Διαθέσιμο απόθεμα ανά SKU. Όπου υπάρχει ERP ανάλυση, εμφανίζεται και το stock on hand." size={12}>
                      Stock
                    </Tooltip>
                    <SortIcon field="stock_level" current={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-[#4A4A4A] hidden md:table-cell">
                  <Tooltip content="Εκτιμώμενες ημέρες αποθέματος βάσει ρυθμού πωλήσεων (Days of Stock)." size={12}>
                    <button
                      onClick={() => handleSort('stock_age_days')}
                      className="flex items-center gap-1 hover:text-[#1A1A1A]"
                    >
                      DOS
                      <SortIcon field="stock_age_days" current={sortField} direction={sortDirection} />
                    </button>
                  </Tooltip>
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-[#4A4A4A] hidden lg:table-cell">
                  Tag
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-[#4A4A4A] hidden sm:table-cell">
                  <button
                    onClick={() => handleSort('price')}
                    className="flex items-center gap-1 hover:text-[#1A1A1A]"
                  >
                    Price
                    <SortIcon field="price" current={sortField} direction={sortDirection} />
                  </button>
                </th>
                {benchmarkCount > 0 && (
                  <th className="px-3 py-2 text-left text-[11px] font-medium text-[#4A4A4A] hidden lg:table-cell">
                    <Tooltip content="Απόκλιση τιμής σε σχέση με τη μέση τιμή αγοράς (Google Merchant Center)." size={12}>
                      vs Market
                    </Tooltip>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {paginatedProducts.map((product, index) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    index={index}
                    supplierTodMap={supplierTodMap}
                    benchmarkMap={benchmarkCount > 0 ? benchmarkMap : undefined}
                    useProcurementRowModel={usingProcurement || hasServerAggregate}
                  />
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-[#E5E5E5] flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[#4A4A4A]">
            {serverFilteredTotal === 0
              ? 'Δεν βρέθηκαν προϊόντα'
              : `Εμφανίζονται ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, serverFilteredTotal)} από ${formatNumber(serverFilteredTotal)} προϊόντα${isCatalogTruncated ? ` (loaded set: ${formatNumber(sourceProducts.length)} / ${formatNumber(totalCatalogCount)})` : ''}`}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<ChevronLeft size={16} />}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              Προηγούμενα
            </Button>
            <span className="text-sm text-[#4A4A4A] px-2">
              Σελίδα {currentPage} από {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              icon={<ChevronRight size={16} />}
              iconPosition="right"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
            >
              Επόμενα
            </Button>
          </div>
        </div>
      </Card>

      {/* Export Modal */}
      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        filteredProducts={filteredProducts}
        onShowCharts={() => setShowCharts(true)}
        brandName={currentBrand?.name}
      />

      {/* Charts Modal */}
      <ProductCharts
        isOpen={showCharts}
        onClose={() => setShowCharts(false)}
        products={filteredProducts}
        supplierTodMap={supplierTodMap}
        useProcurementRowModel={usingProcurement}
      />
        </>
      )}
    </div>
  );
}

interface SummaryCardProps {
  label: string;
  value: string;
  subValue?: string;
  icon: React.ReactNode;
  color: string;
  tooltip?: string;
  active?: boolean;
  onClick?: () => void;
}

function SummaryCard({ label, value, subValue, icon, color, tooltip, active, onClick }: SummaryCardProps) {
  return (
    <Card
      padding="md"
      hover
      className="h-full cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: `${color}20` }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[#4A4A4A]">
            {tooltip ? <Tooltip content={tooltip}>{label}</Tooltip> : label}
          </p>
          <p className="text-xl font-bold text-[#1A1A1A] font-mono">{value}</p>
          {subValue && (
            <p className="text-xs text-[#9CA3AF]">{subValue}</p>
          )}
        </div>
        <div className="w-2 h-2 rounded-full flex-shrink-0 mt-2 transition-colors duration-200" style={{ backgroundColor: active ? color : 'transparent' }} />
      </div>
      <div className="h-0.5 rounded-full mt-3 -mb-1 transition-colors duration-200" style={{ backgroundColor: active ? color : 'transparent' }} />
    </Card>
  );
}

interface ProductRowProps {
  product: Product;
  supplierTodMap?: Map<string, number>;
  benchmarkMap?: Map<string, { priceDiff: number; benchmarkPrice: number }>;
  index: number;
  useProcurementRowModel?: boolean;
}

function ProductRow({ product, index, supplierTodMap, benchmarkMap, useProcurementRowModel }: ProductRowProps) {
  const health = resolveStockHealth(product, supplierTodMap, useProcurementRowModel);
  const effectiveStock = getEffectiveStockLevel(product);
  const onHandStock = product.stock_on_hand;
  const availableStock = product.available_stock;
  const healthColor =
    health === 'dead' ? '#EF4444' :
    health === 'excess' ? '#F59E0B' :
    health === 'low' ? '#8B5CF6' :
    '#22C55E';
  const stockColor = healthColor;
  const ageColor = healthColor;

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: index * 0.02 }}
      className="border-b border-[#E5E5E5] hover:bg-[#F5F5F5] transition-colors"
    >
      <td className="px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[#1A1A1A] truncate">
            {product.name}
          </p>
          <p className="text-[10px] text-[#9CA3AF] truncate">{product.sku}</p>
        </div>
      </td>
      <td className="px-3 py-2 hidden lg:table-cell">
        <span className="text-xs text-[#4A4A4A] truncate block max-w-[120px]">{product.category}</span>
      </td>
      <td className="px-3 py-2">
        <Badge
          variant={
            product.margin_tier === 'high' ? 'success' :
            product.margin_tier === 'medium' ? 'warning' : 'danger'
          }
          size="sm"
        >
          {formatPercent(product.margin_percentage ?? 0, 0)}
        </Badge>
      </td>
      <td className="px-3 py-2 hidden sm:table-cell">
        <div className="min-w-[92px] space-y-1">
          <div className="flex items-center gap-2">
            <ProgressBar
              value={effectiveStock}
              max={Math.max(product.stock_capacity ?? effectiveStock, effectiveStock, 1)}
              color={stockColor}
              size="sm"
              className="w-10"
            />
            <span className="text-xs font-semibold tabular-nums text-[#1A1A1A]">
              {formatNumber(effectiveStock)}
            </span>
          </div>
          {typeof onHandStock === 'number' && onHandStock !== effectiveStock ? (
            <div className="text-[10px] text-[#9CA3AF]">
              On hand {formatNumber(onHandStock)}
            </div>
          ) : null}
          {typeof availableStock === 'number' && typeof onHandStock === 'number' && availableStock !== onHandStock ? (
            <div className="text-[10px] text-[#9CA3AF]">
              Available {formatNumber(availableStock)}
            </div>
          ) : null}
        </div>
      </td>
      <td className="px-3 py-2 hidden md:table-cell">
        <span
          className="text-xs font-mono"
          style={{ color: ageColor }}
        >
          {(() => {
            const dos = getDaysOfStock(product);
            if (useProcurementRowModel && dos === Infinity) {
              return <span className="text-[#9CA3AF]">—</span>;
            }
            return dos === Infinity ? '∞' : `${Math.round(dos)}d`;
          })()}
        </span>
      </td>
      <td className="px-3 py-2 hidden lg:table-cell">
        {product.priority_tag ? (
          <Badge
            variant={
              product.priority_tag === 'dead' ? 'danger' :
              product.priority_tag === 'low' ? 'warning' :
              product.priority_tag === 'healthy' ? 'success' :
              product.priority_tag === 'excess' ? 'orange' :
              product.priority_tag === 'Brand Push' ? 'info' :
              product.priority_tag === 'New Launch' ? 'success' :
              product.priority_tag === 'Best Seller' ? 'orange' :
              product.priority_tag === 'Clearance' ? 'warning' : 'default'
            }
            size="sm"
          >
            {product.priority_tag}
          </Badge>
        ) : (
          <span className="text-[10px] text-[#9CA3AF]">—</span>
        )}
      </td>
      <td className="px-3 py-2 hidden sm:table-cell">
        <span className="text-xs font-mono text-[#1A1A1A]">
          €{formatCurrency(product.price ?? 0, 2)}
        </span>
      </td>
      {benchmarkMap && (
        <td className="px-3 py-2 hidden lg:table-cell">
          {(() => {
            const candidates = [product.sku, product.id, product.name].filter(Boolean).map(k => k!.toLowerCase());
            const bm = candidates.reduce<{ priceDiff: number; benchmarkPrice: number } | undefined>((found, k) => found || benchmarkMap.get(k), undefined);
            if (!bm) return <span className="text-[10px] text-[#9CA3AF]">—</span>;
            const diff = bm.priceDiff;
            return (
              <span className={`text-xs font-mono font-medium ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-green-600' : 'text-[#6B7280]'}`}>
                {diff > 0 ? '+' : ''}{diff}%
              </span>
            );
          })()}
        </td>
      )}
    </motion.tr>
  );
}

function SortIcon({ field, current, direction }: { field: SortField; current: SortField; direction: SortDirection }) {
  if (field !== current) {
    return <ChevronDown size={12} className="opacity-30" />;
  }
  return direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />;
}

interface DropdownFilterProps {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
}

function DropdownFilter({ value, onChange, options }: DropdownFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="px-4 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm flex items-center gap-2 hover:border-[var(--nts-accent)] transition-all"
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={14} className="text-[#9CA3AF]" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-[#E5E5E5] rounded-lg shadow-lg max-h-64 overflow-y-auto min-w-[200px]">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`w-full text-left px-4 py-2 text-sm hover:bg-[#F5F5F5] transition-colors ${
                o.value === value ? 'text-[var(--nts-accent)] font-medium bg-[#FFF7ED]' : 'text-[#1A1A1A]'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
