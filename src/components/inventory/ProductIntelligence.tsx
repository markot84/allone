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
  Trash2
} from 'lucide-react';
import { Card, Badge, Button, ProgressBar, Spinner, Tooltip, useToast } from '../common';
import { useProducts, useBrand } from '../../hooks';
import { formatCurrency, formatCurrencyCompact, formatNumber, formatPercent } from '../../utils/format';
import { FirestoreService } from '../../services/firestore';
import { getStockAgeDays } from '../../utils/productUtils';
import { ExportModal } from './ExportModal';
import { ProductCharts } from './ProductCharts';
import type { Product, InventorySummary, InventoryAlert } from '../../types';

type SortField = 'name' | 'margin_percentage' | 'stock_level' | 'stock_age_days' | 'price';
type SortDirection = 'asc' | 'desc';

function computeInventorySummary(products: Product[]): InventorySummary {
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
    const capacity = Math.max(p.stock_capacity ?? 0, 1);
    const price = p.price ?? 0;
    const ageDays = getStockAgeDays(p);
    const hasExplicitCapacity = (p.stock_capacity ?? 0) > 0 && p.stock_capacity !== level;
    const ratio = hasExplicitCapacity ? level / capacity : (level > 0 ? 0.5 : 0);

    totalValue += level * price;

    // Debug: Log first few products for troubleshooting
    if (products.indexOf(p) < 3) {
      console.debug(`[ProductIntelligence] Product ${products.indexOf(p)}:`, {
        id: p.id,
        name: p.name,
        stock_level: level,
        stock_capacity: capacity,
        price,
        ageDays,
        hasExplicitCapacity,
        ratio,
        margin_percentage: p.margin_percentage,
        cost_price: p.cost_price,
        first_available_date: p.first_available_date,
        createdAt: p.createdAt
      });
    }

    if (ageDays > 180) {
      deadCount++;
      deadValue += level * price;
    } else if (hasExplicitCapacity && ratio > 0.8) {
      excessCount++;
      excessValue += level * price;
    } else if (level < 10 || (hasExplicitCapacity && ratio < 0.2)) {
      lowCount++;
    } else {
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

function computeInventoryAlerts(products: Product[]): InventoryAlert[] {
  const alerts: InventoryAlert[] = [];
  const deadStock = products.filter((p) => getStockAgeDays(p) > 180);
  const nearDead = products.filter((p) => {
    const age = getStockAgeDays(p);
    return age > 120 && age <= 180;
  });
  const highMarginLowStock = products.filter(
    (p) => (p.margin_tier === 'high' || (p.margin_percentage ?? 0) > 25) && ((p.stock_level ?? 0) < 10 || (p.stock_level ?? 0) / Math.max(p.stock_capacity ?? 1, 1) < 0.2)
  );
  if (deadStock.length > 0) alerts.push({ type: 'critical', message: `${deadStock.length} SKU(s) με stock age > 180 ημέρες`, action: 'Ελέγξτε για clearance' });
  if (nearDead.length > 0) alerts.push({ type: 'warning', message: `${nearDead.length} SKU(s) πλησιάζουν dead stock`, action: 'Δημιουργήστε προσφορές' });
  if (highMarginLowStock.length > 0) alerts.push({ type: 'info', message: `${highMarginLowStock.length} high-margin items με low stock`, action: 'Πρόταση αναπλήρωσης' });
  return alerts.length > 0 ? alerts : [];
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

  const { currentBrand } = useBrand();
  const { products, isLoading: productsLoading, hasImported } = useProducts();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const inventorySummary = useMemo(() => computeInventorySummary(products), [products]);
  const inventoryAlerts = useMemo(() => computeInventoryAlerts(products), [products]);
  const categories = useMemo(() => {
    const fromProducts = [...new Set(products.map(p => p.category))].filter(Boolean).sort();
    return fromProducts;
  }, [products]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    return products
      .filter((p) => {
        const matchesSearch = (p.name ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                             (p.sku ?? '').toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || (p.category ?? '') === selectedCategory;
        const matchesMargin = marginFilter === 'all' || p.margin_tier === marginFilter;
        
        // Stock age filter
        const age = getStockAgeDays(p);
        let matchesStockAge = true;
        if (stockAgeFilter === 'dead') {
          matchesStockAge = age > 180;
        } else if (stockAgeFilter === 'near-dead') {
          matchesStockAge = age > 120 && age <= 180;
        } else if (stockAgeFilter === 'high-margin-low-stock') {
          const isHighMargin = p.margin_tier === 'high' || (p.margin_percentage ?? 0) > 25;
          const isLowStock = (p.stock_level ?? 0) < 10 || ((p.stock_level ?? 0) / Math.max(p.stock_capacity ?? 1, 1) < 0.2);
          matchesStockAge = isHighMargin && isLowStock;
        }

        // Stock card filter
        let matchesStockCard = true;
        if (stockCardFilter !== 'all') {
          const level = p.stock_level ?? 0;
          const capacity = Math.max(p.stock_capacity ?? 0, 1);
          const hasCapacity = (p.stock_capacity ?? 0) > 0 && p.stock_capacity !== level;
          const ratio = hasCapacity ? level / capacity : (level > 0 ? 0.5 : 0);
          const ageD = getStockAgeDays(p);

          if (stockCardFilter === 'healthy') {
            matchesStockCard = ratio >= 0.2 && ratio <= 0.8 && ageD <= 180;
          } else if (stockCardFilter === 'excess') {
            matchesStockCard = ratio > 0.8;
          } else if (stockCardFilter === 'dead') {
            matchesStockCard = ageD > 180;
          } else if (stockCardFilter === 'low') {
            matchesStockCard = level < 10 || ratio < 0.2;
          }
        }
        
        return matchesSearch && matchesCategory && matchesMargin && matchesStockAge && matchesStockCard;
      })
      .sort((a, b) => {
        const aVal = sortField === 'stock_age_days' ? getStockAgeDays(a) : a[sortField];
        const bVal = sortField === 'stock_age_days' ? getStockAgeDays(b) : b[sortField];
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortDirection === 'asc' 
            ? aVal.localeCompare(bVal) 
            : bVal.localeCompare(aVal);
        }
        return sortDirection === 'asc' 
          ? (aVal as number) - (bVal as number) 
          : (bVal as number) - (aVal as number);
      });
  }, [products, searchQuery, selectedCategory, marginFilter, stockAgeFilter, stockCardFilter, sortField, sortDirection]);

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
    if (!window.confirm(`Διαγραφή όλων των προϊόντων (${products.length}) για το brand "${currentBrand.name}"; Αυτή η ενέργεια δεν αναιρείται.`)) return;
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

  if (productsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Spinner size="lg" label="Φόρτωση προϊόντων…" />
      </div>
    );
  }

  if (!hasImported) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Product Intelligence</h2>
          <p className="text-[#4A4A4A] mt-1">
            Monitor inventory health and product performance
          </p>
        </div>
        <Card padding="lg" className="text-center py-12">
          <p className="text-[#4A4A4A] mb-4">
            Δεν υπάρχουν imported προϊόντα ακόμα.
          </p>
          <p className="text-sm text-[#4A4A4A]">
            Μεταβείτε στο{' '}
            <button
              type="button"
              onClick={() => onSectionChange?.('data-products')}
              className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
            >
              Data Import
            </button>
            {' '}για να εισάγετε προϊόντα.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Product Intelligence</h2>
          <p className="text-[#4A4A4A] mt-1">
            Monitor inventory health and product performance
            {hasImported && products.length > 0 && (
              <span className="ml-2 text-[#22C55E] font-medium">· Showing {products.length} imported product(s)</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            icon={<Trash2 size={16} />}
            onClick={handleDeleteProducts}
            disabled={isDeleting || !hasImported}
            className="text-[#DC2626] hover:bg-[#FEE2E2]"
          >
            {isDeleting ? 'Διαγραφή…' : 'Διαγραφή δεδομένων'}
          </Button>
          <Button 
            variant="secondary" 
            icon={<Download size={16} />}
            onClick={() => setShowExportModal(true)}
          >
            Export Report
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard
          label="Total SKUs"
          value={formatNumber(inventorySummary.total_skus)}
          icon={<Package size={20} />}
          color="#78716C"
          tooltip="Συνολικός αριθμός προϊόντων (SKU) στο inventory."
          active={stockCardFilter === 'all'}
          onClick={() => setStockCardFilter('all')}
        />
        <SummaryCard
          label="Healthy Stock"
          value={`${inventorySummary.healthy_stock.percentage}%`}
          subValue={formatNumber(inventorySummary.healthy_stock.count)}
          icon={<TrendingUp size={20} />}
          color="#22C55E"
          tooltip="Προϊόντα με stock 20–80% της χωρητικότητας και ηλικία < 180 ημερών."
          active={stockCardFilter === 'healthy'}
          onClick={() => setStockCardFilter(stockCardFilter === 'healthy' ? 'all' : 'healthy')}
        />
        <SummaryCard
          label="Excess Stock"
          value={inventorySummary.excess_stock.value >= 1000
            ? formatCurrencyCompact(inventorySummary.excess_stock.value)
            : `€${formatCurrency(inventorySummary.excess_stock.value)}`}
          subValue={`${inventorySummary.excess_stock.count} SKUs`}
          icon={<AlertTriangle size={20} />}
          color="#F59E0B"
          tooltip="Προϊόντα με stock > 80% της χωρητικότητας (υπερπλήρωση)."
          active={stockCardFilter === 'excess'}
          onClick={() => setStockCardFilter(stockCardFilter === 'excess' ? 'all' : 'excess')}
        />
        <SummaryCard
          label="Dead Stock"
          value={inventorySummary.dead_stock.value >= 1000
            ? formatCurrencyCompact(inventorySummary.dead_stock.value)
            : `€${formatCurrency(inventorySummary.dead_stock.value)}`}
          subValue={`${inventorySummary.dead_stock.count} SKUs`}
          icon={<AlertCircle size={20} />}
          color="#EF4444"
          tooltip="Προϊόντα με stock_age > 180 ημερών (αδρανές απόθεμα)."
          active={stockCardFilter === 'dead'}
          onClick={() => setStockCardFilter(stockCardFilter === 'dead' ? 'all' : 'dead')}
        />
        <SummaryCard
          label="Low Stock"
          value={`${inventorySummary.low_stock.percentage}%`}
          subValue={`${inventorySummary.low_stock.count} SKUs`}
          icon={<TrendingDown size={20} />}
          color="#8B5CF6"
          tooltip="Προϊόντα με stock < 20% της χωρητικότητας ή < 10 μονάδες."
          active={stockCardFilter === 'low'}
          onClick={() => setStockCardFilter(stockCardFilter === 'low' ? 'all' : 'low')}
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
            options={[{ value: 'all', label: 'All Categories' }, ...categories.map(c => ({ value: c, label: c }))]}
          />

          {/* Margin Filter */}
          <DropdownFilter
            value={marginFilter}
            onChange={setMarginFilter}
            options={[
              { value: 'all', label: 'All Margins' },
              { value: 'high', label: 'High Margin' },
              { value: 'medium', label: 'Medium Margin' },
              { value: 'low', label: 'Low Margin' }
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
                <th className="px-4 py-3 text-left text-xs font-medium text-[#4A4A4A]">
                  <button
                    onClick={() => handleSort('name')}
                    className="flex items-center gap-1 hover:text-[#1A1A1A]"
                  >
                    Product
                    <SortIcon field="name" current={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#4A4A4A]">
                  <span className="inline-flex items-center gap-1">
                    Category
                    <Tooltip content="Κατηγορία προϊόντος (π.χ. από DSS: Προμηθευτής)." size={12} />
                  </span>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#4A4A4A]">
                  <button
                    onClick={() => handleSort('margin_percentage')}
                    className="flex items-center gap-1 hover:text-[#1A1A1A]"
                  >
                    Gross Margin
                    <SortIcon field="margin_percentage" current={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#4A4A4A]">
                  <button
                    onClick={() => handleSort('stock_level')}
                    className="flex items-center gap-1 hover:text-[#1A1A1A]"
                  >
                    Stock Level
                    <SortIcon field="stock_level" current={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#4A4A4A]">
                  <Tooltip content="Ημέρες από First_Available_Date ή Stock_Age_Days από αρχείο." size={12}>
                    <button
                      onClick={() => handleSort('stock_age_days')}
                      className="flex items-center gap-1 hover:text-[#1A1A1A]"
                    >
                      Stock Age
                      <SortIcon field="stock_age_days" current={sortField} direction={sortDirection} />
                    </button>
                  </Tooltip>
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#4A4A4A]">
                  Priority Tag
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-[#4A4A4A]">
                  <button
                    onClick={() => handleSort('price')}
                    className="flex items-center gap-1 hover:text-[#1A1A1A]"
                  >
                    Price
                    <SortIcon field="price" current={sortField} direction={sortDirection} />
                  </button>
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-[#4A4A4A]">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {paginatedProducts.map((product, index) => (
                  <ProductRow key={product.id} product={product} index={index} />
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
      />
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
  index: number;
}

function ProductRow({ product, index }: ProductRowProps) {
  const stockPercentage = (product.stock_capacity && product.stock_capacity > 0)
    ? (product.stock_level / product.stock_capacity) * 100
    : 0;
  const stockColor = stockPercentage > 80 ? '#EF4444' : stockPercentage > 50 ? '#F59E0B' : '#22C55E';
  const ageDays = getStockAgeDays(product);
  const ageColor = ageDays > 180 ? '#EF4444' : ageDays > 90 ? '#F59E0B' : '#22C55E';

  return (
    <motion.tr
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ delay: index * 0.02 }}
      className="border-b border-[#E5E5E5] hover:bg-[#F5F5F5] transition-colors"
    >
      <td className="px-4 py-3">
        <div>
          <p className="text-sm font-medium text-[#1A1A1A] truncate max-w-[200px]">
            {product.name}
          </p>
          <p className="text-xs text-[#9CA3AF]">{product.sku}</p>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-[#4A4A4A]">{product.category}</span>
      </td>
      <td className="px-4 py-3">
        <Badge
          variant={
            product.margin_tier === 'high' ? 'success' :
            product.margin_tier === 'medium' ? 'warning' : 'danger'
          }
        >
          {formatPercent(product.margin_percentage ?? 0, 1)}
        </Badge>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <ProgressBar
            value={product.stock_level ?? 0}
            max={Math.max(product.stock_capacity ?? 0, 1)}
            color={stockColor}
            size="sm"
            className="w-16"
          />
          <span className="text-xs text-[#4A4A4A] font-mono w-8">
            {product.stock_level}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span
          className="text-sm font-mono"
          style={{ color: ageColor }}
        >
          {getStockAgeDays(product)}d
        </span>
      </td>
      <td className="px-4 py-3">
        {product.priority_tag ? (
          <Badge
            variant={
              product.priority_tag === 'Brand Push' ? 'info' :
              product.priority_tag === 'New Launch' ? 'success' :
              product.priority_tag === 'Best Seller' ? 'orange' :
              product.priority_tag === 'Clearance' ? 'warning' : 'default'
            }
          >
            {product.priority_tag}
          </Badge>
        ) : (
          <span className="text-xs text-[#9CA3AF]">—</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="text-sm font-mono text-[#1A1A1A]">
          €{formatCurrency(product.price ?? 0, 2)}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <button className="text-xs font-medium text-[var(--nts-accent)] hover:underline">
          Προσθήκη στο Feed
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
