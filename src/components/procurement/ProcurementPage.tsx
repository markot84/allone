import { useState, useMemo, useRef, useEffect } from 'react';
import {
  Package, Calculator, Star, Users, FileText, Calendar, BarChart3,
  Upload, ChevronRight, ArrowLeft, Tag, DollarSign,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip,
  LineChart, Line, ReferenceLine, Legend, Cell,
} from 'recharts';
import { Card, Spinner, Button, useToast } from '../common';
import { useProcurement } from '../../hooks/useProcurement';
import { useBrand } from '../../hooks';
import { ProcurementService } from '../../services/firestore';
import { seedProcurementDemoData } from '../../services/procurementDemoData';
import {
  PROCUREMENT_SHEET_LABELS,
  type ProcurementSheetType,
} from '../../types/procurement';

// ── Constants ─────────────────────────────────────────────────────────────────

const SHEET_ICONS: Record<ProcurementSheetType, React.ReactNode> = {
  inventory: <Package size={18} />,
  costing: <Calculator size={18} />,
  item_evaluation: <Star size={18} />,
  customer_evaluation: <Users size={18} />,
  pricing_policy: <FileText size={18} />,
  fiscal_year: <Calendar size={18} />,
  statistics: <BarChart3 size={18} />,
};

const SHEET_ICON_BG: Record<ProcurementSheetType, string> = {
  inventory: 'bg-blue-50 text-blue-600',
  costing: 'bg-orange-50 text-orange-600',
  item_evaluation: 'bg-green-50 text-green-600',
  customer_evaluation: 'bg-purple-50 text-purple-600',
  pricing_policy: 'bg-yellow-50 text-yellow-700',
  fiscal_year: 'bg-emerald-50 text-emerald-600',
  statistics: 'bg-gray-50 text-gray-600',
};

const CHART_TITLES: Record<ProcurementSheetType, string> = {
  inventory: 'Διαθέσιμο απόθεμα ανά SKU',
  costing: 'Κόστος ανά SKU',
  item_evaluation: 'Βαθμολογία ανά είδος',
  customer_evaluation: 'Βαθμολογία ανά πελάτη',
  pricing_policy: 'Κόστος vs Τιμή πώλησης',
  fiscal_year: 'Τζίρος & Κέρδος ανά SKU',
  statistics: 'Τάση ανά περίοδο',
};

const SHEET_KEYS = [
  'inventory', 'costing', 'item_evaluation', 'customer_evaluation',
  'pricing_policy', 'fiscal_year', 'statistics',
] as const;

const EXCLUDED_KEYS = new Set(['id', 'brandId', 'rowIndex', 'sheetType', 'createdAt', 'updatedAt']);

const CHART_COLORS = {
  accent: '#F97316',
  secondary: '#78716C',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',
  purple: '#8B5CF6',
};

const EVAL_COLORS: Record<string, string> = {
  A: '#22C55E', B: '#F59E0B', C: '#EF4444',
  VIP: '#3B82F6', Καλή: '#F59E0B', Νέος: '#6B7280',
  Άριστα: '#22C55E', Καλά: '#F59E0B', Μέτρια: '#EF4444',
};

const BADGE_KEYS = new Set(['ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ', 'ΑΞΙΟΛΟΓΗΣΗ', 'STATUS ΚΩΔΙΚΟΥ', 'ΟΜΑΔΑ ΡΟΗΣ', 'ΚΙΒΩΤΟΛΟΓΙΟ']);

const BADGE_STYLES: Record<string, string> = {
  A: 'bg-green-100 text-green-700 border-green-200',
  B: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  C: 'bg-red-100 text-red-700 border-red-200',
  Άριστα: 'bg-green-100 text-green-700 border-green-200',
  Καλά: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  Μέτρια: 'bg-red-100 text-red-700 border-red-200',
  VIP: 'bg-blue-100 text-blue-700 border-blue-200',
  Καλή: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  Νέος: 'bg-gray-100 text-gray-600 border-gray-200',
  Ενεργό: 'bg-green-100 text-green-700 border-green-200',
  Κωδικοποιημένο: 'bg-gray-100 text-gray-600 border-gray-200',
  Υψηλή: 'bg-blue-100 text-blue-700 border-blue-200',
  Χαμηλή: 'bg-red-100 text-red-700 border-red-200',
  Ναι: 'bg-green-100 text-green-700 border-green-200',
  Όχι: 'bg-gray-100 text-gray-600 border-gray-200',
};

