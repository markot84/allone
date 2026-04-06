import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ShoppingBag,
  ShoppingCart,
  Package,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ArrowRight,
} from 'lucide-react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardHeader, KPICard } from '../common';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { formatCurrencyCompact, formatNumber } from '../../utils/format';
import type { KPICardData } from '../common/KPICard';

const PLATFORM_LABELS: Record<string, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
  opencart: 'OpenCart',
  magento: 'Magento',
};

const PLATFORM_COLORS: Record<string, string> = {
  shopify: '#96BF48',
  woocommerce: '#7F54B3',
  opencart: '#23AFFE',
  magento: '#F46F25',
};

type OrderSortField = 'createdAt' | 'total' | 'platform';

const TOOLTIP_STYLE: React.CSSProperties = {
  backgroundColor: '#fff',
  border: '1px solid #d0d7de',
  borderRadius: 6,
  fontSize: 12,
  padding: '8px 12px',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
};

function OrderStatusBadge({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  let bg = '#F3F4F6';
  let fg = '#6B7280';

  if (['paid', 'completed', 'complete', 'fulfilled', 'processing'].includes(s)) {
    bg = '#DCFCE7'; fg = '#16A34A';
  } else if (['pending', 'on-hold', 'on_hold', 'authorized'].includes(s)) {
    bg = '#FEF3C7'; fg = '#D97706';
  } else if (['refunded', 'cancelled', 'canceled', 'voided', 'failed'].includes(s)) {
    bg = '#FEE2E2'; fg = '#DC2626';
  } else if (['partially_refunded', 'partial'].includes(s)) {
    bg = '#FFF7ED'; fg = '#EA580C';
  }

  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ backgroundColor: bg, color: fg }}
    >
      {status || '—'}
    </span>
  );
}

