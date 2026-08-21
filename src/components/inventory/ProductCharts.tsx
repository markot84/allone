import { useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, Package, AlertTriangle, BarChart3 } from 'lucide-react';
import { Card, Button, ModalHeader } from '../common';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { axisProps, gridProps, legendProps, seriesColor, tooltipProps } from '../../styles/chartTheme';
import { getStockAgeDays, resolveStockHealth } from '../../utils/productUtils';
import type { Product } from '../../types';
import type { ProductIntelligenceCharts } from '../../services/productIntelligenceAggregate';
import { logger } from '../../utils/logger';

interface ProductChartsProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  supplierTodMap?: Map<string, number>;
  useProcurementRowModel?: boolean;
  aggregateCharts?: ProductIntelligenceCharts;
  totalProducts?: number;
}

export function ProductCharts({ isOpen, onClose, products, supplierTodMap, useProcurementRowModel, aggregateCharts, totalProducts }: ProductChartsProps) {
  // Debug: Log products count and sample data (dev-only via devLog).
  useEffect(() => {
    if (isOpen) {
      logger.debug('[ProductCharts] Products count:', { count: products.length });
      if (products.length > 0) {
        const sample = products[0];
        logger.debug('[ProductCharts] Sample product:', {
          name: sample.name,
          margin_percentage: sample.margin_percentage,
          stock_level: sample.stock_level,
          stock_age_days: sample.stock_age_days,
          category: sample.category
        });
      }
    }
  }, [isOpen, products]);

  // Always calculate data (hooks must be called unconditionally)

  // Margin Distribution
  const marginDistribution = useMemo(() => {
    const ranges = [
      { name: '0-10%', min: 0, max: 10, count: 0 },
      { name: '10-20%', min: 10, max: 20, count: 0 },
      { name: '20-30%', min: 20, max: 30, count: 0 },
      { name: '30-40%', min: 30, max: 40, count: 0 },
      { name: '40-50%', min: 40, max: 50, count: 0 },
      { name: '50%+', min: 50, max: 100, count: 0 }
    ];

    products.forEach(p => {
      const margin = p.margin_percentage || 0;
      if (margin > 0) {
        const range = ranges.find(r => margin >= r.min && margin < (r.max === 100 ? Infinity : r.max));
        if (range) range.count++;
      }
    });

    const hasData = ranges.some(r => r.count > 0);
    logger.debug('[ProductCharts] Margin distribution:', { ranges, hasData, totalProducts: products.length });
    return aggregateCharts?.marginDistribution ?? ranges;
  }, [products, aggregateCharts?.marginDistribution]);

  // Stock Age Distribution
  const stockAgeDistribution = useMemo(() => {
    const ranges = [
      { name: '0-30d', min: 0, max: 30, count: 0 },
      { name: '30-60d', min: 30, max: 60, count: 0 },
      { name: '60-90d', min: 60, max: 90, count: 0 },
      { name: '90-120d', min: 90, max: 120, count: 0 },
      { name: '120-180d', min: 120, max: 180, count: 0 },
      { name: '180d+', min: 180, max: Infinity, count: 0 }
    ];

    products.forEach(p => {
      const age = getStockAgeDays(p);
      if (age >= 0) {
        const range = ranges.find(r => age >= r.min && age < (r.max === Infinity ? Infinity : r.max));
        if (range) range.count++;
      }
      // age === -1: unknown age — not assigned to a bucket (avoid a false "0 days")
    });

    const hasData = ranges.some(r => r.count > 0);
    logger.debug('[ProductCharts] Stock age distribution:', { ranges, hasData });
    return aggregateCharts?.stockAgeDistribution ?? ranges;
  }, [products, aggregateCharts?.stockAgeDistribution]);

  // Category Breakdown
  const categoryBreakdown = useMemo(() => {
    const categoryMap = new Map<string, number>();
    products.forEach(p => {
      const cat = p.category || 'Uncategorized';
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
    });

    const result = Array.from(categoryMap.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    logger.debug('[ProductCharts] Category breakdown:', { result });
    return aggregateCharts?.categoryBreakdown ?? result;
  }, [products, aggregateCharts?.categoryBreakdown]);

  // Stock Level Status (TOD-based)
  const stockStatus = useMemo(() => {
    let healthy = 0;
    let low = 0;
    let excess = 0;
    let dead = 0;
    let noStock = 0;

    products.forEach(p => {
      const stock = p.available_stock ?? p.stock_on_hand ?? p.stock_level ?? 0;
      if (stock <= 0) {
        noStock++;
        return;
      }
      const health = resolveStockHealth(p, supplierTodMap, useProcurementRowModel);
      switch (health) {
        case 'dead': dead++; break;
        case 'low': low++; break;
        case 'excess': excess++; break;
        default: healthy++;
      }
    });

    const result = [
      { name: 'Healthy Stock', value: healthy, color: 'var(--success-700)' },
      { name: 'Low Stock', value: low, color: 'var(--seg-potential)' },
      { name: 'Excess Stock', value: excess, color: 'var(--orange-700)' },
      { name: 'Dead Stock', value: dead, color: 'var(--danger-600)' },
      { name: 'No Stock', value: noStock, color: 'var(--text-muted)' }
    ];
    logger.debug('[ProductCharts] Stock status:', { result });
    return aggregateCharts?.stockStatus ?? result;
  }, [products, supplierTodMap, useProcurementRowModel, aggregateCharts?.stockStatus]);

  // Top Products by Margin
  const topProductsByMargin = useMemo(() => {
    const result = [...products]
      .sort((a, b) => (b.margin_percentage || 0) - (a.margin_percentage || 0))
      .slice(0, 10)
      .map(p => ({
        name: (p.name || p.sku || 'Unknown').substring(0, 20),
        margin: p.margin_percentage || 0,
        price: p.price || 0
      }));
    logger.debug('[ProductCharts] Top products by margin:', { result });
    return aggregateCharts?.topProductsByMargin ?? result;
  }, [products, aggregateCharts?.topProductsByMargin]);

  // Stock Age vs Stock Level (scatter-like)
  const stockAgeVsLevel = useMemo(() => {
    const result = products
      .filter((p) => (p.stock_level || 0) > 0 && getStockAgeDays(p) >= 0)
      .slice(0, 100) // Limit for performance
      .map(p => ({
        age: getStockAgeDays(p),
        level: p.stock_level || 0,
        margin: p.margin_percentage || 0
      }))
      .sort((a, b) => a.age - b.age);
    logger.debug('[ProductCharts] Stock age vs level:', { count: result.length });
    return aggregateCharts?.stockAgeVsLevel ?? result;
  }, [products, aggregateCharts?.stockAgeVsLevel]);

  // Early return after all hooks
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-auto"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[90vh] overflow-auto my-8"
            onClick={(e) => e.stopPropagation()}
          >
        <ModalHeader
          className="sticky top-0 z-10 bg-white"
          toolbarAriaLabel="Κλείσιμο"
          title={
            <div className="flex min-w-0 items-start gap-3">
              <BarChart3 size={24} className="shrink-0 text-[var(--nts-accent-text)]" />
              <div className="min-w-0">
                <h2 className="text-xl font-bold text-[var(--text-primary)]">Οπτικοποίηση δεδομένων προϊόντων</h2>
                <p className="text-sm text-[var(--text-secondary)]">{aggregateCharts ? `${totalProducts ?? products.length} προϊόντα σε full-inventory ανάλυση` : `${products.length} προϊόντα σε ανάλυση`}</p>
              </div>
            </div>
          }
          actions={
            <button type="button" onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-[var(--surface-2)]">
              <X size={20} className="text-[var(--text-secondary)]" />
            </button>
          }
        />

        {/* Charts Grid */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Margin Distribution */}
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={18} className="text-[var(--success-700)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">Κατανομή margin</h3>
            </div>
            {(() => {
              const hasData = marginDistribution.some(r => r.count > 0);
              logger.debug('[ProductCharts] Rendering Margin Distribution, hasData:', { hasData, data: marginDistribution });
              return hasData ? (
                <div style={{ width: '100%', height: '300px', minHeight: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={marginDistribution} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <CartesianGrid {...gridProps()} />
                      <XAxis dataKey="name" {...axisProps()} />
                      <YAxis {...axisProps()} width={52} />
                      <Tooltip {...tooltipProps()} />
                      <Legend {...legendProps()} />
                      <Bar dataKey="count" fill="var(--success-700)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[300px] text-[var(--text-secondary)]">
                  <p>Δεν υπάρχουν δεδομένα για κατανομή margin</p>
                  <p className="text-xs mt-2">Προϊόντα: {products.length}</p>
                  {products.length > 0 && (
                    <>
                      <p className="text-xs mt-1">Δείγμα margin: {products.slice(0, 5).map(p => (p.margin_percentage || 0).toFixed(1)).join(', ')}%</p>
                      <p className="text-xs mt-1">Distribution: {JSON.stringify(marginDistribution)}</p>
                    </>
                  )}
                </div>
              );
            })()}
          </Card>

          {/* Stock Age Distribution */}
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={18} className="text-[var(--orange-700)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">Κατανομή ηλικίας αποθέματος</h3>
            </div>
            {stockAgeDistribution.some(r => r.count > 0) ? (
              <div style={{ width: '100%', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stockAgeDistribution} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid {...gridProps()} />
                    <XAxis dataKey="name" {...axisProps()} />
                    <YAxis {...axisProps()} width={52} />
                    <Tooltip {...tooltipProps()} />
                    <Legend {...legendProps()} />
                    <Bar dataKey="count" fill="var(--orange-700)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[var(--text-secondary)]">
                <p>Δεν υπάρχουν δεδομένα για ηλικία αποθέματος</p>
              </div>
            )}
          </Card>

          {/* Stock Status Pie */}
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <Package size={18} className="text-[var(--text-muted)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">Κατάσταση αποθέματος</h3>
            </div>
            {stockStatus.some((s: { value: number }) => s.value > 0) ? (
              <div style={{ width: '100%', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stockStatus}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${percent ? (percent * 100).toFixed(0) : 0}%`}
                      outerRadius={100}
                      fill={seriesColor(0)}
                      dataKey="value"
                    >
                      {stockStatus.map((entry: { color: string }, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipProps()} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[var(--text-secondary)]">
                <p>Δεν υπάρχουν δεδομένα για κατάσταση αποθέματος</p>
              </div>
            )}
          </Card>

          {/* Category Breakdown */}
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={18} className="text-[var(--seg-potential)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">Κύριες κατηγορίες</h3>
            </div>
            {categoryBreakdown.length > 0 ? (
              <div style={{ width: '100%', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryBreakdown} layout="vertical" margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid {...gridProps()} />
                    <XAxis type="number" {...axisProps()} />
                    <YAxis dataKey="name" type="category" width={100} {...axisProps()} />
                    <Tooltip {...tooltipProps()} />
                    <Legend {...legendProps()} />
                    <Bar dataKey="count" fill="var(--seg-potential)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[var(--text-secondary)]">
                <p>Δεν υπάρχουν δεδομένα για κατηγορίες</p>
              </div>
            )}
          </Card>

          {/* Top Products by Margin */}
          <Card padding="lg" className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={18} className="text-[var(--success-700)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">Top 10 προϊόντα ανά margin</h3>
            </div>
            {topProductsByMargin.length > 0 ? (
              <div style={{ width: '100%', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProductsByMargin} margin={{ top: 5, right: 5, left: 5, bottom: 80 }}>
                    <CartesianGrid {...gridProps()} />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} {...axisProps()} interval={0} />
                    <YAxis {...axisProps()} width={52} />
                    <Tooltip {...tooltipProps()} />
                    <Legend {...legendProps()} />
                    <Bar dataKey="margin" fill="var(--success-700)" name="Margin %" />
                    <Bar dataKey="price" fill={seriesColor(0)} name="Τιμή (€)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[var(--text-secondary)]">
                <p>Δεν υπάρχουν δεδομένα για κορυφαία προϊόντα</p>
              </div>
            )}
          </Card>

          {/* Stock Age vs Level */}
          <Card padding="lg" className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={18} className="text-[var(--nts-accent-text)]" />
              <h3 className="font-semibold text-[var(--text-primary)]">Ηλικία vs επίπεδο αποθέματος (δείγμα)</h3>
            </div>
            {stockAgeVsLevel.length > 0 ? (
              <div style={{ width: '100%', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stockAgeVsLevel} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid {...gridProps()} />
                    <XAxis dataKey="age" name="Ημέρες" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip {...tooltipProps()} />
                    <Legend {...legendProps()} />
                    <Line yAxisId="left" type="monotone" dataKey="level" stroke={seriesColor(0)} name="Απόθεμα" />
                    <Line yAxisId="right" type="monotone" dataKey="margin" stroke="var(--success-700)" name="Margin %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[var(--text-secondary)]">
                <p>Δεν υπάρχουν δεδομένα για ηλικία vs επίπεδο αποθέματος</p>
              </div>
            )}
          </Card>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[var(--border)] flex justify-end">
          <Button variant="primary" onClick={onClose}>
            Κλείσιμο
          </Button>
        </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  );
}
