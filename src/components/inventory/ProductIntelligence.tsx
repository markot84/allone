import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  TrendingUp,
  TrendingDown,
  Trash2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import {
  Card,
  Badge,
  Button,
  ProgressBar,
  Tooltip,
  useToast,
  AlertsBanner,
  PageHeader,
  DataSourcePill,
  ProductThumbnail,
  ColumnExcelFilter,
} from '../common';
import type { ExcelFilterOption } from '../common';
import { useProductThumbnails } from '../../hooks/useProductThumbnails';
import { useBrand } from '../../hooks/useBrand';
import { usePlan } from '../../hooks/usePlan';
import { useProcurementSignals } from '../../hooks/useProcurementSignals';
import { useSuppliers } from '../../hooks/useSuppliers';
import { usePriceBenchmarks } from '../../hooks/usePriceBenchmarks';
import { useProductIntelligenceAggregate } from '../../hooks/useProductIntelligenceAggregate';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import { FirestoreService } from '../../services/firestore';
import {
  buildSupplierTodMap,
  getDaysOfStock,
  getEffectiveStockLevel,
  hasPricePending,
  resolveStockHealth,
} from '../../utils/productUtils';
import { DateRangePicker } from '../ui/DateRangePicker';
import { ExportModal } from './ExportModal';
import { ProductCharts } from './ProductCharts';
import { downloadProductIntelligenceCsv, downloadProductIntelligenceXlsx } from '../../utils/productIntelligenceExport';
import type { Product, InventorySummary, InventoryAlert } from '../../types';
import type { ProductIntelligenceBucket, ProductIntelligenceQuery } from '../../services/productIntelligenceAggregate';
import { refreshProductIntelligenceOnServer } from '../../services/productIntelligenceAggregate';
import { logger } from '../../utils/logger';

type SortField = 'name' | 'margin_percentage' | 'stock_level' | 'stock_age_days' | 'price';
type SortDirection = 'asc' | 'desc';

const PRODUCT_INTELLIGENCE_BENCHMARK_LIMIT = 5000;

const EMPTY_CATEGORY_ID = '__EMPTY_CAT__';
/** Fixed priority_tag values (inventory intelligence) — always shown in the filter even if the client catalog lacks the field. */
const STOCK_INTELLIGENCE_TAG_IDS = ['healthy', 'low', 'excess', 'dead', 'no_stock', 'price_pending'] as const;
const STOCK_TAG_LABELS: Record<string, string> = {
  healthy: 'Healthy Stock', low: 'Low Stock', excess: 'Excess Stock',
  dead: 'Dead Stock', no_stock: 'No Stock', price_pending: 'Price Pending',
};
const productStockLevel = (product: Product): number =>
  Number(product.available_stock ?? product.stock_on_hand ?? product.stock_level ?? 0) || 0;
const productDisplayTag = (product: Product): string =>
  productStockLevel(product) <= 0 ? 'no_stock' : hasPricePending(product) ? 'price_pending' : String(product.priority_tag || '');
const EMPTY_INVENTORY_SUMMARY: InventorySummary = {
  total_skus: 0,
  total_value: 0,
  healthy_stock: { count: 0, percentage: 0 },
  excess_stock: { count: 0, percentage: 0, value: 0 },
  dead_stock: { count: 0, percentage: 0, value: 0 },
  low_stock: { count: 0, percentage: 0 },
};

