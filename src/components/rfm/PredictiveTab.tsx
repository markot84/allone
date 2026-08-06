import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Shield,
  Calendar,
  Target,
  BarChart3,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis,
  Cell,
} from 'recharts';
import { Card, CardHeader, Badge, Tooltip } from '../common';
import { derivePredictiveMetrics } from '../../services/behavioralEngine';
import { formatCurrencyCompact, formatNumber } from '../../utils/format';
import type { RFMSegment } from '../../types';

interface PredictiveTabProps {
  segments: RFMSegment[];
}

const CHURN_COLORS: Record<string, string> = {
  low: '#22C55E',
  medium: '#F59E0B',
  high: '#EF4444',
  critical: '#DC2626',
};

const CHURN_LABELS: Record<string, string> = {
  low: 'Χαμηλό',
  medium: 'Μεσαίο',
  high: 'Υψηλό',
  critical: 'Κρίσιμο',
};

const TREND_ICONS: Record<string, React.ReactNode> = {
  growing: <TrendingUp size={14} className="text-[#22C55E]" />,
  stable: <BarChart3 size={14} className="text-[#3B82F6]" />,
  declining: <TrendingDown size={14} className="text-[#EF4444]" />,
};

const TREND_LABELS: Record<string, string> = {
  growing: 'Αυξητική',
  stable: 'Σταθερή',
  declining: 'Πτωτική',
};