export function EcommerceDashboard() {
  const ecomm = useEcommerceSummary();
  const [orderSort, setOrderSort] = useState<{ field: OrderSortField; dir: 'asc' | 'desc' }>({ field: 'createdAt', dir: 'desc' });
  const [prodSort, setProdSort] = useState<{ field: 'revenue' | 'quantity'; dir: 'asc' | 'desc' }>({ field: 'revenue', dir: 'desc' });

  const kpis: KPICardData[] = useMemo(() => [
    {
      label: 'Store Revenue',
      value: formatCurrencyCompact(ecomm.totalRevenue),
      tooltip: 'Σύνολο εσόδων από e-commerce (90 ημέρες)',
      sparklineData: ecomm.dailyRevenue.slice(-30).map((d) => d.revenue),
    },
    {
      label: 'Παραγγελίες',
      value: formatNumber(ecomm.orderCount),
      tooltip: 'Σύνολο παραγγελιών (90 ημέρες)',
      sparklineData: ecomm.dailyRevenue.slice(-30).map((_, i) => {
        const date = ecomm.dailyRevenue[ecomm.dailyRevenue.length - 30 + i]?.date;
        if (!date) return 0;
        const orders = ecomm.recentOrders.filter((o) => o.createdAt?.startsWith(date));
        return orders.length;
      }),
    },
    {
      label: 'AOV',
      value: formatCurrencyCompact(ecomm.aov),
      tooltip: 'Μέσο ποσό ανά παραγγελία',
    },
    {
      label: 'Platforms',
      value: String(ecomm.connectedPlatforms.length),
      tooltip: ecomm.connectedPlatforms.map((p) => PLATFORM_LABELS[p] || p).join(', ') || 'Κανένα',
    },
  ], [ecomm]);

  const sortedOrders = useMemo(() => {
    const arr = [...ecomm.recentOrders];
    arr.sort((a, b) => {
      const dir = orderSort.dir === 'asc' ? 1 : -1;
      if (orderSort.field === 'createdAt') return dir * a.createdAt.localeCompare(b.createdAt);
      if (orderSort.field === 'total') return dir * (a.total - b.total);
      return dir * a.platform.localeCompare(b.platform);
    });
    return arr;
  }, [ecomm.recentOrders, orderSort]);

  const sortedProducts = useMemo(() => {
    const arr = [...ecomm.topProducts];
    arr.sort((a, b) => {
      const dir = prodSort.dir === 'asc' ? 1 : -1;
      return dir * (a[prodSort.field] - b[prodSort.field]);
    });
    return arr;
  }, [ecomm.topProducts, prodSort]);

  const toggleOrderSort = (field: OrderSortField) => {
    setOrderSort((prev) => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const toggleProdSort = (field: 'revenue' | 'quantity') => {
    setProdSort((prev) => ({
      field,
      dir: prev.field === field && prev.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const SortIcon = ({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) =>
    active ? (dir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronDown size={12} className="opacity-30" />;

  // Loading state
  if (ecomm.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-[#1A1A1A] flex items-center gap-2">
            <ShoppingBag size={22} className="text-[var(--nts-accent)]" />
            E-commerce
          </h2>
          <p className="text-sm text-[#6B7280] mt-1">Δεδομένα παραγγελιών και προϊόντων από τα συνδεδεμένα e-shop</p>
        </div>
        <div className="py-16 text-center text-[#6B7280]">
          <div className="animate-spin h-8 w-8 border-2 border-orange-400 border-t-transparent rounded-full mx-auto mb-3" />
          Φόρτωση e-commerce δεδομένων…
        </div>
      </div>
    );
  }

  // Empty state
  if (!ecomm.hasData) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-[#1A1A1A] flex items-center gap-2">
            <ShoppingBag size={22} className="text-[var(--nts-accent)]" />
            E-commerce
          </h2>
          <p className="text-sm text-[#6B7280] mt-1">Δεδομένα παραγγελιών και προϊόντων από τα συνδεδεμένα e-shop</p>
        </div>

        <Card>
          <div className="p-10 text-center">
            <ShoppingCart size={48} className="mx-auto text-[#D1D5DB] mb-4" />
            <h3 className="text-base font-semibold text-[#1A1A1A] mb-2">Δεν υπάρχουν δεδομένα e-commerce</h3>
            <p className="text-sm text-[#6B7280] mb-6 max-w-md mx-auto">
              Συνδέστε τουλάχιστον ένα e-shop (Shopify, WooCommerce, OpenCart ή Magento) και κάντε sync για να δείτε τα δεδομένα σας εδώ.
            </p>
            <button
              onClick={() => { window.location.hash = '#data'; }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--nts-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <ExternalLink size={14} />
              Μετάβαση στα Connectors
            </button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-[#1A1A1A] flex items-center gap-2">
            <ShoppingBag size={22} className="text-[var(--nts-accent)]" />
            E-commerce
          </h2>
          <p className="text-sm text-[#6B7280] mt-1">
            Δεδομένα {ecomm.connectedPlatforms.map((p) => PLATFORM_LABELS[p] || p).join(', ')} — τελευταίες 90 ημέρες
          </p>
        </div>
        {ecomm.syncedAt && (
          <span className="text-[10px] text-[#9CA3AF]">
            Τελευταίο sync: {ecomm.syncedAt?.toDate?.()
              ? ecomm.syncedAt.toDate().toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
              : '—'}
          </span>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <KPICard key={kpi.label} kpi={kpi} index={i} />
        ))}
      </div>

      {/* Revenue Chart + Platform Breakdown */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Revenue Trend */}
        <Card className="xl:col-span-2">
          <CardHeader title="Έσοδα ανά ημέρα" subtitle="90 ημέρες" />
          <div className="px-5 pb-5">
            {ecomm.dailyRevenue.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={ecomm.dailyRevenue}>
                  <defs>
                    <linearGradient id="ecommRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F97316" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: '#57606a', fontSize: 10 }}
                    tickFormatter={(v: string) => v.slice(5)}
                    axisLine={{ stroke: '#d0d7de' }}
                    tickLine={{ stroke: '#d0d7de' }}
                  />
                  <YAxis
                    tick={{ fill: '#57606a', fontSize: 10 }}
                    tickFormatter={(v: number) => `€${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`}
                    axisLine={{ stroke: '#d0d7de' }}
                    tickLine={{ stroke: '#d0d7de' }}
                  />
                  <RechartsTooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
                    formatter={(v: unknown) => [`€${Number(v ?? 0).toFixed(2)}`, 'Έσοδα']}
                  />
                  <Area type="monotone" dataKey="revenue" stroke="#F97316" fill="url(#ecommRevGrad)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-[#9CA3AF] py-8 text-center">Δεν υπάρχουν δεδομένα εσόδων</p>
            )}
          </div>
        </Card>

        {/* Platform Breakdown */}
        <Card>
          <CardHeader title="Ανά πλατφόρμα" />
          <div className="px-5 pb-5">
            {ecomm.platformBreakdown.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={ecomm.platformBreakdown} layout="vertical">
                    <XAxis type="number" tick={{ fill: '#57606a', fontSize: 10 }} tickFormatter={(v: number) => `€${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`} />
                    <YAxis
                      type="category"
                      dataKey="platform"
                      tick={{ fill: '#374151', fontSize: 11 }}
                      tickFormatter={(v: string) => PLATFORM_LABELS[v] || v}
                      width={90}
                    />
                    <RechartsTooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelStyle={{ color: '#24292f', fontWeight: 600, marginBottom: 4 }}
                      formatter={(v: unknown) => [`€${Number(v ?? 0).toFixed(2)}`, 'Έσοδα']}
                      labelFormatter={(l: string) => PLATFORM_LABELS[l] || l}
                    />
                    <Bar dataKey="revenue" radius={[0, 6, 6, 0]}>
                      {ecomm.platformBreakdown.map((entry) => (
                        <Cell key={entry.platform} fill={PLATFORM_COLORS[entry.platform] || '#94A3B8'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-2.5">
                  {ecomm.platformBreakdown.map((p) => {
                    const pct = ecomm.totalRevenue > 0 ? (p.revenue / ecomm.totalRevenue * 100) : 0;
                    return (
                      <div key={p.platform}>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: PLATFORM_COLORS[p.platform] || '#94A3B8' }} />
                            <span className="text-[#374151] font-medium">{PLATFORM_LABELS[p.platform] || p.platform}</span>
                          </div>
                          <span className="text-[#6B7280]">{p.orders} orders · {pct.toFixed(0)}%</span>
                        </div>
                        <div className="h-1 bg-[#F3F4F6] rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, ease: 'easeOut' }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: PLATFORM_COLORS[p.platform] || '#94A3B8' }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-sm text-[#9CA3AF] py-8 text-center">—</p>
            )}
          </div>
        </Card>
      </div>

      {/* Top Products + Recent Orders */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Top Products */}
        <Card>
          <CardHeader title="Top Products" subtitle="Κατά έσοδα (90 ημ.)" icon={<Package size={16} />} />
          <div className="px-5 pb-5">
            {sortedProducts.length > 0 ? (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-left text-xs" style={{ minWidth: 340 }}>
                  <thead>
                    <tr className="border-b border-[#E5E7EB]">
                      <th className="pb-2.5 font-medium text-[#6B7280] pr-4">Προϊόν</th>
                      <th
                        className="pb-2.5 font-medium text-[#6B7280] text-right cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleProdSort('revenue')}
                      >
                        <span className="inline-flex items-center gap-0.5 hover:text-[#111827] transition-colors">
                          Έσοδα <SortIcon active={prodSort.field === 'revenue'} dir={prodSort.dir} />
                        </span>
                      </th>
                      <th
                        className="pb-2.5 font-medium text-[#6B7280] text-right cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleProdSort('quantity')}
                      >
                        <span className="inline-flex items-center gap-0.5 hover:text-[#111827] transition-colors">
                          Qty <SortIcon active={prodSort.field === 'quantity'} dir={prodSort.dir} />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedProducts.map((p, i) => {
                      const maxRev = sortedProducts[0]?.revenue || 1;
                      const barPct = Math.min(100, (p.revenue / maxRev) * 100);
                      return (
                        <tr
                          key={p.sku + i}
                          className="border-b border-[#F9FAFB] last:border-0 hover:bg-[#F9FAFB] transition-colors"
                        >
                          <td className="py-2.5 pr-4">
                            <p className="text-[#111827] font-medium truncate max-w-[220px]">{p.name || p.sku}</p>
                            {p.sku !== p.name && <p className="text-[10px] text-[#9CA3AF] truncate max-w-[220px]">{p.sku}</p>}
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="flex flex-col items-end">
                              <span className="text-[#111827] font-semibold tabular-nums">€{formatNumber(p.revenue, 2)}</span>
                              <div className="w-16 h-1 bg-[#F3F4F6] rounded-full overflow-hidden mt-1">
                                <div className="h-full rounded-full bg-[#F97316]/60" style={{ width: `${barPct}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 text-right text-[#6B7280] tabular-nums">{p.quantity}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[#9CA3AF] py-4 text-center">Δεν υπάρχουν δεδομένα προϊόντων</p>
            )}
          </div>
        </Card>

        {/* Recent Orders */}
        <Card>
          <CardHeader title="Πρόσφατες Παραγγελίες" subtitle="Τελευταίες 50" icon={<ShoppingCart size={16} />} />
          <div className="px-5 pb-5">
            {sortedOrders.length > 0 ? (
              <div className="overflow-x-auto -mx-5 px-5">
                <table className="w-full text-left text-xs" style={{ minWidth: 480 }}>
                  <thead>
                    <tr className="border-b border-[#E5E7EB]">
                      <th
                        className="pb-2.5 font-medium text-[#6B7280] cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleOrderSort('createdAt')}
                      >
                        <span className="inline-flex items-center gap-0.5 hover:text-[#111827] transition-colors">
                          Ημ/νία <SortIcon active={orderSort.field === 'createdAt'} dir={orderSort.dir} />
                        </span>
                      </th>
                      <th className="pb-2.5 font-medium text-[#6B7280]">Order</th>
                      <th
                        className="pb-2.5 font-medium text-[#6B7280] cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleOrderSort('platform')}
                      >
                        <span className="inline-flex items-center gap-0.5 hover:text-[#111827] transition-colors">
                          Platform <SortIcon active={orderSort.field === 'platform'} dir={orderSort.dir} />
                        </span>
                      </th>
                      <th className="pb-2.5 font-medium text-[#6B7280]">Status</th>
                      <th
                        className="pb-2.5 font-medium text-[#6B7280] text-right cursor-pointer select-none whitespace-nowrap"
                        onClick={() => toggleOrderSort('total')}
                      >
                        <span className="inline-flex items-center gap-0.5 hover:text-[#111827] transition-colors">
                          Total <SortIcon active={orderSort.field === 'total'} dir={orderSort.dir} />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedOrders.map((o, i) => (
                      <tr
                        key={o.orderId + i}
                        className="border-b border-[#F9FAFB] last:border-0 hover:bg-[#F9FAFB] transition-colors"
                      >
                        <td className="py-2.5 text-[#6B7280] whitespace-nowrap tabular-nums">
                          {o.createdAt
                            ? new Date(o.createdAt).toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: '2-digit' })
                            : '—'}
                        </td>
                        <td className="py-2.5 text-[#111827] font-medium">{o.orderName || o.orderId}</td>
                        <td className="py-2.5">
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                            style={{ backgroundColor: `${PLATFORM_COLORS[o.platform] || '#94A3B8'}18`, color: PLATFORM_COLORS[o.platform] || '#94A3B8' }}
                          >
                            {PLATFORM_LABELS[o.platform] || o.platform}
                          </span>
                        </td>
                        <td className="py-2.5">
                          <OrderStatusBadge status={o.status} />
                        </td>
                        <td className="py-2.5 text-right text-[#111827] font-semibold tabular-nums">€{o.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[#9CA3AF] py-4 text-center">Δεν υπάρχουν παραγγελίες</p>
            )}
          </div>
        </Card>
      </div>

      {/* Footer CTA */}
      <div className="flex justify-center">
        <button
          onClick={() => { window.location.hash = '#data'; }}
          className="inline-flex items-center gap-1.5 text-xs text-[#6B7280] hover:text-[var(--nts-accent)] transition-colors"
        >
          Διαχείριση Connectors <ArrowRight size={12} />
        </button>
      </div>
    </div>
  );
}