/** Skeleton: same structure as the page (cards + table) — no blank screen while loading. */
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
  const [brandInclude, setBrandInclude] = useState<string[] | null>(null);
  const [tagInclude, setTagInclude] = useState<string[] | null>(null);
  const [includeNoStock, setIncludeNoStock] = useState(false);
  // Default ON: parent grouping is the platform default; no-op for brands without declared relations.
  const [groupByParent, setGroupByParent] = useState(true);
  const [marginFilter, setMarginFilter] = useState<string>('all');
  const [stockAgeFilter, setStockAgeFilter] = useState<'all' | 'dead' | 'near-dead' | 'high-margin-low-stock'>('all');
  const [stockCardFilter, setStockCardFilter] = useState<'all' | 'healthy' | 'excess' | 'dead' | 'low'>('all');
  const [sortField, setSortField] = useState<SortField>('margin_percentage');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showExportModal, setShowExportModal] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 150;
  /** Period filter (import / first availability) — only for imported SKUs, not ERP procurement */
  const [productDateFrom, setProductDateFrom] = useState('');
  const [productDateTo, setProductDateTo] = useState('');
  const [productDateMode, setProductDateMode] = useState<'imported' | 'first_available'>('imported');

  /** Deep link: `#products?stock=low|dead|excess|healthy` or `#products?filter=high-margin-low-stock` */
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
  const brandId = currentBrand?.id ?? null;
  const lowDaysOfCover = currentBrand?.inventoryThresholds?.lowDaysOfCover ?? 30;
  const excessDaysOfCover = currentBrand?.inventoryThresholds?.excessDaysOfCover ?? 120;
  const { isEnterprise } = usePlan();
  const procurementModuleEnabled = currentBrand?.enabledModules?.procurement !== false;
  const { signalsBySku: piProcurementSignals } = useProcurementSignals();
  // Brand on Enterprise+Procurement with uploaded procurement signals → PI stock
  // must come from procurement (procurement-first).
  const expectsProcurementCatalog =
    isEnterprise && procurementModuleEnabled && Object.keys(piProcurementSignals || {}).length > 0;
  const {
    getThumbnailUrl,
    magentoConnected,
    magentoProductCatalogAccess,
    magentoProductCount,
    magentoLastSyncError,
  } = useProductThumbnails();
  const { suppliers } = useSuppliers();
  const { benchmarks, count: benchmarkCount } = usePriceBenchmarks({ maxDocs: PRODUCT_INTELLIGENCE_BENCHMARK_LIMIT });
  const tagStockBucket = useMemo((): ProductIntelligenceBucket | null => {
    if (tagInclude?.length !== 1) return null;
    const id = tagInclude[0];
    return id === 'healthy' || id === 'excess' || id === 'dead' || id === 'low' ? id : null;
  }, [tagInclude]);
  const serverBucket: ProductIntelligenceBucket =
    stockCardFilter === 'healthy' || stockCardFilter === 'excess' || stockCardFilter === 'dead' || stockCardFilter === 'low'
      ? stockCardFilter
      : tagStockBucket ?? 'all';
  const effectiveTagFilter = useMemo(() => {
    if (tagInclude) {
      let tags = includeNoStock ? tagInclude : tagInclude.filter((tag) => tag !== 'no_stock');
      tags = tags.filter((tag) => tag !== 'price_pending');
      return tags.length > 0 ? tags : undefined;
    }
    return undefined;
  }, [includeNoStock, tagInclude]);
  const serverQuery = useMemo<Omit<ProductIntelligenceQuery, 'bucket' | 'page'>>(() => ({
    pageSize: PAGE_SIZE,
    search: searchQuery.trim() || undefined,
    categories: categoryInclude == null ? undefined : categoryInclude.length > 0 ? categoryInclude : ['__NO_MATCH__'],
    brands: brandInclude == null ? undefined : brandInclude.length > 0 ? brandInclude : ['__NO_MATCH__'],
    tags: effectiveTagFilter == null ? undefined : effectiveTagFilter.length > 0 ? effectiveTagFilter : ['__NO_MATCH__'],
    margin: marginFilter === 'all' ? undefined : marginFilter as ProductIntelligenceQuery['margin'],
    stockAge: stockAgeFilter === 'all' ? undefined : stockAgeFilter,
    sortField,
    sortDirection,
    dateFrom: productDateFrom || undefined,
    dateTo: productDateTo || undefined,
    dateMode: productDateMode,
    includeNoStock,
    ...(groupByParent ? { groupByParent: true } : {}),
  }), [PAGE_SIZE, searchQuery, categoryInclude, brandInclude, effectiveTagFilter, marginFilter, stockAgeFilter, sortField, sortDirection, productDateFrom, productDateTo, productDateMode, includeNoStock, groupByParent]);
  const serverIntelligence = useProductIntelligenceAggregate(serverBucket, currentPage, serverQuery);
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

  const supplierTodMap = useMemo(
    () => buildSupplierTodMap(suppliers, currentBrand?.inventoryThresholds?.defaultTod),
    [suppliers, currentBrand?.inventoryThresholds?.defaultTod]
  );

  const hasServerAggregate = !!serverIntelligence.aggregate;
  const hasImported = hasServerAggregate;
  const productDataSourceLabel = serverIntelligence.aggregate?.sourceLabel ?? 'ERP';
  const totalCatalogCount = serverIntelligence.aggregate?.totalCount ?? 0;
  const effectiveSourceLoading =
    serverIntelligence.isAggregateLoading || (serverIntelligence.isPageLoading && !serverIntelligence.page);
  const piRefreshAttemptRef = useRef<string | null>(null);
  const [piRebuilding, setPiRebuilding] = useState(false);

  const triggerProductIntelligenceRebuild = React.useCallback(() => {
    if (!brandId || piRebuilding) return;
    setPiRebuilding(true);
    void refreshProductIntelligenceOnServer(brandId)
      .then((result) => {
        queryClient.invalidateQueries({ queryKey: ['productIntelligenceAggregate', brandId] });
        queryClient.invalidateQueries({ queryKey: ['productIntelligencePage', brandId] });
        queryClient.invalidateQueries({ queryKey: ['brandSyncVersion', brandId] });
        if ((result.totalCount ?? 0) === 0) {
          toast.info('Ο κατάλογος ανανεώθηκε αλλά δεν βρέθηκαν προϊόντα — συνδέστε ή συγχρονίστε έναν connector (ERP ή e-shop).');
        } else {
          toast.success(`Κατάλογος ανανεώθηκε · ${formatNumber(result.totalCount ?? 0)} SKUs`);
        }
      })
      .catch((err: unknown) => {
        // Do NOT clear piRefreshAttemptRef on failure: a persistently-failing rebuild must not re-arm
        // the auto-trigger effect into an infinite loop. The manual refresh button remains for retry.
        const msg = err instanceof Error ? err.message : 'Product Intelligence refresh failed';
        toast.error(`Αποτυχία ανανέωσης καταλόγου: ${msg}`);
        logger.warn('[ProductIntelligence] refresh failed:', { err });
      })
      .finally(() => setPiRebuilding(false));
  }, [brandId, piRebuilding, queryClient, toast]);

  useEffect(() => {
    if (!brandId || piRebuilding || serverIntelligence.isAggregateLoading) return;
    const aggregate = serverIntelligence.aggregate;
    const needsRebuild =
      !aggregate ||
      (aggregate.status === 'ready' && aggregate.totalCount === 0 && aggregate.sourceLabel === 'E-shop catalog') ||
      // Enterprise+Procurement but the aggregate isn't built from procurement yet (e.g. old
      // connector-based or skipped) → trigger a rebuild so it switches to the procurement source.
      (expectsProcurementCatalog && aggregate.sourceKind !== 'procurement');
    if (!needsRebuild) return;
    // Key on sourceKind only — NOT syncVersion/totalCount, which change on every rebuild. A rebuild
    // that cannot change the source (e.g. an ERP brand with a stale procurement signal) must attempt
    // at most once, never re-trigger itself into an infinite loop.
    const key = `${brandId}:${aggregate?.sourceKind ?? 'none'}`;
    if (piRefreshAttemptRef.current === key) return;
    piRefreshAttemptRef.current = key;
    triggerProductIntelligenceRebuild();
  }, [
    brandId,
    piRebuilding,
    serverIntelligence.isAggregateLoading,
    serverIntelligence.aggregate,
    triggerProductIntelligenceRebuild,
    expectsProcurementCatalog,
  ]);

  useEffect(() => {
    if (serverIntelligence.safePage !== currentPage) {
      setCurrentPage(serverIntelligence.safePage);
    }
  }, [serverIntelligence.safePage, currentPage]);

  const inventoryAlerts: InventoryAlert[] = [];
  // PER-178: with no stock-card bucket selected, the cards follow the active filters (category/brand/
  // search/margin/date) via the CF's filtered summary; a selected bucket keeps whole-inventory numbers
  // so the cards stay usable as bucket navigation.
  const displaySummary =
    (serverBucket === 'all' ? serverIntelligence.page?.summary : undefined)
    ?? serverIntelligence.aggregate?.summary
    ?? EMPTY_INVENTORY_SUMMARY;

  // PER-188: prefer server facets (actionable options); fall back to whole-catalog aggregate lists.
  const facets = serverIntelligence.page?.facets;

  const categoryOptions = useMemo((): ExcelFilterOption[] => {
    const rows = facets?.categories
      ? facets.categories.map((row) => ({ name: row.id === EMPTY_CATEGORY_ID ? '' : row.id }))
      : (serverIntelligence.aggregate?.categories ?? []);
    return rows
      .map((row) => ({
        id: row.name?.trim() ? row.name : EMPTY_CATEGORY_ID,
        label: row.name?.trim() ? row.name : '(Κενή κατηγορία)',
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'el'));
  }, [facets?.categories, serverIntelligence.aggregate?.categories]);

  const brandOptions = useMemo((): ExcelFilterOption[] => {
    const rows = facets?.brands
      ? facets.brands.map((row) => ({ name: row.id }))
      : (serverIntelligence.aggregate?.brands ?? []);
    return rows
      .filter((row) => row.name?.trim())
      .map((row) => ({ id: row.name, label: row.name }))
      .sort((a, b) => a.label.localeCompare(b.label, 'el'));
  }, [facets?.brands, serverIntelligence.aggregate?.brands]);

  const tagOptions = useMemo((): ExcelFilterOption[] => {
    // Keep canonical order; always keep price_pending (client-derived, not a server tag).
    const present = facets?.tags ? new Set(facets.tags.map((row) => row.id)) : null;
    const ids = present
      ? STOCK_INTELLIGENCE_TAG_IDS.filter((id) => id === 'price_pending' || present.has(id))
      : STOCK_INTELLIGENCE_TAG_IDS;
    return ids.map((id) => ({ id, label: STOCK_TAG_LABELS[id] ?? id }));
  }, [facets?.tags]);

  const filteredProducts = useMemo(() => {
    const rows = serverIntelligence.page?.products ?? [];
    let result = includeNoStock ? rows : rows.filter((product) => productStockLevel(product) > 0);
    if (tagInclude?.includes('price_pending')) {
      result = result.filter((p) => hasPricePending(p));
    }
    return result;
  }, [includeNoStock, serverIntelligence.page?.products, tagInclude]);
  const serverFilteredTotal = serverIntelligence.page?.totalRows ?? 0;
  const totalPages = serverIntelligence.page?.totalPages ?? 1;
  const paginatedProducts = filteredProducts;
  const activeInventoryTotal = useMemo(() => {
    const s = serverIntelligence.aggregate?.summary;
    if (!s) return serverFilteredTotal || totalCatalogCount;
    return s.healthy_stock.count + s.low_stock.count + s.excess_stock.count + s.dead_stock.count;
  }, [serverIntelligence.aggregate?.summary, serverFilteredTotal, totalCatalogCount]);
  // PER-178: the Active/Total SKUs card follows filters too — the filtered row count when no stock-card
  // bucket is selected, whole-catalog otherwise (matching the health cards' navigation behavior).
  const displayTotalSkus = serverBucket === 'all'
    ? serverFilteredTotal || (includeNoStock ? totalCatalogCount : activeInventoryTotal)
    : includeNoStock ? totalCatalogCount : activeInventoryTotal;
  const showMagentoImageAccessNotice =
    hasServerAggregate &&
    productDataSourceLabel === 'ERP' &&
    magentoConnected &&
    magentoProductCatalogAccess === false &&
    magentoProductCount === 0;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryInclude, brandInclude, tagInclude, marginFilter, stockAgeFilter, stockCardFilter, sortField, sortDirection, productDateFrom, productDateTo, productDateMode]);

  const handleQuickExportCsv = () => {
    if (paginatedProducts.length === 0) {
      toast.error('Δεν υπάρχουν γραμμές για εξαγωγή.');
      return;
    }
    downloadProductIntelligenceCsv(paginatedProducts, currentBrand?.name);
    toast.success(`Έγινε λήψη CSV τρέχουσας σελίδας (${formatNumber(paginatedProducts.length)} γραμμές).`);
  };

  const handleQuickExportXlsx = async () => {
    if (paginatedProducts.length === 0) {
      toast.error('Δεν υπάρχουν γραμμές για εξαγωγή.');
      return;
    }
    try {
      await downloadProductIntelligenceXlsx(paginatedProducts, currentBrand?.name);
      toast.success(`Έγινε λήψη Excel τρέχουσας σελίδας (${formatNumber(paginatedProducts.length)} γραμμές).`);
    } catch (e) {
      logger.error('Excel export failed', { err: e });
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

  const handleTagIncludeChange = (next: string[] | null) => {
    if (next?.includes('no_stock')) setIncludeNoStock(true);
    setTagInclude(next);
    if (!next || next.length === 0) {
      setStockCardFilter('all');
      return;
    }
    if (next.length === 1) {
      const [tag] = next;
      if (tag === 'healthy' || tag === 'excess' || tag === 'dead' || tag === 'low') {
        setStockCardFilter(tag);
      } else {
        setStockCardFilter('all');
      }
      return;
    }
    setStockCardFilter('all');
  };

  const selectStockCardFilter = (next: 'all' | 'healthy' | 'excess' | 'dead' | 'low') => {
    setStockCardFilter(next);
    setTagInclude(null);
  };

  const handleIncludeNoStockChange = (checked: boolean) => {
    setIncludeNoStock(checked);
    setCurrentPage(1);
    if (!checked && tagInclude?.includes('no_stock')) {
      const next = tagInclude.filter((tag) => tag !== 'no_stock');
      setTagInclude(next.length > 0 ? next : null);
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
      queryClient.invalidateQueries({ queryKey: ['productIntelligenceAggregate', currentBrand.id] });
      queryClient.invalidateQueries({ queryKey: ['productIntelligencePage', currentBrand.id] });
      toast.success('Τα προϊόντα διαγράφηκαν επιτυχώς.');
    } catch (e) {
      toast.error(`Σφάλμα διαγραφής: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (!effectiveSourceLoading && !hasImported && !serverIntelligence.isBuilding && !serverIntelligence.isAggregateLoading) {
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

  // Non-blocking recompute: once any page data exists, keep it on screen (+ a "refreshing" banner)
  // instead of blanking to skeletons while a rebuild runs. Skeleton shows only on the genuine first
  // load (no page yet); keepPreviousData on the page query holds the table steady across syncVersions.
  const isRecomputing = piRebuilding || serverIntelligence.isBuilding;
  const showFirstLoadSkeleton = (effectiveSourceLoading || piRebuilding) && !serverIntelligence.page;

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
          hasServerAggregate ? (
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-[#22C55E] sm:text-sm">
              <span>
                Showing {formatNumber(paginatedProducts.length)} of {formatNumber(serverFilteredTotal || displayTotalSkus)} active {serverIntelligence.aggregate?.sourceLabel === 'ERP' ? 'ERP' : 'catalog'} product(s)
              </span>
              <DataSourcePill
                label="Source"
                value={productDataSourceLabel}
                tone={serverIntelligence.aggregate?.sourceLabel === 'ERP' ? 'warning' : 'success'}
              />
              {(() => {
                // Warehouse filter the stock numbers reflect (empty = all warehouses → no pill).
                const labels = serverIntelligence.aggregate?.stockLocationLabels?.length
                  ? serverIntelligence.aggregate.stockLocationLabels
                  : serverIntelligence.aggregate?.stockLocations ?? [];
                return labels.length ? (
                  <DataSourcePill label="Αποθήκη" value={labels.join(', ')} tone="success" />
                ) : null;
              })()}
              {isRecomputing ? (
                <span className="flex items-center gap-1 text-[var(--nts-accent)]">
                  <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" aria-hidden /> ανανέωση…
                </span>
              ) : null}
            </div>
          ) : effectiveSourceLoading || piRebuilding ? (
            <p className="text-xs font-medium text-[var(--nts-accent)] sm:text-sm flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" aria-hidden />
              {piRebuilding ? 'Ανανέωση καταλόγου…' : 'Φόρτωση inventory…'}
            </p>
          ) : null
        }
        actions={
          <>
            {hasServerAggregate && totalCatalogCount === 0 && productDataSourceLabel === 'E-shop catalog' ? (
              <Button
                variant="secondary"
                size="sm"
                icon={piRebuilding ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                onClick={() => {
                  piRefreshAttemptRef.current = null;
                  triggerProductIntelligenceRebuild();
                }}
                disabled={piRebuilding || !brandId}
                className="min-h-[36px] flex-1 basis-full sm:flex-initial sm:basis-auto"
              >
                {piRebuilding ? 'Ανανέωση…' : 'Ανανέωση καταλόγου'}
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={handleDeleteProducts}
              disabled={effectiveSourceLoading || isDeleting || !currentBrand?.id}
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

      {showFirstLoadSkeleton ? (
        <ProductIntelligenceSkeleton />
      ) : (
        <>
      {/* Non-blocking refresh banner: keep the last-good data on screen while the catalog recomputes. */}
      {isRecomputing ? (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--nts-accent)]/30 bg-[var(--nts-accent)]/5 px-4 py-2.5 text-xs font-medium text-[var(--nts-accent)] sm:text-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" aria-hidden />
          <span>Ο κατάλογος ανανεώνεται — εμφανίζονται τα τελευταία γνωστά στοιχεία, θα ενημερωθούν αυτόματα.</span>
        </div>
      ) : null}
      {/* Inventory Alerts */}
      <AlertsBanner filterGroup="inventory" maxAlerts={2} compact onNavigate={onSectionChange} />

      {showMagentoImageAccessNotice ? (
        <Card padding="md" className="border border-amber-200 bg-amber-50/80">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-950">
                  Δεν υπάρχουν διαθέσιμες φωτογραφίες προϊόντων από Magento.
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-900 sm:text-sm">
                  Το απόθεμα έρχεται από ERP, αλλά το Magento Products API δεν δίνει πρόσβαση στον κατάλογο
                  (401). Χρειάζεται Magento integration token με read δικαίωμα στο catalog/products και μετά νέο sync.
                </p>
                {magentoLastSyncError ? (
                  <p className="mt-1 text-[11px] text-amber-800">
                    Τελευταίο σφάλμα: {magentoLastSyncError}
                  </p>
                ) : null}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onSectionChange?.('data')}
              className="shrink-0 border-amber-300 bg-white/80 text-amber-900 hover:bg-white"
            >
              Έλεγχος σύνδεσης
            </Button>
          </div>
        </Card>
      ) : null}

      {/* Summary Cards — uses procurement data when available */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard
          label={includeNoStock ? 'Total SKUs' : 'Active SKUs'}
          value={formatNumber(displayTotalSkus)}
          icon={<Package size={20} />}
          color="#78716C"
          tooltip={includeNoStock ? 'Συνολικός αριθμός SKU στο ERP catalog.' : 'Ενεργά SKU με διαθέσιμο απόθεμα/stock signal, η βάση για συμπεράσματα και προτάσεις.'}
          active={stockCardFilter === 'all'}
          onClick={() => selectStockCardFilter('all')}
        />
        <SummaryCard
          label="Healthy Stock"
          value={`${displaySummary.healthy_stock.percentage}%`}
          subValue={formatNumber(displaySummary.healthy_stock.count)}
          icon={<TrendingUp size={20} />}
          color="#22C55E"
          tooltip="Προϊόντα με υγιή διάρκεια αποθέματος."
          active={stockCardFilter === 'healthy'}
          onClick={() => selectStockCardFilter(stockCardFilter === 'healthy' ? 'all' : 'healthy')}
        />
        <SummaryCard
          label="Excess Stock"
          value={displaySummary.excess_stock.value >= 1000
            ? formatCurrencyCompact(displaySummary.excess_stock.value)
            : `€${formatCurrency(displaySummary.excess_stock.value)}`}
          subValue={`${displaySummary.excess_stock.count} SKUs`}
          icon={<AlertTriangle size={20} />}
          color="#F59E0B"
          tooltip={`Προϊόντα με απόθεμα που καλύπτει πάνω από ${excessDaysOfCover} ημέρες πωλήσεων, με βάση τον τρέχοντα ρυθμό. Το όριο ρυθμίζεται στα «Όρια υγείας αποθέματος».`}
          active={stockCardFilter === 'excess'}
          onClick={() => selectStockCardFilter(stockCardFilter === 'excess' ? 'all' : 'excess')}
        />
        <SummaryCard
          label="Dead Stock"
          value={displaySummary.dead_stock.value >= 1000
            ? formatCurrencyCompact(displaySummary.dead_stock.value)
            : `€${formatCurrency(displaySummary.dead_stock.value)}`}
          subValue={`${displaySummary.dead_stock.count} SKUs`}
          icon={<AlertCircle size={20} />}
          color="#EF4444"
          tooltip="Προϊόντα χωρίς πωλήσεις — δεσμεύουν κεφάλαιο."
          active={stockCardFilter === 'dead'}
          onClick={() => selectStockCardFilter(stockCardFilter === 'dead' ? 'all' : 'dead')}
        />
        <SummaryCard
          label="Low Stock"
          value={`${displaySummary.low_stock.percentage}%`}
          subValue={`${displaySummary.low_stock.count} SKUs`}
          icon={<TrendingDown size={20} />}
          color="#8B5CF6"
          tooltip={`Προϊόντα με απόθεμα που καλύπτει έως ${lowDaysOfCover} ημέρες πωλήσεων. Κίνδυνος εξάντλησης. Το όριο ρυθμίζεται στα «Όρια υγείας αποθέματος».`}
          active={stockCardFilter === 'low'}
          onClick={() => selectStockCardFilter(stockCardFilter === 'low' ? 'all' : 'low')}
        />
      </div>

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
              Εμφανίζονται SKU με {productDateMode === 'imported' ? 'ημερομηνία εισαγωγής' : 'πρώτη διαθεσιμότητα'} εντός της περιόδου. Το φίλτρο εφαρμόζεται server-side στο πλήρες inventory.
            </p>
          )}
        </div>
        {/* Filters — Excel-style filters (value list) + export */}
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
              label="Brand"
              options={brandOptions}
              value={brandInclude}
              onChange={setBrandInclude}
            />
            <ColumnExcelFilter
              label="Tag"
              options={tagOptions}
              value={tagInclude}
              onChange={handleTagIncludeChange}
              selectionMode="additive"
            />
            <label className="flex min-h-[38px] items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#374151]">
              <input
                type="checkbox"
                checked={includeNoStock}
                onChange={(e) => handleIncludeNoStockChange(e.target.checked)}
                className="rounded border-[#D1D5DB] text-[var(--nts-accent)] focus:ring-[var(--nts-accent)]/30"
              />
              <span className="whitespace-nowrap">Εμφάνιση no stock</span>
            </label>
            <label
              className="flex min-h-[38px] items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#374151]"
              title="Οι παραλλαγές με δηλωμένη σχέση parent-child (Magento) εμφανίζονται ως μία γραμμή ανά parent, με αθροισμένο απόθεμα/πωλήσεις."
            >
              <input
                type="checkbox"
                checked={groupByParent}
                onChange={(e) => { setGroupByParent(e.target.checked); setCurrentPage(1); }}
                className="rounded border-[#D1D5DB] text-[var(--nts-accent)] focus:ring-[var(--nts-accent)]/30"
              />
              <span className="whitespace-nowrap">Ομαδοποίηση Parent SKU</span>
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Margin tier</span>
              <DropdownFilter
                value={marginFilter}
                onChange={setMarginFilter}
                options={[
                  { value: 'all', label: 'All margins' },
                  { value: 'high', label: 'High margin' },
                  { value: 'medium', label: 'Medium margin' },
                  { value: 'low', label: 'Low margin' },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-end gap-2 sm:ml-auto">
              <div className="text-sm text-[#4A4A4A] min-w-[120px]">
                {formatNumber(serverFilteredTotal)} γραμμές
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon={<FileText size={14} />}
                onClick={handleQuickExportCsv}
                disabled={effectiveSourceLoading || paginatedProducts.length === 0}
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
                disabled={effectiveSourceLoading || paginatedProducts.length === 0}
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
                <th className="px-3 py-2 text-left text-[11px] font-medium text-[#4A4A4A] hidden lg:table-cell">
                  <span className="inline-flex items-center gap-1">
                    Brand
                    <Tooltip content="Κατασκευαστής του προϊόντος (manufacturer), όπως έρχεται από το ERP ή το e-shop — όχι το brand/κατάστημα της πλατφόρμας." size={12} />
                  </span>
                </th>
                <th className="px-3 py-2 text-left text-[11px] font-medium text-[#4A4A4A]">
                  <Tooltip content="Μικτό περιθώριο κέρδους: (τιμή πώλησης − κόστος) / τιμή πώλησης. Απαιτεί κόστος από το ERP — χωρίς αυτό εμφανίζεται κενό." size={12}>
                    <button
                      onClick={() => handleSort('margin_percentage')}
                      className="flex items-center gap-1 hover:text-[#1A1A1A]"
                    >
                      Margin
                      <SortIcon field="margin_percentage" current={sortField} direction={sortDirection} />
                    </button>
                  </Tooltip>
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
                  <Tooltip content="Days of Stock: για πόσες ημέρες φτάνει το τρέχον απόθεμα με τον ρυθμό πωλήσεων του τελευταίου μήνα. «∞» = απόθεμα χωρίς πωλήσεις." size={12}>
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
                  <span className="inline-flex items-center gap-1">
                    Tag
                    <Tooltip content="Κατάσταση αποθέματος: Low (κάτω από το σημείο αναπαραγγελίας), Excess (πολύ μεγάλη κάλυψη), Dead (χωρίς πωλήσεις), No stock (μηδενικό)." size={12} />
                  </span>
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
                    useProcurementRowModel={hasServerAggregate}
                    getThumbnailUrl={getThumbnailUrl}
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
              : `Εμφανίζονται ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, serverFilteredTotal)} από ${formatNumber(serverFilteredTotal)} προϊόντα`}
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
        filteredProducts={paginatedProducts}
        onShowCharts={() => setShowCharts(true)}
        brandName={currentBrand?.name}
        scopeLabel={`τρέχουσας σελίδας (${formatNumber(paginatedProducts.length)} από ${formatNumber(serverFilteredTotal)})`}
      />

      {/* Charts Modal */}
      <ProductCharts
        isOpen={showCharts}
        onClose={() => setShowCharts(false)}
        products={paginatedProducts}
        supplierTodMap={supplierTodMap}
        useProcurementRowModel={hasServerAggregate}
        aggregateCharts={serverIntelligence.aggregate?.charts}
        totalProducts={totalCatalogCount}
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
  getThumbnailUrl: (sku: string, product?: unknown) => { url: string };
}

function ProductRow({ product, index, supplierTodMap, benchmarkMap, useProcurementRowModel, getThumbnailUrl }: ProductRowProps) {
  const thumbUrl = getThumbnailUrl(product.sku || '', product).url;
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
        <motion.div className="flex min-w-0 items-center gap-2.5">
          <ProductThumbnail src={thumbUrl || undefined} alt={product.name} size="sm" />
          <div className="min-w-0">
            <p className="text-xs font-medium text-[#1A1A1A] truncate">{product.name}</p>
            <p className="text-[10px] text-[#9CA3AF] truncate">{product.sku}</p>
          </div>
        </motion.div>
      </td>
      <td className="px-3 py-2 hidden lg:table-cell">
        <span className="text-xs text-[#4A4A4A] truncate block max-w-[120px]">{product.category}</span>
      </td>
      <td className="px-3 py-2 hidden lg:table-cell">
        <span className="text-xs text-[#4A4A4A] truncate block max-w-[120px]">{product.brand || '—'}</span>
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
        {productDisplayTag(product) ? (
          <Badge
            variant={
              productDisplayTag(product) === 'dead' ? 'danger' :
              productDisplayTag(product) === 'low' ? 'warning' :
              productDisplayTag(product) === 'no_stock' ? 'default' :
              productDisplayTag(product) === 'price_pending' ? 'info' :
              productDisplayTag(product) === 'healthy' ? 'success' :
              productDisplayTag(product) === 'excess' ? 'orange' :
              productDisplayTag(product) === 'Brand Push' ? 'info' :
              productDisplayTag(product) === 'New Launch' ? 'success' :
              productDisplayTag(product) === 'Best Seller' ? 'orange' :
              productDisplayTag(product) === 'Clearance' ? 'warning' : 'default'
            }
            size="sm"
          >
            {productDisplayTag(product)}
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
