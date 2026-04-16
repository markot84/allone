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
  TrendingUp,
  TrendingDown,
  Trash2,
  Loader2
} from 'lucide-react';
import { Card, Badge, Button, ProgressBar, Tooltip, useToast, AlertsBanner, PageHeader } from '../common';
import { useProducts } from '../../hooks/useProducts';
import { useProductSource } from '../../hooks/useProductSource';
import { useBrand } from '../../hooks/useBrand';
import { useSuppliers } from '../../hooks/useSuppliers';
import { usePlan } from '../../hooks/usePlan';
import { useProcurement } from '../../hooks/useProcurement';
import { usePriceBenchmarks } from '../../hooks/usePriceBenchmarks';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import { FirestoreService } from '../../services/firestore';
import { classifyStockHealth, getDaysOfStock, getProductTod } from '../../utils/productUtils';
import { ExportModal } from './ExportModal';
import { ProductCharts } from './ProductCharts';
import type { Product, InventorySummary, InventoryAlert } from '../../types';

type SortField = 'name' | 'margin_percentage' | 'stock_level' | 'stock_age_days' | 'price';
type SortDirection = 'asc' | 'desc';

function computeInventorySummary(products: Product[], supplierTodMap?: Map<string, number>): InventorySummary {
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
    const level = p.stock_level ?? 0;
    const price = p.price ?? 0;
    totalValue += level * price;

    const tod = getProductTod(p, supplierTodMap);
    const health = classifyStockHealth(p, tod);
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

function computeInventoryAlerts(products: Product[], supplierTodMap?: Map<string, number>): InventoryAlert[] {
  const alerts: InventoryAlert[] = [];
  const classify = (p: Product) => classifyStockHealth(p, getProductTod(p, supplierTodMap));
  const deadStock = products.filter((p) => classify(p) === 'dead');
  const excessStock = products.filter((p) => classify(p) === 'excess');
  const highMarginLowStock = products.filter(
    (p) => (p.margin_tier === 'high' || (p.margin_percentage ?? 0) > 25) && classify(p) === 'low'
  );
  if (deadStock.length > 0) alerts.push({ type: 'critical', message: `${deadStock.length} SKU(s) χωρίς πωλήσεις (dead stock)`, action: 'Ελέγξτε για clearance' });
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
                {['Προϊόν', 'Margin', 'Stock', 'DOS', 'Τιμή', ''].map((label, i) => (
                  <th key={label + i} className="px-3 py-2.5 text-left">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                      {label || '\u00A0'}
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
                  <td className="px-3 py-3 w-12">
                    <div className="h-8 w-8 bg-[#F3F4F6] rounded-md animate-pulse ml-auto" />
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
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [marginFilter, setMarginFilter] = useState<string>('all');
  const [stockAgeFilter, setStockAgeFilter] = useState<'all' | 'dead' | 'near-dead' | 'high-margin-low-stock'>('all');
  const [stockCardFilter, setStockCardFilter] = useState<'all' | 'healthy' | 'excess' | 'dead' | 'low'>('all');
  const [sortField, setSortField] = useState<SortField>('margin_percentage');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showExportModal, setShowExportModal] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 150;

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
  const { products: rawProducts, hasImported: rawHasImported } = useProducts();
  const {
    products: sourceProducts,
    hasImported,
    usingProcurement,
    isLoading: sourceLoading,
  } = useProductSource();
  const { suppliers } = useSuppliers();
  const { isEnterprise } = usePlan();
  const { data: procData } = useProcurement();
  const { benchmarks, count: benchmarkCount } = usePriceBenchmarks();
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

  const inventorySummary = useMemo(() => computeInventorySummary(rawProducts, supplierTodMap), [rawProducts, supplierTodMap]);
  const inventoryAlerts = useMemo(() => computeInventoryAlerts(rawProducts, supplierTodMap), [rawProducts, supplierTodMap]);

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

      if (stock === 0 || status.includes('ΑΝΕΝΕΡΓ') || evalGrade === 'C') {
        deadCount++;
        deadValue += itemValue;
      } else if (needsRefill) {
        lowCount++;
      } else if (evalGrade === 'A') {
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

  // Use procurement data when available, fallback to product import
  const displaySummary = procInventorySummary ?? inventorySummary;

  const categories = useMemo(() => {
    const fromProducts = [...new Set(sourceProducts.map(p => p.category))].filter(Boolean).sort();
    return fromProducts;
  }, [sourceProducts]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    return sourceProducts
      .filter((p) => {
        const matchesSearch = (p.name ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                             (p.sku ?? '').toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || (p.category ?? '') === selectedCategory;
        const matchesMargin = marginFilter === 'all' || p.margin_tier === marginFilter;
        
        // Stock age filter
        const tod = getProductTod(p, supplierTodMap);
        const health = classifyStockHealth(p, tod);
        let matchesStockAge = true;
        if (stockAgeFilter === 'dead') {
          matchesStockAge = health === 'dead';
        } else if (stockAgeFilter === 'near-dead') {
          const dos = getDaysOfStock(p);
          matchesStockAge = health === 'excess' && dos !== Infinity;
        } else if (stockAgeFilter === 'high-margin-low-stock') {
          const isHighMargin = p.margin_tier === 'high' || (p.margin_percentage ?? 0) > 25;
          matchesStockAge = isHighMargin && health === 'low';
        }

        // Stock card filter
        let matchesStockCard = true;
        if (stockCardFilter !== 'all') {
          matchesStockCard = health === stockCardFilter;
        }
        
        return matchesSearch && matchesCategory && matchesMargin && matchesStockAge && matchesStockCard;
      })
      .sort((a, b) => {
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
  }, [sourceProducts, searchQuery, selectedCategory, marginFilter, stockAgeFilter, stockCardFilter, sortField, sortDirection, supplierTodMap]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory, marginFilter, stockAgeFilter, stockCardFilter, sortField, sortDirection]);

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
    if (!window.confirm(`Διαγραφή όλων των προϊόντων (${rawProducts.length}) για το brand "${currentBrand.name}"; Αυτή η ενέργεια δεν αναιρείται.`)) return;
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

  if (!sourceLoading && !hasImported && !usingProcurement) {
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
          sourceLoading ? (
            <p className="text-xs font-medium text-[var(--nts-accent)] sm:text-sm flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin flex-shrink-0" aria-hidden />
              Φόρτωση inventory…
            </p>
          ) : sourceProducts.length > 0 ? (
            <p className="text-xs font-medium text-[#22C55E] sm:text-sm">
              Showing {sourceProducts.length} {usingProcurement ? 'procurement' : 'imported'} product(s)
            </p>
          ) : null
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              icon={<Trash2 size={14} />}
              onClick={handleDeleteProducts}
              disabled={sourceLoading || isDeleting || !rawHasImported}
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
              disabled={sourceLoading}
              className="min-h-[36px] flex-1 basis-[calc(50%-0.1875rem)] sm:flex-initial sm:basis-auto"
            >
              <span className="hidden min-[380px]:inline">Εξαγωγή αναφοράς</span>
              <span className="min-[380px]:hidden">Εξαγωγή</span>
            </Button>
          </>
        }
      />

      {sourceLoading ? (
        <ProductIntelligenceSkeleton />
      ) : (
        <>
      {/* Inventory Alerts */}
      <AlertsBanner filterGroup="inventory" maxAlerts={2} compact onNavigate={onSectionChange} />

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
        {/* Filters */}
        <div className="p-4 border-b border-[#E5E5E5] flex flex-wrap gap-4 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              placeholder="Αναζήτηση προϊόντων..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)] focus:bg-white transition-all"
            />
          </div>

          {/* Category Filter */}
          <DropdownFilter
            value={selectedCategory}
            onChange={setSelectedCategory}
            options={[{ value: 'all', label: 'Όλες οι κατηγορίες' }, ...categories.map(c => ({ value: c, label: c }))]}
          />

          {/* Margin Filter */}
          <DropdownFilter
            value={marginFilter}
            onChange={setMarginFilter}
            options={[
              { value: 'all', label: 'Όλα τα margins' },
              { value: 'high', label: 'Υψηλό margin' },
              { value: 'medium', label: 'Μέτριο margin' },
              { value: 'low', label: 'Χαμηλό margin' }
            ]}
          />

          <div className="text-sm text-[#4A4A4A]">
            {filteredProducts.length} products
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
                    Stock
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
                <th className="px-3 py-2 text-right text-[11px] font-medium text-[#4A4A4A]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {paginatedProducts.map((product, index) => (
                  <ProductRow key={product.id} product={product} index={index} supplierTodMap={supplierTodMap} benchmarkMap={benchmarkCount > 0 ? benchmarkMap : undefined} />
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-[#E5E5E5] flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[#4A4A4A]">
            {filteredProducts.length === 0
              ? 'Δεν βρέθηκαν προϊόντα'
              : `Εμφανίζονται ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filteredProducts.length)} από ${filteredProducts.length} προϊόντα`}
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
}

function ProductRow({ product, index, supplierTodMap, benchmarkMap }: ProductRowProps) {
  const tod = getProductTod(product, supplierTodMap);
  const health = classifyStockHealth(product, tod);
  const healthColor = health === 'dead' ? '#EF4444' : health === 'excess' ? '#EF4444' : health === 'low' ? '#F59E0B' : '#22C55E';
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
        <div className="flex items-center gap-1.5">
          <ProgressBar
            value={product.stock_level ?? 0}
            max={Math.max(product.stock_capacity ?? 0, 1)}
            color={stockColor}
            size="sm"
            className="w-12"
          />
          <span className="text-[10px] text-[#4A4A4A] font-mono">
            {product.stock_level}
          </span>
        </div>
      </td>
      <td className="px-3 py-2 hidden md:table-cell">
        <span
          className="text-xs font-mono"
          style={{ color: ageColor }}
        >
          {getDaysOfStock(product) === Infinity ? '∞' : `${Math.round(getDaysOfStock(product))}d`}
        </span>
      </td>
      <td className="px-3 py-2 hidden lg:table-cell">
        {product.priority_tag ? (
          <Badge
            variant={
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
      <td className="px-3 py-2 text-right">
        <button className="text-[10px] font-medium text-[var(--nts-accent)] hover:underline">
          Feed
        </button>
      </td>
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
