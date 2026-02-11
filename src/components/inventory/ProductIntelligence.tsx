import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Package,
  AlertTriangle,
  AlertCircle,
  Info,
  Search,
  ChevronDown,
  ChevronUp,
  Download,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { Card, Badge, Button, ProgressBar, Spinner, Tooltip } from '../common';
import { useProducts } from '../../hooks';
import { categories as mockCategories } from '../../data/mockProducts';
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
    const ageDays = p.stock_age_days ?? 0;
    const ratio = level / capacity;

    totalValue += level * price;

    if (ageDays > 180) {
      deadCount++;
      deadValue += level * price;
    } else if (ratio > 0.8) {
      excessCount++;
      excessValue += level * price;
    } else if (ratio < 0.2 || level < 10) {
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
  const deadStock = products.filter((p) => (p.stock_age_days ?? 0) > 180);
  const nearDead = products.filter((p) => (p.stock_age_days ?? 0) > 120 && (p.stock_age_days ?? 0) <= 180);
  const highMarginLowStock = products.filter(
    (p) => (p.margin_tier === 'high' || (p.margin_percentage ?? 0) > 25) && ((p.stock_level ?? 0) < 10 || (p.stock_level ?? 0) / Math.max(p.stock_capacity ?? 1, 1) < 0.2)
  );
  if (deadStock.length > 0) alerts.push({ type: 'critical', message: `${deadStock.length} SKU(s) με stock age > 180 ημέρες`, action: 'Ελέγξτε για clearance' });
  if (nearDead.length > 0) alerts.push({ type: 'warning', message: `${nearDead.length} SKU(s) πλησιάζουν dead stock`, action: 'Δημιουργήστε προσφορές' });
  if (highMarginLowStock.length > 0) alerts.push({ type: 'info', message: `${highMarginLowStock.length} high-margin items με low stock`, action: 'Πρόταση αναπλήρωσης' });
  return alerts.length > 0 ? alerts : [];
}