const STAT_LINE_COLORS = ['#F97316', '#3B82F6', '#22C55E', '#8B5CF6', '#F59E0B', '#EF4444', '#78716C'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseNum(v: unknown): number {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function isNumericLike(v: string): boolean {
  if (!v.trim()) return false;
  const cleaned = v.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  return !isNaN(parseFloat(cleaned)) && cleaned !== '' && isFinite(Number(cleaned));
}

function getSummary(key: ProcurementSheetType, rows: Record<string, unknown>[]) {
  const count = rows.length;
  if (count === 0) return { count, primary: '—', secondary: '' };
  switch (key) {
    case 'inventory': {
      const sumStock = rows.reduce((s, r) => s + parseNum(r['ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ']), 0);
      const toRefill = rows.filter(r => parseNum(r['ΠΟΣΟΤΗΤΑ ΑΝΑΤΡΟΦΟΔΟΣΙΑΣ']) > 0).length;
      return { count, primary: Math.round(sumStock).toLocaleString('el-GR'), secondary: toRefill > 0 ? `${toRefill} SKU σε ανατροφοδότηση` : 'Φυσιολογικά επίπεδα' };
    }
    case 'costing': {
      const costs = rows.map(r => parseNum(r['ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ'])).filter(Boolean);
      const avg = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
      return { count, primary: `€${avg.toFixed(2)}`, secondary: 'Μέσο πρωτογενές κόστος' };
    }
    case 'item_evaluation': {
      const scores = rows.map(r => parseNum(r['ΒΑΘΜΟΛΟΓΙΑ'])).filter(Boolean);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      return { count, primary: avg.toFixed(1), secondary: 'Μέση βαθμολογία ειδών' };
    }
    case 'customer_evaluation': {
      const scores = rows.map(r => parseNum(r['ΒΑΘΜΟΛΟΓΙΑ'])).filter(Boolean);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const vip = rows.filter(r => String(r['ΑΞΙΟΛΟΓΗΣΗ'] ?? '').toUpperCase() === 'VIP').length;
      return { count, primary: avg.toFixed(1), secondary: vip > 0 ? `${vip} VIP πελάτες` : 'Μέση βαθμολογία' };
    }
    case 'pricing_policy': {
      const prices = rows.map(r => parseNum(r['ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ'])).filter(Boolean);
      const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
      return { count, primary: `€${avg.toFixed(2)}`, secondary: 'Μέση τιμή πώλησης' };
    }
    case 'fiscal_year': {
      const turnover = rows.reduce((s, r) => s + parseNum(r['ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ']), 0);
      const profit = rows.reduce((s, r) => s + parseNum(r['ΑΠΟΛΟΓΙΣΤΙΚΟ ΚΕΡΔΟΣ']), 0);
      const margin = turnover > 0 ? ((profit / turnover) * 100).toFixed(1) : '0';
      return { count, primary: `€${turnover.toLocaleString('el-GR', { maximumFractionDigits: 0 })}`, secondary: `Κέρδος: €${profit.toLocaleString('el-GR', { maximumFractionDigits: 0 })} (${margin}%)` };
    }
    case 'statistics':
      return { count, primary: String(count), secondary: 'μετρικές' };
    default:
      return { count, primary: String(count), secondary: '' };
  }
}

/**
 * Identifies the "metric name" column in statistics rows by finding
 * the key whose values are mostly non-numeric (text) strings.
 * Needed because Firestore returns fields in undefined order, so we
 * cannot rely on allKeys[0] being the label column.
 */
function findStatMetricColumn(rows: Record<string, unknown>[], excludedKeys: Set<string>): string {
  if (rows.length === 0) return '';
  const keys = Object.keys(rows[0]).filter(k => !excludedKeys.has(k));
  if (keys.length === 0) return '';
  let bestKey = keys[0];
  let bestScore = -1;
  for (const key of keys) {
    const values = rows.map(r => String(r[key] ?? '').trim()).filter(Boolean);
    const textCount = values.filter(v => !isNumericLike(v)).length;
    if (textCount > bestScore) {
      bestScore = textCount;
      bestKey = key;
    }
  }
  return bestKey;
}

function getChartData(key: ProcurementSheetType, rows: Record<string, unknown>[]) {
  switch (key) {
    case 'inventory':
      return rows.map(r => ({
        name: String(r['ΚΩΔΙΚΟΣ'] ?? '').slice(0, 10),
        stock: parseNum(r['ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ']),
        eval: String(r['ΑΞΙΟΛΟΓΗΣΗ ΕΙΔΟΥΣ'] ?? 'C'),
      }));
    case 'costing':
      return rows.map(r => ({
        name: String(r['ΚΩΔΙΚΟΣ'] ?? '').slice(0, 10),
        primary: parseNum(r['ΠΡΩΤΟΓΕΝΕΣ ΚΟΣΤΟΣ']),
        secondary: parseNum(r['ΔΕΥΤΕΡΟΓΕΝΕΣ ΚΟΣΤΟΣ']),
      }));
    case 'item_evaluation':
      return rows.map(r => ({
        name: String(r['ΚΩΔΙΚΟΣ'] ?? '').slice(0, 10),
        score: parseNum(r['ΒΑΘΜΟΛΟΓΙΑ']),
      }));
    case 'customer_evaluation':
      return rows.map(r => ({
        name: String(r['ΕΠΩΝΥΜΙΑ'] ?? '').slice(0, 14),
        score: parseNum(r['ΒΑΘΜΟΛΟΓΙΑ']),
        eval: String(r['ΑΞΙΟΛΟΓΗΣΗ'] ?? ''),
      }));
    case 'pricing_policy':
      return rows.map(r => ({
        name: String(r['ΚΩΔΙΚΟΣ'] ?? '').slice(0, 10),
        cost: parseNum(r['ΣΥΝΟΛΙΚΟ ΚΟΣΤΟΣ']),
        price: parseNum(r['ΜΕΣΗ ΤΙΜΗ ΠΩΛΗΣΗΣ']),
      }));
    case 'fiscal_year':
      return rows.map(r => ({
        name: String(r['ΚΩΔΙΚΟΣ'] ?? '').slice(0, 10),
        turnover: parseNum(r['ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ']),
        profit: parseNum(r['ΑΠΟΛΟΓΙΣΤΙΚΟ ΚΕΡΔΟΣ']),
      }));
    case 'statistics': {
      if (rows.length === 0) return [];
      const metricKey = findStatMetricColumn(rows, EXCLUDED_KEYS);
      const allKeys = Object.keys(rows[0]).filter(k => !EXCLUDED_KEYS.has(k));
      const periodKeys = allKeys.filter(k => k !== metricKey);
      return periodKeys.map(period => {
        const point: Record<string, unknown> = { period };
        rows.forEach(r => {
          const name = String(r[metricKey] ?? '').slice(0, 30);
          if (name) point[name] = parseNum(r[period]);
        });
        return point;
      });
    }
    default:
      return [];
  }
}

function getStatSeriesNames(rows: Record<string, unknown>[]): string[] {
  if (rows.length === 0) return [];
  const metricKey = findStatMetricColumn(rows, EXCLUDED_KEYS);
  return rows.map(r => String(r[metricKey] ?? '').slice(0, 30)).filter(Boolean);
}

// ── Chart component ───────────────────────────────────────────────────────────

const CHART_HEIGHT = 220;

function ProcurementChart({ tabKey, rows }: { tabKey: ProcurementSheetType; rows: Record<string, unknown>[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setChartWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (rows.length === 0) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartData = getChartData(tabKey, rows) as any[];
  if (chartData.length === 0) return null;

  const W = chartWidth;
  const H = CHART_HEIGHT;
  const axisStyle = { fill: '#57606a', fontSize: 11 };
  const margin = { top: 10, right: 10, left: 0, bottom: 5 };

  let chart: React.ReactNode = null;

  if (tabKey === 'inventory') {
    chart = (
      <BarChart width={W} height={H} data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
        <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
        <RechartsTooltip formatter={(v: number | undefined) => [Number(v ?? 0).toLocaleString('el-GR'), 'Απόθεμα']} />
        <Bar dataKey="stock" radius={[4, 4, 0, 0]}>
          {chartData.map((entry: { eval: string }, i: number) => (
            <Cell key={i} fill={EVAL_COLORS[entry.eval] ?? CHART_COLORS.accent} />
          ))}
        </Bar>
      </BarChart>
    );
  } else if (tabKey === 'costing') {
    chart = (
      <BarChart width={W} height={H} data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
        <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={(v: number) => `€${v}`} />
        <RechartsTooltip formatter={(v: number | undefined, name: string | undefined) => [`€${(v ?? 0).toFixed(2)}`, name === 'primary' ? 'Πρωτογενές κόστος' : 'Δευτερογενές κόστος']} />
        <Legend formatter={(v: string) => v === 'primary' ? 'Πρωτογενές κόστος' : 'Δευτερογενές κόστος'} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="primary" fill={CHART_COLORS.accent} radius={[4, 4, 0, 0]} />
        <Bar dataKey="secondary" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} />
      </BarChart>
    );
  } else if (tabKey === 'item_evaluation') {
    const scores = chartData.map((d: { score: number }) => d.score);
    const avg = scores.length ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;
    chart = (
      <BarChart width={W} height={H} data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
        <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tick={axisStyle} tickLine={false} axisLine={false} />
        <RechartsTooltip formatter={(v: number | undefined) => [v ?? 0, 'Βαθμολογία']} />
        <ReferenceLine y={avg} stroke="#9CA3AF" strokeDasharray="4 4" label={{ value: `Μέσος: ${avg.toFixed(0)}`, fill: '#9CA3AF', fontSize: 11, position: 'insideTopRight' }} />
        <Bar dataKey="score" radius={[4, 4, 0, 0]}>
          {chartData.map((entry: { score: number }, i: number) => {
            const s = entry.score;
            return <Cell key={i} fill={s >= 80 ? EVAL_COLORS.A : s >= 60 ? EVAL_COLORS.B : EVAL_COLORS.C} />;
          })}
        </Bar>
      </BarChart>
    );
  } else if (tabKey === 'customer_evaluation') {
    chart = (
      <BarChart width={W} height={H} data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
        <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tick={axisStyle} tickLine={false} axisLine={false} />
        <RechartsTooltip formatter={(v: number | undefined) => [v ?? 0, 'Βαθμολογία']} />
        <Bar dataKey="score" radius={[4, 4, 0, 0]}>
          {chartData.map((entry: { eval: string }, i: number) => (
            <Cell key={i} fill={EVAL_COLORS[entry.eval] ?? CHART_COLORS.info} />
          ))}
        </Bar>
      </BarChart>
    );
  } else if (tabKey === 'pricing_policy') {
    chart = (
      <BarChart width={W} height={H} data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
        <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={(v: number) => `€${v}`} />
        <RechartsTooltip formatter={(v: number | undefined, name: string | undefined) => [`€${(v ?? 0).toFixed(2)}`, name === 'cost' ? 'Συνολικό κόστος' : 'Μέση τιμή πώλησης']} />
        <Legend formatter={(v: string) => v === 'cost' ? 'Συνολικό κόστος' : 'Μέση τιμή πώλησης'} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="cost" fill={CHART_COLORS.secondary} radius={[4, 4, 0, 0]} />
        <Bar dataKey="price" fill={CHART_COLORS.accent} radius={[4, 4, 0, 0]} />
      </BarChart>
    );
  } else if (tabKey === 'fiscal_year') {
    chart = (
      <BarChart width={W} height={H} data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
        <XAxis dataKey="name" tick={axisStyle} tickLine={false} axisLine={false} />
        <YAxis tick={axisStyle} tickLine={false} axisLine={false} tickFormatter={(v: number) => `€${v}`} />
        <RechartsTooltip formatter={(v: number | undefined, name: string | undefined) => [`€${(v ?? 0).toLocaleString('el-GR')}`, name === 'turnover' ? 'Τζίρος' : 'Κέρδος']} />
        <Legend formatter={(v: string) => v === 'turnover' ? 'Τζίρος' : 'Κέρδος'} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="turnover" fill={CHART_COLORS.info} radius={[4, 4, 0, 0]} />
        <Bar dataKey="profit" fill={CHART_COLORS.success} radius={[4, 4, 0, 0]} />
      </BarChart>
    );
  } else if (tabKey === 'statistics') {
    const allSeriesNames = getStatSeriesNames(rows);
    const seriesNames = allSeriesNames.slice(0, 6);
    const hiddenCount = allSeriesNames.length - seriesNames.length;
    return (
      <div ref={containerRef} style={{ width: '100%' }}>
        <LineChart width={W} height={H} data={chartData} margin={margin}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" vertical={false} />
          <XAxis dataKey="period" tick={axisStyle} tickLine={false} axisLine={false} />
          <YAxis tick={axisStyle} tickLine={false} axisLine={false} />
          <RechartsTooltip wrapperStyle={{ fontSize: 11 }} />
          {seriesNames.map((name, i) => (
            <Line key={name} type="monotone" dataKey={name} stroke={STAT_LINE_COLORS[i % STAT_LINE_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
          ))}
        </LineChart>
        {hiddenCount > 0 && (
          <p className="text-xs text-[var(--nts-medium-gray)] mt-2">+{hiddenCount} ακόμα μετρικές στον πίνακα παρακάτω</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          {seriesNames.map((name, i) => (
            <div key={name} className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded" style={{ backgroundColor: STAT_LINE_COLORS[i % STAT_LINE_COLORS.length] }} />
              <span className="text-[11px] text-[var(--nts-medium-gray)]">{name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {chart}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ProcurementPageProps {
  onSectionChange?: (section: string) => void;
}

export function ProcurementPage({ onSectionChange }: ProcurementPageProps = {}) {
  const toast = useToast();
  const { currentBrand } = useBrand();
  const { data, isLoading, hasData, invalidate } = useProcurement();
  const [viewMode, setViewMode] = useState<'overview' | 'detail'>('overview');
  const [activeTab, setActiveTab] = useState<ProcurementSheetType>('inventory');
  const [isSeeding, setIsSeeding] = useState(false);

  const handleSeedDemo = async () => {
    if (!currentBrand?.id) { toast.error('Επιλέξτε brand'); return; }
    setIsSeeding(true);
    try {
      const count = await seedProcurementDemoData(
        currentBrand.id,
        (coll, items, bid) => ProcurementService.batchSet(coll, items, bid ?? undefined),
      );
      await invalidate();
      toast.success(`Φορτώθηκαν ${count} ενδεικτικές εγγραφές.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Σφάλμα κατά τη φόρτωση');
    } finally {
      setIsSeeding(false);
    }
  };

  // 4 global KPIs for the overview header
  const globalKPIs = useMemo(() => {
    const invRows = (data.inventory ?? []) as Record<string, unknown>[];
    const itemRows = (data.item_evaluation ?? []) as Record<string, unknown>[];
    const fiscalRows = (data.fiscal_year ?? []) as Record<string, unknown>[];
    const totalStock = invRows.reduce((s, r) => s + parseNum(r['ΔΙΑΘΕΣΙΜΟ ΥΠΟΛΟΙΠΟ']), 0);
    const totalTurnover = fiscalRows.reduce((s, r) => s + parseNum(r['ΑΠΟΛΟΓΙΣΤΙΚΟΣ ΤΖΙΡΟΣ']), 0);
    const scores = itemRows.map(r => parseNum(r['ΒΑΘΜΟΛΟΓΙΑ'])).filter(Boolean);
    const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    return [
      { label: 'Συνολικά SKUs', value: invRows.length > 0 ? String(invRows.length) : '—', Icon: Tag },
      { label: 'Σύνολο αποθέματος', value: invRows.length > 0 ? Math.round(totalStock).toLocaleString('el-GR') : '—', Icon: Package },
      { label: 'Απολογιστικός τζίρος', value: fiscalRows.length > 0 ? `€${totalTurnover.toLocaleString('el-GR', { maximumFractionDigits: 0 })}` : '—', Icon: DollarSign },
      { label: 'Μέση βαθμολογία ειδών', value: scores.length > 0 ? avgScore.toFixed(1) : '—', Icon: Star },
    ];
  }, [data]);

  const tabs = SHEET_KEYS.map(key => ({
    id: key,
    label: PROCUREMENT_SHEET_LABELS[key],
    icon: SHEET_ICONS[key],
    count: data[key]?.length ?? 0,
  }));

  const activeData = (data[activeTab] ?? []) as Record<string, unknown>[];
  const headers = useMemo(() => {
    if (activeData.length === 0) return [];
    const allKeys = Object.keys(activeData[0]).filter(k => !EXCLUDED_KEYS.has(k));
    if (activeTab === 'statistics') {
      const metricCol = findStatMetricColumn(activeData as Record<string, unknown>[], EXCLUDED_KEYS);
      return [metricCol, ...allKeys.filter(k => k !== metricCol)];
    }
    return allKeys;
  }, [activeData, activeTab]);

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Spinner size="lg" /></div>;
  }

  const actionsBar = (showBack = false) => (
    <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--nts-border-gray)]">
      {showBack ? (
        <button
          onClick={() => setViewMode('overview')}
          className="flex items-center gap-1.5 text-sm text-[var(--nts-accent)] hover:underline font-medium"
        >
          <ArrowLeft size={16} />
          Επισκόπηση
        </button>
      ) : (
        <p className="text-sm text-[var(--nts-medium-gray)]">
          Κάθε import αντικαθιστά τα τρέχοντα δεδομένα · snapshot αποθηκεύεται αυτόματα (τελευταία 5).
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={handleSeedDemo} disabled={isSeeding}>
          {isSeeding ? 'Φόρτωση…' : 'Ενδεικτικά δεδομένα'}
        </Button>
        {onSectionChange && (
          <Button onClick={() => onSectionChange('data-procurement')} variant="secondary" size="sm">
            Νέο Import
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div>
        <h2 className="text-2xl font-bold text-[var(--nts-charcoal)] tracking-tight">Procurement</h2>
        <p className="text-[14px] text-[var(--nts-medium-gray)] mt-1">
          Δεδομένα από 7 αναλύσεις (PROCUREMENT_TEMPLATE.xlsx). Εισαγωγή από Data Import.
        </p>
      </div>

      {!hasData ? (

        /* ── Empty state ────────────────────────────────────────────────────── */
        <Card padding="lg" className="border-2 border-dashed border-[var(--nts-border-gray)]">
          <div className="text-center py-12">
            <Upload size={48} className="text-[var(--nts-medium-gray)] mx-auto mb-4" />
            <p className="text-lg font-medium text-[var(--nts-charcoal)] mb-1">Δεν υπάρχουν δεδομένα Procurement</p>
            <p className="text-sm text-[var(--nts-medium-gray)] max-w-md mx-auto mb-6">
              Φόρτωσε αρχείο Excel με τη δομή PROCUREMENT_TEMPLATE.xlsx (7 καρτέλες) από Data Import → Procurement.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button onClick={handleSeedDemo} disabled={isSeeding} variant="secondary" size="sm">
                {isSeeding ? 'Φόρτωση…' : 'Φόρτωση ενδεικτικών δεδομένων'}
              </Button>
              {onSectionChange && (
                <Button onClick={() => onSectionChange('data-procurement')} variant="primary">
                  Μετάβαση σε Data Import
                </Button>
              )}
            </div>
          </div>
        </Card>

      ) : viewMode === 'overview' ? (

        /* ── Overview ───────────────────────────────────────────────────────── */
        <>
          {actionsBar(false)}

          {/* 4 global KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {globalKPIs.map(({ label, value, Icon }) => (
              <div
                key={label}
                className="rounded-lg border border-[var(--nts-border-gray)] bg-[var(--nts-bg-pure)] px-5 py-4 border-l-4 border-l-[var(--nts-accent)]"
                style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}
              >
                <div className="flex items-start justify-between mb-2">
                  <p className="text-[12px] font-medium text-[var(--nts-medium-gray)]">{label}</p>
                  <div className="p-1.5 bg-[var(--nts-light-gray)] rounded-md border border-[var(--nts-border-gray)]">
                    <Icon size={13} className="text-[var(--nts-medium-gray)]" />
                  </div>
                </div>
                <p className="text-3xl font-bold text-[var(--nts-charcoal)] font-mono tracking-tight">{value}</p>
              </div>
            ))}
          </div>

          {/* 7 analysis cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {SHEET_KEYS.map(key => {
              const rows = (data[key] ?? []) as Record<string, unknown>[];
              const { count, primary, secondary } = getSummary(key, rows);
              return (
                <div
                  key={key}
                  onClick={() => { setActiveTab(key); setViewMode('detail'); }}
                  className="group rounded-lg border border-[var(--nts-border-gray)] bg-[var(--nts-bg-pure)] p-5 flex flex-col cursor-pointer border-l-4 border-l-transparent hover:border-l-[var(--nts-accent)] transition-all"
                  style={{ boxShadow: '0 2px 6px rgba(0,0,0,0.08)' }}
                >
                  {/* Icon + label */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`p-2.5 rounded-xl flex-shrink-0 ${SHEET_ICON_BG[key]}`}>
                      {SHEET_ICONS[key]}
                    </div>
                    <div>
                      <p className="text-[12px] font-medium text-[var(--nts-medium-gray)] leading-tight">
                        {PROCUREMENT_SHEET_LABELS[key]}
                      </p>
                      <p className="text-[11px] text-[var(--nts-medium-gray)] mt-0.5">
                        {count > 0 ? `${count} εγγραφές` : <span className="text-[#EF4444]">Χωρίς δεδομένα</span>}
                      </p>
                    </div>
                  </div>

                  {/* Primary value */}
                  <p className="text-2xl font-bold text-[var(--nts-charcoal)] font-mono tracking-tight mb-1">{primary}</p>
                  {secondary && (
                    <p className="text-xs text-[var(--nts-medium-gray)]">{secondary}</p>
                  )}

                  {/* CTA */}
                  <div className="mt-auto pt-4 flex items-center gap-1 text-xs font-semibold text-[var(--nts-medium-gray)] group-hover:text-[var(--nts-accent)] transition-colors">
                    Δείτε αναλυτικά <ChevronRight size={13} />
                  </div>
                </div>
              );
            })}
          </div>
        </>

      ) : (

        /* ── Detail view ─────────────────────────────────────────────────────── */
        <>
          {actionsBar(true)}

          {/* Tab bar */}
          <div className="border-b border-[var(--nts-border-gray)]">
            <div className="flex flex-wrap gap-0">
              {tabs.map(tab => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`group relative flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-200 whitespace-nowrap focus:outline-none ${
                      isActive
                        ? 'text-[var(--nts-accent)]'
                        : 'text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)]'
                    }`}
                  >
                    {/* Active underline */}
                    <span
                      className={`absolute bottom-0 left-0 right-0 h-[2px] rounded-t-full transition-all duration-200 ${
                        isActive ? 'bg-[var(--nts-accent)]' : 'bg-transparent group-hover:bg-[var(--nts-border-gray)]'
                      }`}
                    />
                    <span className={`transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}>
                      {tab.icon}
                    </span>
                    <span>{tab.label}</span>
                    <span
                      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold transition-colors duration-200 ${
                        isActive
                          ? 'bg-[var(--nts-accent)] text-white'
                          : 'bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)] group-hover:bg-[var(--nts-border-gray)]'
                      }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chart card */}
          {activeData.length > 0 && (
            <Card padding="lg">
              <p className="text-[12px] font-semibold text-[var(--nts-medium-gray)] mb-4" style={{ textTransform: 'none' }}>
                {CHART_TITLES[activeTab]}
              </p>
              <ProcurementChart tabKey={activeTab} rows={activeData} />
            </Card>
          )}

          {/* Data table */}
          <Card padding="none">
            <div className="overflow-x-auto" style={{ maxHeight: 520, overflowY: 'auto' }}>
              {activeData.length === 0 ? (
                <div className="p-8 text-center text-[var(--nts-medium-gray)]">Καμία εγγραφή σε αυτή την καρτέλα.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                    <tr className="border-b border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)]">
                      {headers.map(h => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left font-semibold text-[var(--nts-charcoal)] whitespace-nowrap text-[12px]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeData.map((row, idx) => (
                      <tr
                        key={(row as { id?: string }).id ?? idx}
                        className={`border-b border-[var(--nts-border-gray)] hover:bg-[var(--nts-accent)]/5 transition-colors ${
                          idx % 2 === 1 ? 'bg-[var(--nts-light-gray)]/40' : ''
                        }`}
                      >
                        {headers.map(h => {
                          const raw = String(row[h] ?? '');
                          const isBadge = BADGE_KEYS.has(h) && raw in BADGE_STYLES;
                          const isNum = !isBadge && isNumericLike(raw);
                          return (
                            <td
                              key={h}
                              className={`px-4 py-2.5 text-[var(--nts-charcoal)] ${isNum ? 'text-right font-mono' : ''}`}
                            >
                              {isBadge ? (
                                <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${BADGE_STYLES[raw]}`}>
                                  {raw}
                                </span>
                              ) : raw}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}