export function PredictiveTab({ segments }: PredictiveTabProps) {
  const [view, setView] = useState<'overview' | 'detail'>('overview');

  const enriched = useMemo(() =>
    segments.map(seg => ({
      segment: seg,
      metrics: derivePredictiveMetrics(seg),
      isImported: !!seg.predictive,
    })),
  [segments]);

  const hasImportedData = enriched.some(e => e.isImported);

  const totals = useMemo(() => {
    const totalLtv = enriched.reduce((acc, e) => acc + e.metrics.estimated_ltv * e.segment.count, 0);
    const totalForecast30 = enriched.reduce((acc, e) => acc + e.metrics.revenue_forecast_30d, 0);
    const totalForecast90 = enriched.reduce((acc, e) => acc + e.metrics.revenue_forecast_90d, 0);
    const criticalChurn = enriched.filter(e => e.metrics.churn_risk_label === 'critical' || e.metrics.churn_risk_label === 'high');
    const atRiskCustomers = criticalChurn.reduce((acc, e) => acc + e.segment.count, 0);
    const avgRetention = enriched.reduce((acc, e) => acc + e.metrics.retention_score * e.segment.count, 0) /
      enriched.reduce((acc, e) => acc + e.segment.count, 0);
    return { totalLtv, totalForecast30, totalForecast90, atRiskCustomers, avgRetention };
  }, [enriched]);

  const ltvChartData = useMemo(() =>
    enriched.map(e => ({
      name: e.segment.name,
      ltv: e.metrics.estimated_ltv,
      color: e.segment.color,
    })).sort((a, b) => b.ltv - a.ltv),
  [enriched]);

  /** x = churn %, y = LTV, z = number of customers in the segment (same as `segment.count` in imports) */
  const scatterData = useMemo(() =>
    enriched.map(e => ({
      name: e.segment.name,
      x: e.metrics.churn_risk,
      y: e.metrics.estimated_ltv,
      z: e.segment.count,
      color: e.segment.color,
    })),
  [enriched]);

  return (
    <div className="space-y-6">
      {/* Data Source Indicator */}
      <div className="flex items-center gap-2 text-xs">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${hasImportedData ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEF3C7] text-[#D97706]'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${hasImportedData ? 'bg-[#22C55E]' : 'bg-[#F59E0B]'}`} />
          {hasImportedData ? 'Imported data' : 'Derived from RFM (εισάγετε data για ακρίβεια)'}
        </span>
      </div>

      {/* View toggle */}
      <div className="flex gap-2">
        <button
          onClick={() => setView('overview')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
            view === 'overview' ? 'bg-[#1A1A2E] text-white' : 'bg-[var(--nts-light-gray)] text-[var(--text-secondary)] hover:bg-[var(--border)]'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setView('detail')}
          className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
            view === 'detail' ? 'bg-[#1A1A2E] text-white' : 'bg-[var(--nts-light-gray)] text-[var(--text-secondary)] hover:bg-[var(--border)]'
          }`}
        >
          Segment Detail
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <PredictiveKPI
          icon={<DollarSign size={18} />}
          label="Total Customer LTV"
          value={formatCurrencyCompact(totals.totalLtv)}
          color="#22C55E"
          tooltip="Εκτιμώμενη συνολική αξία ζωής πελατών (Lifetime Value)"
        />
        <PredictiveKPI
          icon={<Target size={18} />}
          label="Πρόβλεψη 30 ημ."
          value={formatCurrencyCompact(totals.totalForecast30)}
          color="#3B82F6"
          tooltip="Εκτιμώμενα έσοδα τις επόμενες 30 ημέρες βάσει purchase patterns"
        />
        <PredictiveKPI
          icon={<Calendar size={18} />}
          label="Πρόβλεψη 90 ημ."
          value={formatCurrencyCompact(totals.totalForecast90)}
          color="#8B5CF6"
          tooltip="Εκτιμώμενα έσοδα τις επόμενες 90 ημέρες"
        />
        <PredictiveKPI
          icon={<AlertTriangle size={18} />}
          label="At Risk Πελάτες"
          value={formatNumber(totals.atRiskCustomers)}
          color="#EF4444"
          tooltip="Πελάτες με υψηλό ή κρίσιμο κίνδυνο churn"
        />
        <PredictiveKPI
          icon={<Shield size={18} />}
          label="Avg Retention"
          value={`${formatNumber(totals.avgRetention, 0)}%`}
          color="#F59E0B"
          tooltip="Μέσος δείκτης διατήρησης πελατών"
        />
      </div>

      {view === 'overview' ? (
        <>
          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* LTV per Segment */}
            <Card padding="lg">
              <CardHeader
                title="Estimated LTV ανά Segment"
                subtitle="Εκτιμώμενη αξία ζωής πελάτη"
                icon={<DollarSign size={18} className="text-[var(--nts-accent-text)]" />}
              />
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ltvChartData} margin={{ left: 10, right: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `€${(v / 1000).toFixed(0)}K`} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                      formatter={(v: number | undefined) => [formatCurrencyCompact((v as number) || 0), 'LTV']}
                    />
                    <Bar dataKey="ltv" radius={[4, 4, 0, 0]} barSize={32}>
                      {ltvChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Churn vs LTV Scatter */}
            <Card padding="lg">
              <CardHeader
                title="Churn Risk vs LTV"
                subtitle="Μέγεθος = αριθμός πελατών"
                icon={<AlertTriangle size={18} className="text-[var(--nts-accent-text)]" />}
              />
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ left: 10, right: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      type="number"
                      dataKey="x"
                      name="Churn Risk"
                      domain={[0, 100]}
                      tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                      label={{ value: 'Churn Risk %', position: 'bottom', fontSize: 11, fill: 'var(--text-muted)' }}
                    />
                    <YAxis
                      type="number"
                      dataKey="y"
                      name="LTV"
                      tickFormatter={(v) => `€${(v / 1000).toFixed(0)}K`}
                      tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    />
                    <ZAxis type="number" dataKey="z" name="Πελάτες" range={[100, 800]} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0].payload as {
                          name: string;
                          x: number;
                          y: number;
                          z: number;
                          color: string;
                        };
                        return (
                          <div className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs shadow-sm">
                            <p className="mb-1.5 font-semibold text-[var(--text-primary)]">{row.name}</p>
                            <p className="text-[var(--text-secondary)]">
                              <span className="text-[var(--text-muted)]">Churn Risk: </span>
                              {formatNumber(row.x, 0)}%
                            </p>
                            <p className="text-[var(--text-secondary)]">
                              <span className="text-[var(--text-muted)]">LTV: </span>
                              {formatCurrencyCompact(row.y)}
                            </p>
                            <p className="text-[var(--text-secondary)]">
                              <span className="text-[var(--text-muted)]">Πελάτες: </span>
                              {formatNumber(row.z)}
                            </p>
                          </div>
                        );
                      }}
                    />
                    <Scatter data={scatterData}>
                      {scatterData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} fillOpacity={0.7} stroke={entry.color} strokeWidth={1} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      ) : (
        /* Detail View - Cards per Segment */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {enriched.map(({ segment, metrics }, i) => (
            <motion.div
              key={segment.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Card padding="md" hover>
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: `${segment.color}20` }}
                  >
                    <DollarSign size={18} style={{ color: segment.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-[var(--text-primary)] truncate">{segment.name}</h4>
                    <p className="text-xs text-[var(--text-muted)]">{formatNumber(segment.count)} πελάτες</p>
                  </div>
                  <Badge
                    variant={metrics.churn_risk_label === 'low' ? 'success' : metrics.churn_risk_label === 'medium' ? 'warning' : 'danger'}
                    size="sm"
                  >
                    Churn: {CHURN_LABELS[metrics.churn_risk_label]}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="p-2 bg-[var(--surface-2)] rounded-lg">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase">LTV</p>
                    <p className="text-sm font-bold font-mono text-[var(--text-primary)]">{formatCurrencyCompact(metrics.estimated_ltv)}</p>
                    <p className="text-[9px] text-[var(--text-muted)]">conf. {formatNumber(metrics.ltv_confidence, 0)}%</p>
                  </div>
                  <div className="p-2 bg-[var(--surface-2)] rounded-lg">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase">Next Order</p>
                    <p className="text-sm font-bold font-mono text-[var(--text-primary)]">{metrics.days_to_next_purchase}d</p>
                    <p className="text-[9px] text-[var(--text-muted)]">prob. {metrics.next_purchase_probability}%</p>
                  </div>
                  <div className="p-2 bg-[var(--surface-2)] rounded-lg">
                    <p className="text-[10px] text-[var(--text-muted)] uppercase">30d Forecast</p>
                    <p className="text-sm font-bold font-mono text-[var(--text-primary)]">{formatCurrencyCompact(metrics.revenue_forecast_30d)}</p>
                    <p className="text-[9px] text-[var(--text-muted)]">90d: {formatCurrencyCompact(metrics.revenue_forecast_90d)}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--border)]">
                  <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                    <Shield size={12} />
                    <span>Retention: <span className="font-bold font-mono">{metrics.retention_score}%</span></span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    {TREND_ICONS[metrics.demand_trend]}
                    <span>{TREND_LABELS[metrics.demand_trend]}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-mono font-bold" style={{ color: CHURN_COLORS[metrics.churn_risk_label] }}>
                      {metrics.churn_risk}%
                    </span>
                    <span className="text-[var(--text-muted)]">churn</span>
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Alerts / Recommendations */}
      <Card padding="lg">
        <CardHeader
          title="Σενάρια & Ειδοποιήσεις"
          subtitle="Αυτόματες ειδοποιήσεις βάσει predictive signals"
          icon={<AlertTriangle size={18} className="text-[var(--nts-accent-text)]" />}
        />
        <div className="space-y-3 mt-3">
          {enriched
            .filter(e => e.metrics.churn_risk_label === 'critical' || e.metrics.churn_risk_label === 'high')
            .map(({ segment, metrics }) => (
              <div
                key={segment.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-[#FEE2E2] bg-[#FEF2F2]"
              >
                <AlertTriangle size={16} className="text-[#EF4444] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {segment.name}: Υψηλός κίνδυνος churn ({metrics.churn_risk}%)
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {formatNumber(segment.count)} πελάτες με LTV {formatCurrencyCompact(metrics.estimated_ltv)} σε κίνδυνο. Πιθανή απώλεια εσόδων {formatCurrencyCompact(metrics.revenue_forecast_30d)}/μήνα.
                  </p>
                </div>
                <Badge variant="danger" size="sm">{CHURN_LABELS[metrics.churn_risk_label]}</Badge>
              </div>
            ))}
          {enriched
            .filter(e => e.metrics.demand_trend === 'growing' && e.metrics.estimated_ltv > 5000)
            .map(({ segment, metrics }) => (
              <div
                key={`opp-${segment.id}`}
                className="flex items-center gap-3 p-3 rounded-lg border border-[#DCFCE7] bg-[#F0FDF4]"
              >
                <TrendingUp size={16} className="text-[#22C55E] flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {segment.name}: Αυξητική ζήτηση
                  </p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    LTV {formatCurrencyCompact(metrics.estimated_ltv)} με forecast {formatCurrencyCompact(metrics.revenue_forecast_90d)} (90d). Ευκαιρία για upsell/cross-sell campaigns.
                  </p>
                </div>
                <Badge variant="success" size="sm">Ευκαιρία</Badge>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}

function PredictiveKPI({ icon, label, value, color, tooltip }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  tooltip: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
      <Card padding="md">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${color}15` }}
          >
            <span style={{ color }}>{icon}</span>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-[var(--text-muted)]">
              <Tooltip content={tooltip} size={11}>{label}</Tooltip>
            </p>
            <p className="text-lg font-bold font-mono text-[var(--text-primary)]">{value}</p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
