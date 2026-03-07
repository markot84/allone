import { useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, TrendingUp, Package, AlertTriangle, BarChart3 } from 'lucide-react';
import { Card, Button } from '../common';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { getStockAgeDays } from '../../utils/productUtils';
import type { Product } from '../../types';

interface ProductChartsProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
}

export function ProductCharts({ isOpen, onClose, products }: ProductChartsProps) {
  // Debug: Log products count and sample data
  useEffect(() => {
    if (isOpen) {
      console.log('[ProductCharts] Products count:', products.length);
      if (products.length > 0) {
        const sample = products[0];
        console.log('[ProductCharts] Sample product:', {
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
    console.log('[ProductCharts] Margin distribution:', ranges, 'hasData:', hasData, 'totalProducts:', products.length);
    return ranges;
  }, [products]);

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
    });

    const hasData = ranges.some(r => r.count > 0);
    console.log('[ProductCharts] Stock age distribution:', ranges, 'hasData:', hasData);
    return ranges;
  }, [products]);

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
    console.log('[ProductCharts] Category breakdown:', result);
    return result;
  }, [products]);

  // Stock Level Status
  const stockStatus = useMemo(() => {
    let healthy = 0;
    let low = 0;
    let excess = 0;
    let empty = 0;

    products.forEach(p => {
      const level = p.stock_level || 0;
      const capacity = Math.max(p.stock_capacity || 0, 1);
      const ratio = level / capacity;

      if (level === 0) {
        empty++;
      } else if (ratio < 0.2 || level < 10) {
        low++;
      } else if (ratio > 0.8) {
        excess++;
      } else {
        healthy++;
      }
    });

    const result = [
      { name: 'Healthy', value: healthy, color: '#22C55E' },
      { name: 'Low Stock', value: low, color: '#F59E0B' },
      { name: 'Excess Stock', value: excess, color: '#EF4444' },
      { name: 'Empty', value: empty, color: '#9CA3AF' }
    ];
    console.log('[ProductCharts] Stock status:', result);
    return result;
  }, [products]);

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
    console.log('[ProductCharts] Top products by margin:', result);
    return result;
  }, [products]);

  // Stock Age vs Stock Level (scatter-like)
  const stockAgeVsLevel = useMemo(() => {
    const result = products
      .filter(p => (p.stock_level || 0) > 0)
      .slice(0, 100) // Limit for performance
      .map(p => ({
        age: getStockAgeDays(p),
        level: p.stock_level || 0,
        margin: p.margin_percentage || 0
      }))
      .sort((a, b) => a.age - b.age);
    console.log('[ProductCharts] Stock age vs level:', result.length, 'items');
    return result;
  }, [products]);

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
        {/* Header */}
        <div className="p-6 border-b border-[#E5E5E5] flex items-center justify-between sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <BarChart3 size={24} className="text-[var(--nts-accent)]" />
            <div>
              <h2 className="text-xl font-bold text-[#1A1A1A]">Product Data Visualization</h2>
              <p className="text-sm text-[#4A4A4A]">{products.length} products analyzed</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
          >
            <X size={20} className="text-[#4A4A4A]" />
          </button>
        </div>

        {/* Charts Grid */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Margin Distribution */}
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={18} className="text-[#22C55E]" />
              <h3 className="font-semibold text-[#1A1A1A]">Margin Distribution</h3>
            </div>
            {(() => {
              const hasData = marginDistribution.some(r => r.count > 0);
              console.log('[ProductCharts] Rendering Margin Distribution, hasData:', hasData, 'data:', marginDistribution);
              return hasData ? (
                <div style={{ width: '100%', height: '300px', minHeight: '300px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={marginDistribution} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                      <XAxis dataKey="name" stroke="#4A4A4A" />
                      <YAxis stroke="#4A4A4A" />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="count" fill="#22C55E" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-[300px] text-[#4A4A4A]">
                  <p>Δεν υπάρχουν δεδομένα για margin distribution</p>
                  <p className="text-xs mt-2">Products: {products.length}</p>
                  {products.length > 0 && (
                    <>
                      <p className="text-xs mt-1">Sample margins: {products.slice(0, 5).map(p => (p.margin_percentage || 0).toFixed(1)).join(', ')}%</p>
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
              <AlertTriangle size={18} className="text-[#F59E0B]" />
              <h3 className="font-semibold text-[#1A1A1A]">Stock Age Distribution</h3>
            </div>
            {stockAgeDistribution.some(r => r.count > 0) ? (
              <div style={{ width: '100%', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stockAgeDistribution} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="count" fill="#F59E0B" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[#4A4A4A]">
                <p>Δεν υπάρχουν δεδομένα για stock age distribution</p>
              </div>
            )}
          </Card>

          {/* Stock Status Pie */}
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <Package size={18} className="text-[#3B82F6]" />
              <h3 className="font-semibold text-[#1A1A1A]">Stock Status</h3>
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
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {stockStatus.map((entry: { color: string }, index: number) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[#4A4A4A]">
                <p>Δεν υπάρχουν δεδομένα για stock status</p>
              </div>
            )}
          </Card>

          {/* Category Breakdown */}
          <Card padding="lg">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={18} className="text-[#8B5CF6]" />
              <h3 className="font-semibold text-[#1A1A1A]">Top Categories</h3>
            </div>
            {categoryBreakdown.length > 0 ? (
              <div style={{ width: '100%', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryBreakdown} layout="vertical" margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={100} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="count" fill="#8B5CF6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[#4A4A4A]">
                <p>Δεν υπάρχουν δεδομένα για categories</p>
              </div>
            )}
          </Card>

          {/* Top Products by Margin */}
          <Card padding="lg" className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp size={18} className="text-[#22C55E]" />
              <h3 className="font-semibold text-[#1A1A1A]">Top 10 Products by Margin</h3>
            </div>
            {topProductsByMargin.length > 0 ? (
              <div style={{ width: '100%', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topProductsByMargin} margin={{ top: 5, right: 5, left: 5, bottom: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="margin" fill="#22C55E" name="Margin %" />
                    <Bar dataKey="price" fill="#3B82F6" name="Price (€)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[#4A4A4A]">
                <p>Δεν υπάρχουν δεδομένα για top products</p>
              </div>
            )}
          </Card>

          {/* Stock Age vs Level */}
          <Card padding="lg" className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={18} className="text-[var(--nts-accent)]" />
              <h3 className="font-semibold text-[#1A1A1A]">Stock Age vs Stock Level (Sample)</h3>
            </div>
            {stockAgeVsLevel.length > 0 ? (
              <div style={{ width: '100%', height: '300px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stockAgeVsLevel} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="age" name="Age (days)" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="level" stroke="#3B82F6" name="Stock Level" />
                    <Line yAxisId="right" type="monotone" dataKey="margin" stroke="#22C55E" name="Margin %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[#4A4A4A]">
                <p>Δεν υπάρχουν δεδομένα για stock age vs level</p>
              </div>
            )}
          </Card>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-[#E5E5E5] flex justify-end">
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