export function ProductIntelligence() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [marginFilter, setMarginFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('margin_percentage');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 20;

  const { products, isLoading: productsLoading, hasImported } = useProducts();
  const inventorySummary = useMemo(() => computeInventorySummary(products), [products]);
  const inventoryAlerts = useMemo(() => computeInventoryAlerts(products), [products]);
  const categories = useMemo(() => {
    const fromProducts = [...new Set(products.map(p => p.category))].filter(Boolean).sort();
    return fromProducts.length > 0 ? fromProducts : mockCategories;
  }, [products]);

  // Filter and sort products
  const filteredProducts = useMemo(() => {
    return products
      .filter((p) => {
        const matchesSearch = (p.name ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                             (p.sku ?? '').toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || (p.category ?? '') === selectedCategory;
        const matchesMargin = marginFilter === 'all' || p.margin_tier === marginFilter;
        return matchesSearch && matchesCategory && matchesMargin;
      })
      .sort((a, b) => {
        const aVal = a[sortField];
        const bVal = b[sortField];
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return sortDirection === 'asc' 
            ? aVal.localeCompare(bVal) 
            : bVal.localeCompare(aVal);
        }
        return sortDirection === 'asc' 
          ? (aVal as number) - (bVal as number) 
          : (bVal as number) - (aVal as number);
      });
  }, [searchQuery, selectedCategory, marginFilter, sortField, sortDirection]);

  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  if (productsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Spinner size="lg" label="Φόρτωση προϊόντων…" />
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
        <Button variant="secondary" icon={<Download size={16} />}>
          Export Report
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <SummaryCard
          label="Total SKUs"
          value={inventorySummary.total_skus.toLocaleString()}
          icon={<Package size={20} />}
          color="#3B82F6"
          tooltip="Συνολικός αριθμός προϊόντων (SKU) στο inventory."
        />
        <SummaryCard
          label="Healthy Stock"
          value={`${inventorySummary.healthy_stock.percentage}%`}
          subValue={inventorySummary.healthy_stock.count.toLocaleString()}
          icon={<TrendingUp size={20} />}
          color="#22C55E"
          tooltip="Προϊόντα με stock 20–80% της χωρητικότητας και ηλικία < 180 ημερών."
        />
        <SummaryCard
          label="Excess Stock"
          value={inventorySummary.excess_stock.value >= 1000
            ? `€${(inventorySummary.excess_stock.value / 1000).toFixed(1)}K`
            : `€${inventorySummary.excess_stock.value.toLocaleString()}`}
          subValue={`${inventorySummary.excess_stock.count} SKUs`}
          icon={<AlertTriangle size={20} />}
          color="#F59E0B"
          tooltip="Προϊόντα με stock > 80% της χωρητικότητας (υπερπλήρωση)."
        />
        <SummaryCard
          label="Dead Stock"
          value={inventorySummary.dead_stock.value >= 1000
            ? `€${(inventorySummary.dead_stock.value / 1000).toFixed(1)}K`
            : `€${inventorySummary.dead_stock.value.toLocaleString()}`}
          subValue={`${inventorySummary.dead_stock.count} SKUs`}
          icon={<AlertCircle size={20} />}
          color="#EF4444"
          tooltip="Προϊόντα με stock_age > 180 ημερών (αδρανές απόθεμα)."
        />
        <SummaryCard
          label="Low Stock"
          value={`${inventorySummary.low_stock.percentage}%`}
          subValue={`${inventorySummary.low_stock.count} SKUs`}
          icon={<TrendingDown size={20} />}
          color="#8B5CF6"
          tooltip="Προϊόντα με stock < 20% της χωρητικότητας ή < 10 μονάδες."
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
                  'border-l-[#3B82F6] bg-[#DBEAFE]'}
              `}
            >
              <div className="flex items-start gap-3">
                {alert.type === 'critical' ? (
                  <AlertCircle size={20} className="text-[#EF4444] flex-shrink-0" />
                ) : alert.type === 'warning' ? (
                  <AlertTriangle size={20} className="text-[#F59E0B] flex-shrink-0" />
                ) : (
                  <Info size={20} className="text-[#3B82F6] flex-shrink-0" />
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium text-[#1A1A1A]">{alert.message}</p>
                  <button className="text-xs font-medium text-[#FF6B35] mt-1 hover:underline">
                    {alert.action} →
                  </button>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Product Table */}
      <Card padding="none">
        {/* Filters */}
        <div className="p-4 border-b border-[#E5E5E5] flex flex-wrap gap-4 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-[200px]">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
            <input
              type="text"
              placeholder="Search products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[#FF6B35] focus:bg-white transition-all"
            />
          </div>

          {/* Category Filter */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-4 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[#FF6B35] focus:bg-white transition-all"
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>

          {/* Margin Filter */}
          <select
            value={marginFilter}
            onChange={(e) => setMarginFilter(e.target.value)}
            className="px-4 py-2 bg-[#F5F5F5] border border-transparent rounded-lg text-sm focus:outline-none focus:border-[#FF6B35] focus:bg-white transition-all"
          >
            <option value="all">All Margins</option>
            <option value="high">High Margin</option>
            <option value="medium">Medium Margin</option>
            <option value="low">Low Margin</option>
          </select>

          <div className="text-sm text-[#4A4A4A]">
            {filteredProducts.length} products
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
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
                    Margin
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
                  <button
                    onClick={() => handleSort('stock_age_days')}
                    className="flex items-center gap-1 hover:text-[#1A1A1A]"
                  >
                    Stock Age
                    <SortIcon field="stock_age_days" current={sortField} direction={sortDirection} />
                  </button>
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
        <div className="p-4 border-t border-[#E5E5E5] flex items-center justify-between">
          <p className="text-sm text-[#4A4A4A]">
            Showing {(currentPage - 1) * itemsPerPage + 1} to{' '}
            {Math.min(currentPage * itemsPerPage, filteredProducts.length)} of{' '}
            {filteredProducts.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(currentPage - 1)}
            >
              Previous
            </Button>
            {[...Array(Math.min(5, totalPages))].map((_, i) => {
              const page = i + 1;
              return (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`
                    w-8 h-8 rounded-lg text-sm font-medium transition-colors
                    ${currentPage === page
                      ? 'bg-[#FF6B35] text-white'
                      : 'text-[#4A4A4A] hover:bg-[#F5F5F5]'}
                  `}
                >
                  {page}
                </button>
              );
            })}
            {totalPages > 5 && (
              <>
                <span className="text-[#4A4A4A]">...</span>
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  className={`
                    w-8 h-8 rounded-lg text-sm font-medium transition-colors
                    ${currentPage === totalPages
                      ? 'bg-[#FF6B35] text-white'
                      : 'text-[#4A4A4A] hover:bg-[#F5F5F5]'}
                  `}
                >
                  {totalPages}
                </button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
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
}

function SummaryCard({ label, value, subValue, icon, color, tooltip }: SummaryCardProps) {
  return (
    <Card padding="md" hover>
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          <span style={{ color }}>{icon}</span>
        </div>
        <div>
          <p className="text-sm text-[#4A4A4A]">
            {tooltip ? <Tooltip content={tooltip}>{label}</Tooltip> : label}
          </p>
          <p className="text-xl font-bold text-[#1A1A1A] font-mono">{value}</p>
          {subValue && (
            <p className="text-xs text-[#9CA3AF]">{subValue}</p>
          )}
        </div>
      </div>
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
  const ageColor = product.stock_age_days > 180 ? '#EF4444' : product.stock_age_days > 90 ? '#F59E0B' : '#22C55E';

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
          {(product.margin_percentage ?? 0).toFixed(1)}%
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
          {(product.stock_age_days ?? 0)}d
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
          €{(product.price ?? 0).toFixed(2)}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <button className="text-xs font-medium text-[#FF6B35] hover:underline">
          Add to Feed
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
