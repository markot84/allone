import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  ArrowRight,
  Zap,
  Trash2,
  Brain,
  LineChart,
  Download,
  FileSpreadsheet,
  RefreshCw,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid
} from 'recharts';
import { Card, CardHeader, Badge, Button, Spinner, Tooltip as InfoTooltip, useToast, PageHeader, DataSourcePill } from '../common';
import { useSegments, type SegmentsDataSource } from '../../hooks/useSegments';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useBrand } from '../../hooks/useBrand';
import { useAuth } from '../../hooks/useAuth';
import { useBrandMembers } from '../../hooks/useCoordination';
import { auth, buildFunctionUrl, getAppCheckHeader } from '../../config/firebase';
import { FirestoreService } from '../../services/firestore';
import { clearAnalysisSnapshots } from '../../services/analysisSnapshotCache';
import { BehavioralTab } from './BehavioralTab';
import { PredictiveTab } from './PredictiveTab';
import { exportSegmentActionPack, exportAllSegmentActionPacks, exportSegmentCustomerList, exportAllSegmentCustomerLists } from '../../services/segmentActionPack';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import type { CategoryAffinity, RFMSegment } from '../../types';

import { formatNumber, formatPercent, formatCurrencyCompact } from '../../utils/format';
const fmtPct = (n: number) => formatNumber(n, 2);
const SELECTED_SEGMENT_STROKE = '#FDBA74';
const REFRESH_DATA_ANALYSIS_RFM_URL = buildFunctionUrl('refreshDataAnalysisRfm');

type AnalysisTab = 'rfm' | 'behavioral' | 'predictive';
type SegmentMovement = { countDelta: number; percentageDelta: number };

// Get default RFM score from segment name (fallback when rfm_score is missing)
function getDefaultRFMScoreFromName(segmentName: string): string | null {
  const name = segmentName.toLowerCase().trim();
  const defaults: Record<string, string> = {
    'champions': '5-5-5',
    'loyal_customers': '4-4-3',
    'loyal': '4-4-3',
    'promising': '4-2-3',
    'potential_loyalists': '4-2-3',
    'potential': '4-2-3',
    'at_risk': '2-3-3',
    'hibernating': '2-2-2',
    'lost': '1-1-1',
    'new_customers': '5-1-1',
    'recent_customers': '5-2-2',
    'cant_lose_them': '3-5-5',
    "can't_lose_them": '3-5-5',
    'customers_needing_attention': '3-3-2',
  };
  
  // Try exact match first
  if (defaults[name]) return defaults[name];
  
  // Try partial match
  for (const [key, value] of Object.entries(defaults)) {
    if (name.includes(key) || key.includes(name)) {
      return value;
    }
  }
  
  return null;
}

// Calculate average RFM score from a segment's rfm_score string
// Handles formats like "5-5-5 to 4-4-4" (range) or "555" (3 digits) or "5-5-5"
function calculateAvgRFMScore(rfmScore: string | undefined | null, segmentName?: string): number | null {
  let scoreStr = rfmScore;
  
  // If rfm_score is empty, try to get default from segment name
  if ((!scoreStr || !scoreStr.trim()) && segmentName) {
    scoreStr = getDefaultRFMScoreFromName(segmentName);
  }
  
  if (!scoreStr || typeof scoreStr !== 'string') return null;
  
  const trimmed = scoreStr.trim();
  if (!trimmed) return null;
  
  // Extract all digits from the string
  const digits = trimmed.match(/\d/g);
  if (!digits || digits.length === 0) return null;
  
  // Convert to numbers and filter valid RFM scores (1-5)
  const numbers = digits.map(d => parseInt(d, 10)).filter(n => !isNaN(n) && n >= 1 && n <= 5);
  if (numbers.length === 0) return null;
  
  const sum = numbers.reduce((a, b) => a + b, 0);
  return sum / numbers.length;
}

export function RFMAnalysis() {
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<AnalysisTab>('rfm');
  const {
    segments: rfmSegments,
    totalCustomers,
    isLoading: segmentsLoading,
    ordersLoading,
    ordersError,
    hasImported: hasImportedSegments,
    dataSource: rfmDataSource,
    dataOrigin: rfmDataOrigin,
    sourceLabel: rfmSourceLabel,
    setDataSourcePreference,
    sourcePreference: rfmSourcePref,
    canComputeFromOrders,
    canComputeIdentifiedOrders,
    dataCoverage,
    orderRfmMeta,
    segmentMigration,
    segmentPeriodComparison,
    isCatalogEnriching,
    analysisSnapshotIsStale,
    analysisLastAnalyzedAt,
  } = useSegments({ variant: 'data_analysis' });
  const ecomm = useEcommerceSummary({ includeSkuDetails: false, includeStockMovement: false });
  const { currentBrand } = useBrand();
  const { user, isSuperAdmin } = useAuth();
  const { members } = useBrandMembers();
  // Manual "Refresh Analysis" is an expensive (1200s/2GiB) write of the shared RFM aggregate,
  // owner/admin-only on the server; gate the button to match.
  const myRole = members.find((m) => m.userId === user?.uid)?.role ?? 'member';
  const canRefreshAnalysis =
    Boolean(isSuperAdmin) ||
    Boolean(user?.uid && currentBrand?.createdBy === user.uid) ||
    myRole === 'owner' ||
    myRole === 'admin';
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRefreshingAnalysis, setIsRefreshingAnalysis] = useState(false);
  const { activeStrategy } = useActiveStrategy();
  const channelRecommendation = activeStrategy?.channelRecommendation ?? null;
  const totalCustomersDisplay = Math.max(totalCustomers, dataCoverage.totalCustomers);
  const rfmChartSegments = rfmSegments as unknown as Record<string, unknown>[];
  const segmentColorById = new Map(rfmSegments.map((segment) => [segment.id, segment.color]));
  const selectedSegment = useMemo(
    () => rfmSegments.find((segment) => segment.id === selectedSegmentId) ?? null,
    [rfmSegments, selectedSegmentId]
  );
  const segmentMovementById = useMemo(() => {
    const map = new Map<string, SegmentMovement>();
    for (const row of segmentPeriodComparison?.rows ?? []) {
      map.set(row.id, { countDelta: row.countDelta, percentageDelta: row.shareDelta });
    }
    if (map.size > 0) return map;

    for (const flow of segmentMigration?.flows ?? []) {
      const from = map.get(flow.from) ?? { countDelta: 0, percentageDelta: 0 };
      from.countDelta -= flow.count;
      from.percentageDelta -= flow.percentage;
      map.set(flow.from, from);

      const to = map.get(flow.to) ?? { countDelta: 0, percentageDelta: 0 };
      to.countDelta += flow.count;
      to.percentageDelta += flow.percentage;
      map.set(flow.to, to);
    }
    return map;
  }, [segmentMigration?.flows, segmentPeriodComparison?.rows]);

  const lastAnalysisLabel = useMemo(() => {
    if (!analysisLastAnalyzedAt) return 'Δεν έχει αποθηκευμένη ανάλυση';
    const date = new Date(analysisLastAnalyzedAt);
    if (Number.isNaN(date.getTime())) return 'Τελευταία ανάλυση: άγνωστη ημερομηνία';
    return `Τελευταία ανάλυση: ${date.toLocaleDateString('el-GR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })}`;
  }, [analysisLastAnalyzedAt]);

  useEffect(() => {
    setSelectedSegmentId((currentId) => {
      if (rfmSegments.length === 0) return null;
      if (currentId && rfmSegments.some((segment) => segment.id === currentId)) return currentId;
      return rfmSegments[0]?.id ?? null;
    });
  }, [rfmSegments]);

  const handleExportAll = async (fmt: 'xlsx' | 'csv' = 'xlsx') => {
    if (rfmSegments.length === 0) return;
    setIsExporting(true);
    try {
      await exportAllSegmentActionPacks(rfmSegments, currentBrand?.name, channelRecommendation, fmt);
      toast.success(`Action Packs (.${fmt}) exported!`);
    } catch (e) {
      toast.error(`Export error: ${e instanceof Error ? e.message : 'Unknown'}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSegment = async (segment: RFMSegment, fmt: 'xlsx' | 'csv' = 'xlsx') => {
    try {
      await exportSegmentActionPack(segment, currentBrand?.name, channelRecommendation, fmt);
      toast.success(`Action Pack: ${segment.name} (.${fmt})`);
    } catch (e) {
      toast.error(`Export error: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  };

  const handleExportCustomerList = async (segment: RFMSegment | null, fmt: 'xlsx' | 'csv' = 'csv') => {
    if (!currentBrand?.id) return;
    try {
      if (segment) {
        const { count } = await exportSegmentCustomerList(currentBrand.id, segment, currentBrand.name, fmt);
        toast.success(`${count} customers exported (.${fmt})`);
      } else {
        const { count } = await exportAllSegmentCustomerLists(currentBrand.id, rfmSegments, currentBrand.name, fmt);
        toast.success(`${count} customers exported (.${fmt})`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export error');
    }
  };

  const handleRefreshAnalysis = async () => {
    if (!currentBrand?.id || isRefreshingAnalysis || !canRefreshAnalysis) return;
    setIsRefreshingAnalysis(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      clearAnalysisSnapshots(currentBrand.id);
      const res = await fetch(REFRESH_DATA_ANALYSIS_RFM_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(await getAppCheckHeader()),
        },
        body: JSON.stringify({ brandId: currentBrand.id, action: 'run' }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(body || `HTTP ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: ['brandSyncVersion', currentBrand.id] });
      await queryClient.invalidateQueries({ queryKey: ['dataAnalysisRfmAggregate', currentBrand.id] });
      toast.success('Η Data Analysis ανανεώθηκε και αποθηκεύτηκε.');
    } catch (e) {
      toast.error(`Αποτυχία ανανέωσης Data Analysis: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsRefreshingAnalysis(false);
    }
  };

  const handleDeleteSegments = async () => {
    if (rfmDataSource === 'ecommerce') return;
    if (!currentBrand?.id) return;
    if (!window.confirm(`Διαγραφή όλων των segments (${rfmSegments.length}) για το brand "${currentBrand.name}"; Αυτή η ενέργεια δεν αναιρείται.`)) return;
    setIsDeleting(true);
    try {
      await FirestoreService.deleteCollection('segments', currentBrand.id);
      clearAnalysisSnapshots(currentBrand.id);
      queryClient.invalidateQueries({ queryKey: ['segments', currentBrand.id] });
      queryClient.invalidateQueries({ queryKey: ['segments'] });
      toast.success('Τα segments διαγράφηκαν επιτυχώς.');
    } catch (e) {
      toast.error(`Σφάλμα διαγραφής: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  if (segmentsLoading) {
    return (
      <DataAnalysisSkeleton />
    );
  }

  if (!hasImportedSegments) {
    const hasEcomm = ecomm.connectedPlatforms.length > 0;
    const stillLoadingOrders =
      (ordersLoading && !ordersError) || (ecomm.isLoading && !hasEcomm && !ordersError);
    return (
      <div className="space-y-6">
        <PageHeader
          title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Data Analysis</h2>}
          actions={
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw size={14} className={`shrink-0 ${isRefreshingAnalysis ? 'animate-spin' : ''}`} />}
              onClick={handleRefreshAnalysis}
              disabled={isRefreshingAnalysis || !currentBrand?.id}
              className="min-h-[36px] w-full sm:w-auto"
              title="Η ανάλυση τρέχει αυτόματα κάθε πρώτη ημέρα του μήνα. Μπορείτε να την ανανεώσετε χειροκίνητα όποτε χρειάζεται."
            >
              {isRefreshingAnalysis ? 'Ανανέωση…' : 'Ανανέωση ανάλυσης'}
            </Button>
          }
          description={
            <p className="text-sm text-[#4A4A4A] sm:text-base leading-snug">
              Ανάλυση τμημάτων πελατών (RFM, behavioral, firmographic) από e-shop orders ή ERP/other data
            </p>
          }
        />
        <Card padding="lg" className="max-w-2xl mx-auto">
          {stillLoadingOrders ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Spinner size="lg" />
              <p className="text-sm font-semibold text-[#1A1A1A]">Φόρτωση παραγγελιών e-shop…</p>
            </div>
          ) : ordersError ? (
            <div className="text-center py-8">
              <p className="text-sm font-semibold text-[#B91C1C] mb-2">Αδυναμία ανάγνωσης παραγγελιών</p>
              <p className="text-xs text-[#4A4A4A] mb-4 max-w-md mx-auto">
                {ordersError.message || 'Άγνωστο σφάλμα από Firestore. Δοκιμάστε refresh ή ξανά sync τους connectors.'}
              </p>
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Επαναφόρτωση σελίδας
              </Button>
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-[#4A4A4A] mb-4">
                {hasEcomm && !canComputeFromOrders
                  ? 'Δεν υπάρχει ακόμη αποθηκευμένη Data Analysis για αυτό το brand.'
                  : 'Δεν υπάρχει ακόμη αποθηκευμένη Data Analysis.'}
              </p>
              <p className="text-sm text-[#4A4A4A]">
                Πατήστε <span className="font-semibold text-[#1A1A1A]">Ανανέωση ανάλυσης</span> για να δημιουργηθεί snapshot που θα μείνει ορατό έως την επόμενη μηνιαία ή χειροκίνητη ανάλυση.
              </p>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const showDataSourceSelector =
    canComputeFromOrders || ordersLoading || ecomm.hasData || ecomm.connectedPlatforms.length > 0;
  const ordersOptionUnavailable = !canComputeIdentifiedOrders && !ordersLoading;
  const isErpRfmOrders = rfmDataOrigin === 'erp_orders';
  const effectiveSourceChoice =
    rfmSourcePref === 'orders' && !ordersOptionUnavailable ? 'orders' : 'external';
  return (
    <div className="space-y-3">
      <PageHeader
        className="gap-2 lg:gap-4 [&_.space-y-1]:space-y-0"
        toolbarAriaLabel="Εξαγωγή και διαγραφή segments"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl leading-tight">Data Analysis</h2>}
        actions={
          <>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} className={`shrink-0 ${isRefreshingAnalysis ? 'animate-spin' : ''}`} />}
            onClick={handleRefreshAnalysis}
            disabled={isRefreshingAnalysis || !currentBrand?.id || !canRefreshAnalysis}
            className="min-h-[36px] w-full sm:w-auto"
            title={
              canRefreshAnalysis
                ? 'Η ανάλυση τρέχει αυτόματα σε μηνιαία βάση, αν το επιθυμείτε ανανεώστε τη χειροκίνητα.'
                : 'Μόνο ο ιδιοκτήτης ή διαχειριστής του brand μπορεί να ανανεώσει χειροκίνητα την ανάλυση.'
            }
          >
            {isRefreshingAnalysis ? 'Ανανέωση…' : 'Ανανέωση ανάλυσης'}
          </Button>
          {activeTab === 'rfm' && (
            <>
              <Button
                variant="primary"
                size="sm"
                icon={<Users size={14} className="shrink-0" />}
                onClick={() => handleExportCustomerList(null, 'csv')}
                disabled={isExporting || !hasImportedSegments}
                className="min-h-[36px] flex-1 basis-[calc(50%-0.1875rem)] sm:flex-initial sm:basis-auto"
              >
                <span className="hidden min-[380px]:inline">Λίστες πελατών </span>
                <span className="min-[380px]:hidden">Λίστες </span>
                .csv
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<FileSpreadsheet size={14} className="shrink-0" />}
                onClick={() => handleExportAll('xlsx')}
                disabled={isExporting || !hasImportedSegments}
                className="min-h-[36px] flex-1 basis-[calc(50%-0.1875rem)] sm:flex-initial sm:basis-auto"
              >
                {isExporting ? (
                  'Exporting…'
                ) : (
                  <>
                    <span className="hidden min-[380px]:inline">Action Packs </span>
                    <span className="min-[380px]:hidden">Packs </span>
                    .xlsx
                  </>
                )}
              </Button>
            </>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={<Trash2 size={14} className="shrink-0" />}
            onClick={handleDeleteSegments}
            disabled={isDeleting || !hasImportedSegments || rfmDataSource === 'ecommerce'}
            className="min-h-[36px] w-full text-[#DC2626] hover:bg-[#FEE2E2] sm:w-auto"
            title={rfmDataSource === 'ecommerce' ? 'Η διαγραφή ισχύει μόνο για segments από e-shop & others' : undefined}
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
          </>
        }
      />

      {/* One compact row: source + sizes — no duplication with coverage when it is purely e-shop */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[#E8EAED] bg-[#FAFBFC] px-3 py-2 text-[12px] text-[#374151]">
        {showDataSourceSelector ? (
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <span className="text-[#6B7280] whitespace-nowrap">Πηγή</span>
            <div className="inline-flex rounded-lg border border-[#E5E7EB] bg-white p-0.5 shadow-sm">
              <button
                type="button"
                className={`rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                  effectiveSourceChoice === 'orders'
                    ? 'bg-[var(--nts-accent)] text-white'
                    : 'text-[#6B7280] hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-45'
                }`}
                disabled={ordersOptionUnavailable}
                title={
                  ordersOptionUnavailable
                    ? 'Δεν υπάρχουν ακόμη αναγνωρίσιμοι πελάτες για RFM.'
                    : isErpRfmOrders
                      ? 'Εξαιρεί generic λιανική όπως "Πελάτης Λιανικής".'
                      : undefined
                }
                onClick={() => setDataSourcePreference('orders')}
              >
                {isErpRfmOrders ? 'ERP orders' : 'E-shop orders'}
              </button>
              <button
                type="button"
                className={`rounded-md px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                  effectiveSourceChoice === 'external'
                    ? 'bg-[var(--nts-accent)] text-white'
                    : 'text-[#6B7280] hover:bg-[#F9FAFB]'
                }`}
                onClick={() => setDataSourcePreference('external')}
              >
                {isErpRfmOrders ? 'ERP orders + retail' : 'E-shop orders + guests'}
              </button>
            </div>
          </div>
        ) : null}
        {showDataSourceSelector ? (
          <span className="hidden sm:inline h-4 w-px shrink-0 bg-[#E5E7EB]" aria-hidden />
        ) : null}
        {hasImportedSegments ? (
          <span className="font-semibold tabular-nums text-[#111827]">
            {rfmSegments.length} segments · {formatNumber(totalCustomersDisplay)} πελάτες
          </span>
        ) : null}
        {rfmDataSource === 'ecommerce' ? (
          <span className="text-[#6B7280]">
            {rfmSourcePref === 'external' ? 'Όλοι οι αγοραστές · 12-month order history' : 'Αναγνωρίσιμοι πελάτες · 12-month order history'}
          </span>
        ) : (
          <span className="text-[#6B7280]">Εισαγωγή / ERP εκτός e-shop</span>
        )}
        <DataSourcePill
          label="Source"
          value={rfmSourceLabel}
          tone={rfmDataSource === 'import' ? 'warning' : rfmDataSource === 'ecommerce' ? 'success' : 'neutral'}
        />
        <span className={analysisSnapshotIsStale ? 'font-medium text-[#B45309]' : 'text-[#6B7280]'}>
          {lastAnalysisLabel}
          {analysisSnapshotIsStale ? ' · χρειάζεται χειροκίνητη ανανέωση' : ''}
        </span>
        {rfmDataSource === 'ecommerce' && orderRfmMeta && orderRfmMeta.guestOrdersSkipped > 0 ? (
          (() => {
            const totalCustomerScoped =
              (orderRfmMeta.ordersAttributed ?? 0) + orderRfmMeta.guestOrdersSkipped;
            const guestPct = totalCustomerScoped > 0
              ? Math.round((orderRfmMeta.guestOrdersSkipped / totalCustomerScoped) * 100)
              : 0;
            const tone = guestPct >= 50 ? 'text-[#B45309]' : 'text-[#6B7280]';
            return (
              <span
                className={`text-[11px] font-medium ${tone}`}
                title="Παραγγελίες χωρίς customer id ή email — δεν εντάσσονται στο RFM (απαιτείται σταθερή ταυτότητα πελάτη)."
              >
                · guest χωρίς ταυτοποίηση: {formatNumber(orderRfmMeta.guestOrdersSkipped)}
                {totalCustomerScoped > 0 ? ` (${guestPct}%)` : ''}
              </span>
            );
          })()
        ) : null}
        {ordersLoading && rfmSourcePref === 'orders' ? (
          <LoadingStatusPill label="Loading order history…" />
        ) : null}
        {isCatalogEnriching && rfmDataSource === 'ecommerce' ? (
          <LoadingStatusPill label="Loading product catalog…" />
        ) : null}
      </div>

      {/* Analysis Tabs */}
      <div className="-mx-1 max-w-full overflow-x-auto pb-1 sm:mx-0 sm:overflow-visible sm:pb-0">
      <div className="flex w-max items-center gap-1 rounded-xl bg-[var(--nts-light-gray)] p-1 sm:w-fit">
        <TabButton
          active={activeTab === 'rfm'}
          onClick={() => setActiveTab('rfm')}
          icon={<Users size={14} />}
          label="RFM"
          tooltipTitle="RFM Segments"
          tooltipBody="Ομαδοποίηση πελατών βάσει Recency (πόσο πρόσφατα αγόρασαν), Frequency (πόσο συχνά) και Monetary (πόση αξία)."
          tooltipBullets={[
            'Segments: Champions, Loyal, At Risk, Hibernating, Lost…',
            'Δείχνει: μέγεθος, % πελατολογίου, revenue share',
            'Παράγει: Action Packs & λίστες πελατών για campaigns',
          ]}
        />
        <TabButton
          active={activeTab === 'behavioral'}
          onClick={() => setActiveTab('behavioral')}
          icon={<Brain size={14} />}
          label="Behavioral"
          tooltipTitle="Behavioral Analysis"
          tooltipBody="Προτιμήσεις, κανάλια και ρυθμός αγορών ανά segment."
          tooltipBullets={[
            'Lifecycle stage (Νέος, Ενεργός, Πιστός, Φθίνων, Αδρανής)',
            'Engagement & upsell potential',
            'Προτιμώμενα κανάλια, συσκευές & συχνότητα',
          ]}
        />
        <TabButton
          active={activeTab === 'predictive'}
          onClick={() => setActiveTab('predictive')}
          icon={<LineChart size={14} />}
          label="Predictive"
          tooltipTitle="Predictive LTV"
          tooltipBody="Πρόβλεψη μελλοντικής αξίας (Lifetime Value) και ρίσκου ανά segment."
          tooltipBullets={[
            'Εκτιμώμενο LTV (12 μηνών)',
            'Πιθανότητα επόμενης αγοράς & churn risk',
            'Στόχευση retention budget στα segments με μεγαλύτερο upside',
          ]}
        />
      </div>
      </div>

      {activeTab === 'behavioral' && <BehavioralTab segments={rfmSegments} />}
      {activeTab === 'predictive' && <PredictiveTab segments={rfmSegments} />}

      {activeTab === 'rfm' && <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Card padding="sm" hover>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--nts-light-gray)]">
              <Users size={18} className="text-[var(--nts-accent)]" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[11px] text-[#4A4A4A]">
                <InfoTooltip content="Συνολικός αριθμός πελατών στη βάση RFM.">Πελάτες</InfoTooltip>
              </p>
              <p className="font-mono text-lg font-bold text-[#1A1A1A]">{formatNumber(totalCustomersDisplay)}</p>
            </div>
          </div>
        </Card>
        <Card padding="sm" hover>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#DCFCE7]">
              <TrendingUp size={18} className="text-[#22C55E]" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[11px] text-[#4A4A4A]">
                <InfoTooltip content="Αριθμός RFM segments.">Segments</InfoTooltip>
              </p>
              <p className="text-lg font-bold text-[#1A1A1A]">{rfmSegments.length}</p>
            </div>
          </div>
        </Card>
        <Card padding="sm" hover>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F5F5F5]">
              <Zap size={18} className="text-[#4A4A4A]" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[11px] text-[#4A4A4A]">
                <InfoTooltip content="Μέσος RFM score (1–5).">Μέσος score</InfoTooltip>
              </p>
              <p className="font-mono text-lg font-bold text-[#1A1A1A]">
                {(() => {
                  if (rfmSegments.length === 0) return '0';
                  const scores = rfmSegments
                    .map((s) => calculateAvgRFMScore(s.rfm_score, s.name))
                    .filter((score): score is number => score !== null && !isNaN(score) && isFinite(score));
                  if (scores.length === 0) return '0';
                  return formatNumber(scores.reduce((a, b) => a + b, 0) / scores.length, 1);
                })()}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="sm" hover>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FEF3C7]">
              <TrendingDown size={18} className="text-[#F59E0B]" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[11px] text-[#4A4A4A]">
                <InfoTooltip content="Ποσοστό πελατών At Risk.">At Risk</InfoTooltip>
              </p>
              <p className="font-mono text-lg font-bold text-[#F59E0B]">
                {fmtPct(rfmSegments.find((s) => s.id === 'at_risk')?.percentage ?? 0)}%
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
        <Card padding="lg" className="flex min-w-0 flex-col border border-[#E8EAED] shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
          <CardHeader
            title="Κατανομή πελατών (RFM)"
            icon={<Users size={18} className="text-[var(--fgColor-muted,#57606a)] shrink-0" />}
          />
          <div className="min-h-[260px] w-full min-w-0 flex-1" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height={280} minHeight={260}>
              <PieChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
                <Pie
                  data={rfmChartSegments}
                  cx="50%"
                  cy="50%"
                  innerRadius={68}
                  outerRadius={108}
                  paddingAngle={2}
                  dataKey="percentage"
                  nameKey="name"
                  animationBegin={0}
                  animationDuration={700}
                  onClick={(_, index) => {
                    // PER-175 — slice click behaves like the legend: same segment selection, same tables below.
                    const id = rfmSegments[index]?.id;
                    if (id) setSelectedSegmentId(id);
                  }}
                >
                  {rfmSegments.map((segment) => (
                    <Cell
                      key={segment.id}
                      fill={segment.color}
                      stroke={selectedSegment?.id === segment.id ? SELECTED_SEGMENT_STROKE : '#FFFFFF'}
                      strokeWidth={selectedSegment?.id === segment.id ? 1.5 : 1}
                      strokeOpacity={selectedSegment?.id === segment.id ? 0.9 : 0.7}
                      className="cursor-pointer transition-opacity outline-none focus:outline-none"
                      style={{ outline: 'none' }}
                      tabIndex={-1}
                      focusable={false}
                      opacity={selectedSegment ? (selectedSegment.id === segment.id ? 1 : 0.5) : 1}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #E5E5E5',
                    borderRadius: '8px',
                    fontSize: '12px',
                    padding: '8px 12px',
                  }}
                  formatter={(value: number | undefined, _name: string | undefined, item: { payload?: { name?: string } }) => [
                    `${formatPercent(value ?? 0, 1)} πελάτες`,
                    item?.payload?.name ?? '',
                  ]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
            {rfmSegments.map((segment) => (
              <button
                key={segment.id}
                type="button"
                onClick={() => setSelectedSegmentId(segment.id)}
                className={`flex min-w-0 items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FDBA74]/50 ${
                  selectedSegment?.id === segment.id ? 'bg-[#FFF7ED] ring-1 ring-[#FED7AA]' : 'hover:bg-[#F9FAFB]'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
                  <span className="truncate text-[#374151]">{segment.name}</span>
                </span>
                <span className="shrink-0 font-mono font-semibold text-[#111827]">
                  {formatPercent(segment.percentage ?? 0, 1)}
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card padding="lg" className="flex min-w-0 flex-col border border-[#E8EAED] shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
          <CardHeader title="Μερίδιο τζίρου ανά segment" />
          <div className="min-h-[260px] w-full min-w-0 flex-1" style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height={280} minHeight={260}>
              <PieChart margin={{ top: 12, right: 12, bottom: 12, left: 12 }}>
                <Pie
                  data={rfmChartSegments}
                  cx="50%"
                  cy="50%"
                  innerRadius={68}
                  outerRadius={108}
                  paddingAngle={2}
                  dataKey="revenue_share"
                  nameKey="name"
                  animationBegin={0}
                  animationDuration={700}
                  onClick={(_, index) => {
                    // PER-175 — slice click behaves like the legend: same segment selection, same tables below.
                    const id = rfmSegments[index]?.id;
                    if (id) setSelectedSegmentId(id);
                  }}
                >
                  {rfmSegments.map((segment) => (
                    <Cell
                      key={segment.id}
                      fill={segment.color}
                      stroke={selectedSegment?.id === segment.id ? SELECTED_SEGMENT_STROKE : '#FFFFFF'}
                      strokeWidth={selectedSegment?.id === segment.id ? 1.5 : 1}
                      strokeOpacity={selectedSegment?.id === segment.id ? 0.9 : 0.7}
                      className="cursor-pointer transition-opacity outline-none focus:outline-none"
                      style={{ outline: 'none' }}
                      tabIndex={-1}
                      focusable={false}
                      opacity={selectedSegment ? (selectedSegment.id === segment.id ? 1 : 0.5) : 1}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #E5E5E5',
                    borderRadius: '8px',
                    fontSize: '12px',
                    padding: '8px 12px',
                  }}
                  formatter={(value: number | undefined) => [`${fmtPct(value ?? 0)}% τζίρου`, 'Μερίδιο']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-1 grid max-h-40 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
            {rfmSegments.map((segment) => (
              <button
                key={segment.id}
                type="button"
                onClick={() => setSelectedSegmentId(segment.id)}
                className={`flex min-w-0 items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FDBA74]/50 ${
                  selectedSegment?.id === segment.id ? 'bg-[#FFF7ED] ring-1 ring-[#FED7AA]' : 'hover:bg-[#F9FAFB]'
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
                  <span className="truncate text-[#374151]">{segment.name}</span>
                </span>
                <span className="shrink-0 font-mono font-semibold" style={{ color: segment.color }}>
                  {fmtPct(segment.revenue_share ?? 0)}%
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Segment Detail Panel */}
      <AnimatePresence>
        {selectedSegment && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <SegmentDetail
              segment={selectedSegment}
              movement={segmentMovementById.get(selectedSegment.id)}
              catalogEnriching={isCatalogEnriching}
              segmentsDataSource={rfmDataSource}
              onExportCustomers={(fmt) => handleExportCustomerList(selectedSegment, fmt)}
              onExportActionPack={(fmt) => handleExportSegment(selectedSegment, fmt)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <details className="group rounded-xl border border-[#E8EAED] bg-[#FAFBFC] shadow-[0_2px_8px_rgba(15,23,42,0.04)]">
        <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
          <div className="flex items-start gap-2">
            <ChevronRight
              size={16}
              className="mt-0.5 shrink-0 text-[var(--nts-accent)] transition-transform duration-200 group-open:rotate-90"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-[var(--nts-accent)] hover:underline">
                Κάρτες ανά segment (προαιρετικά)
              </span>
              <span className="mt-1 block text-[11px] font-normal leading-snug text-[#6B7280]">
                Πάτησε για άνοιγμα — οι κάρτες επαναλαμβάνουν τα ίδια segments για γρήγορο export χωρίς να ανοίξει το πάνελ λεπτομερειών.
              </span>
            </div>
          </div>
        </summary>
        <div className="border-t border-[#E5E7EB] px-4 pb-4 pt-3">
          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rfmSegments.map((segment, index) => (
              <SegmentCard
                key={segment.id}
                segment={segment}
                index={index}
                isSelected={selectedSegment?.id === segment.id}
                onSelect={() => setSelectedSegmentId(segment.id)}
                onExport={(fmt) => handleExportSegment(segment, fmt)}
              />
            ))}
          </div>
        </div>
      </details>

      {/* Migration Flow */}
      <Card padding="lg">
        <CardHeader
          title="Segment Migration"
          subtitle={hasImportedSegments ? `Σύγκριση περιόδων ${segmentPeriodComparison?.periodDays ?? segmentMigration?.periodDays ?? 30} ημερών` : ''}
          icon={<ArrowRight size={20} className="text-[var(--nts-accent)]" />}
        />
        <div className="space-y-3">
          {hasImportedSegments && rfmSegments.length > 0 ? (
            segmentPeriodComparison?.canCompute && segmentPeriodComparison.rows.length > 0 ? (
              <>
                <p className="text-xs text-[#6B7280]">
                  Τρέχουσα περίοδος {new Date(segmentPeriodComparison.currentFrom).toLocaleDateString('el-GR')} – {new Date(segmentPeriodComparison.currentTo).toLocaleDateString('el-GR')}
                  {' '}vs προηγούμενη {new Date(segmentPeriodComparison.previousFrom).toLocaleDateString('el-GR')} – {new Date(segmentPeriodComparison.previousTo).toLocaleDateString('el-GR')}.
                  {' '}Σύγκριση {formatNumber(segmentPeriodComparison.currentCustomers)} vs {formatNumber(segmentPeriodComparison.previousCustomers)} αναγνωρίσιμων πελατών
                  {segmentPeriodComparison.periodDays === 90 ? ' (3μηνο fallback επειδή το μηνιαίο παράθυρο δεν είχε αρκετό ιστορικό).' : '.'}
                </p>
                <div className="space-y-2">
                  {segmentPeriodComparison.rows.map((row) => {
                    const color = segmentColorById.get(row.id) || '#1A1A1A';
                    const deltaTone = row.countDelta > 0 ? 'up' : row.countDelta < 0 ? 'down' : 'flat';
                    const deltaColor = deltaTone === 'up' ? '#16A34A' : deltaTone === 'down' ? '#DC2626' : '#6B7280';
                    return (
                      <div key={row.id} className="rounded-xl border border-[#E5E5E5] bg-white p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-2 text-sm">
                            <span className="min-w-0 truncate font-semibold" style={{ color }}>{row.name}</span>
                            <span className="rounded-full bg-[#F5F5F5] px-2 py-0.5 font-mono text-xs text-[#4A4A4A]">
                              {formatNumber(row.previousCount)} → {formatNumber(row.currentCount)} πελάτες
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-3 font-mono text-xs">
                            <span className="font-bold" style={{ color: deltaColor }}>
                              {row.countDelta > 0 ? '+' : ''}{formatNumber(row.countDelta, 0)} πελάτες
                            </span>
                            <span className="rounded-full bg-[#F5F5F5] px-2 py-0.5 text-[#4A4A4A]">
                              {row.shareDelta > 0 ? '+' : ''}{formatNumber(row.shareDelta, 1)}pp
                            </span>
                            <span className="text-[#6B7280]">
                              {formatCurrencyCompact(row.previousRevenue)} → {formatCurrencyCompact(row.currentRevenue)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {segmentMigration?.canCompute && segmentMigration.flows.length > 0 && (
                  <p className="text-xs text-[#6B7280]">
                    Επιπλέον, εντοπίστηκαν {formatNumber(segmentMigration.flows.length)} τύποι πραγματικής μετακίνησης πελατών μεταξύ segments στο ίδιο παράθυρο.
                  </p>
                )}
              </>
            ) : segmentMigration?.canCompute && segmentMigration.flows.length > 0 ? (
              <>
                <p className="text-xs text-[#6B7280]">
                  Δεν υπάρχει αρκετό συνεχόμενο period history για σύγκριση περιόδων. Εμφανίζονται οι πραγματικές μετακινήσεις {formatNumber(segmentMigration.comparedCustomers)} πελατών.
                </p>
                <div className="space-y-2">
                  {segmentMigration.flows.map((flow) => {
                    const fromColor = segmentColorById.get(flow.from) || '#9CA3AF';
                    const toColor = segmentColorById.get(flow.to) || '#1A1A1A';
                    return (
                      <div key={`${flow.from}-${flow.to}`} className="rounded-xl border border-[#E5E5E5] bg-white p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex min-w-0 items-center gap-2 text-sm">
                            <span className="min-w-0 truncate font-medium" style={{ color: fromColor }}>{flow.fromName}</span>
                            <ArrowRight size={14} className="shrink-0 text-[#9CA3AF]" />
                            <span className="min-w-0 truncate font-semibold" style={{ color: toColor }}>{flow.toName}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-3 font-mono text-xs">
                            <span className="font-bold text-[#1A1A1A]">{formatNumber(flow.count)} πελάτες</span>
                            <span className="rounded-full bg-[#F5F5F5] px-2 py-0.5 text-[#4A4A4A]">{formatNumber(flow.percentage, 1)}%</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-sm text-[#4A4A4A] py-4 text-center">
                Δεν υπάρχει ακόμα αρκετό συγκρίσιμο ιστορικό για τρέχουσα vs προηγούμενη περίοδο {segmentPeriodComparison?.periodDays ?? segmentMigration?.periodDays ?? 90} ημερών.
                Η ένδειξη ανανεώνεται με τη μηνιαία Data Analysis ή χειροκίνητα από την ανανέωση ανάλυσης.
              </p>
            )
          ) : (
            <p className="text-sm text-[#4A4A4A] py-4">
              Φόρτωσε RFM δεδομένα για να δεις την μετακίνηση μεταξύ segments.
            </p>
          )}
        </div>
      </Card>
      </>}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tooltipTitle?: string;
  tooltipBody?: string;
  tooltipBullets?: string[];
}

function LoadingStatusPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
      <span className="h-2.5 w-2.5 rounded-full border-2 border-amber-200 border-t-[var(--nts-accent)] animate-spin" aria-hidden />
      {label}
    </span>
  );
}

function DataAnalysisSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Φόρτωση Data Analysis">
      <PageHeader
        className="gap-2 lg:gap-4 [&_.space-y-1]:space-y-0"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl leading-tight">Data Analysis</h2>}
        actions={
          <>
            <div className="h-9 w-28 animate-pulse rounded-lg bg-[#F3F4F6]" />
            <div className="h-9 w-28 animate-pulse rounded-lg bg-[#F3F4F6]" />
            <div className="h-9 w-32 animate-pulse rounded-lg bg-[#F3F4F6]" />
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#E8EAED] bg-[#FAFBFC] px-3 py-2">
        <div className="h-6 w-48 animate-pulse rounded-lg bg-[#E5E7EB]" />
        <div className="h-4 w-24 animate-pulse rounded bg-[#E5E7EB]" />
        <div className="h-6 w-28 animate-pulse rounded-full bg-[#E5E7EB]" />
      </div>

      <div className="rounded-2xl border border-[#E5E7EB] bg-white p-3 shadow-sm">
        <div className="mb-3 h-4 w-40 animate-pulse rounded bg-[#E5E7EB]" />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-[#E5E7EB] bg-white p-4">
              <div className="mb-3 h-3 w-20 animate-pulse rounded bg-[#E5E7EB]" />
              <div className="h-5 w-14 animate-pulse rounded bg-[#E5E7EB]" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex w-fit items-center gap-1 rounded-xl bg-[var(--nts-light-gray)] p-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-lg bg-white" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} padding="md">
            <div className="h-4 w-24 animate-pulse rounded bg-[#E5E7EB]" />
            <div className="mt-4 h-7 w-16 animate-pulse rounded bg-[#E5E7EB]" />
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <Card key={i} padding="lg">
            <div className="mb-6 h-5 w-44 animate-pulse rounded bg-[#E5E7EB]" />
            <div className="mx-auto h-64 max-w-sm animate-pulse rounded-full bg-[#F3F4F6]" />
          </Card>
        ))}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label, tooltipTitle, tooltipBody, tooltipBullets }: TabButtonProps) {
  const hasTooltip = !!(tooltipTitle || tooltipBody || (tooltipBullets && tooltipBullets.length));

  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        aria-label={tooltipTitle ?? label}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
          active
            ? 'bg-white text-[#1A1A1A] shadow-sm'
            : 'text-[#4A4A4A] hover:text-[#1A1A1A]'
        }`}
      >
        {icon}
        {label}
      </button>
      {hasTooltip && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 opacity-0 transition-all duration-150 ease-out group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <div className="relative w-[280px] rounded-xl border border-[#E5E5E5] bg-white p-3 shadow-[0_8px_24px_rgba(0,0,0,0.08)]">
            <div
              aria-hidden="true"
              className="absolute -top-1.5 left-1/2 -translate-x-1/2 rotate-45 h-3 w-3 border-l border-t border-[#E5E5E5] bg-white"
            />
            {tooltipTitle && (
              <p className="text-[13px] font-semibold text-[#1A1A1A]">{tooltipTitle}</p>
            )}
            {tooltipBody && (
              <p className="mt-1 text-xs leading-snug text-[#4A4A4A]">{tooltipBody}</p>
            )}
            {tooltipBullets && tooltipBullets.length > 0 && (
              <ul className="mt-2 space-y-1">
                {tooltipBullets.map((b) => (
                  <li
                    key={b}
                    className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[#4A4A4A]"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-[var(--nts-accent)]"
                    />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface SegmentCardProps {
  segment: RFMSegment;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onExport: (fmt: 'xlsx' | 'csv') => void;
}

function SegmentCard({ segment, index, isSelected, onSelect, onExport }: SegmentCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card
        padding="md"
        hover
        onClick={onSelect}
        className={isSelected ? 'ring-2 ring-[var(--nts-accent)]' : ''}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0"
              style={{
                backgroundColor: `${segment.color}35`,
                border: `2px solid ${segment.color}`,
              }}
            >
              {/* segment color indicator */}
            </div>
            <div>
              <h3 className="font-semibold text-[#1A1A1A]">{segment.name}</h3>
              <p className="text-xs text-[#4A4A4A]">{segment.rfm_score}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onExport('xlsx'); }}
              className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#22C55E] hover:bg-[#22C55E]/5 transition-colors"
              title="Export .xlsx"
            >
              <FileSpreadsheet size={14} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onExport('csv'); }}
              className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[var(--nts-accent)] hover:bg-[var(--nts-accent)]/5 transition-colors"
              title="Export .csv"
            >
              <Download size={14} />
            </button>
            <ChevronRight
              size={18}
              className={`text-[#9CA3AF] transition-transform ${isSelected ? 'rotate-90' : ''}`}
            />
          </div>
        </div>

        <p className="text-sm text-[#4A4A4A] mt-3">{segment.description}</p>

        <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-[#E5E5E5]">
          <div>
            <p className="text-xs text-[#4A4A4A]">Πελάτες</p>
            <p className="font-bold text-[#1A1A1A] font-mono">
              {formatNumber(segment.count)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[#4A4A4A]">% πελατών</p>
            <p className="font-bold font-mono" style={{ color: segment.color }}>
              {fmtPct(segment.percentage ?? 0)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-[#4A4A4A]">% τζίρου</p>
            <p className="font-bold text-[#1A1A1A] font-mono">
              {fmtPct(segment.revenue_share ?? 0)}%
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

interface SegmentDetailProps {
  segment: RFMSegment;
  movement?: SegmentMovement;
  /** Catalog still loading — tabs are heuristic until *_products arrive. */
  catalogEnriching?: boolean;
  /** Where the segments come from — only for empty-state copy (does not change data logic). */
  segmentsDataSource: SegmentsDataSource;
  onExportCustomers?: (fmt: 'xlsx' | 'csv') => void;
  onExportActionPack?: (fmt: 'xlsx' | 'csv') => void;
}

function truncateAffinityLabel(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

type SegmentConsumptionTooltipPayload = {
  fullLabel?: string;
  pct?: number;
  revenue?: number;
  stockOnHand?: number;
  qtySold?: number;
  categoryPath?: string[];
};

function SegmentConsumptionTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: SegmentConsumptionTooltipPayload }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="max-w-[260px] rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 shadow-[0_10px_28px_rgba(15,23,42,0.12)]">
      <p className="text-[12px] font-semibold leading-snug text-[#111827]">
        {row.fullLabel || 'Γραμμή προϊόντος'}
      </p>
      <div className="mt-2 space-y-1 border-t border-[#F3F4F6] pt-2">
        {row.categoryPath?.length ? (
          <p className="text-[10.5px] leading-snug text-[#6B7280]">
            {row.categoryPath.join(' / ')}
          </p>
        ) : null}
        {row.stockOnHand != null ? (
          <div className="flex items-center justify-between gap-4 text-[11px]">
            <span className="text-[#6B7280]">Stock</span>
            <span className="font-mono font-semibold text-[#111827]">{formatNumber(row.stockOnHand, 0)}</span>
          </div>
        ) : null}
        {row.qtySold != null ? (
          <div className="flex items-center justify-between gap-4 text-[11px]">
            <span className="text-[#6B7280]">Sold</span>
            <span className="font-mono font-semibold text-[#111827]">{formatNumber(row.qtySold, 0)}</span>
          </div>
        ) : null}
        {row.stockOnHand == null && row.qtySold == null ? (
          <p className="text-[11px] text-[#6B7280]">No ERP stock/sales data for this item yet.</p>
        ) : null}
      </div>
    </div>
  );
}

function isGenericCatalogLabel(name: string): boolean {
  return /^(λοιπά|other|others|n\/a|unknown|άλλο)$/i.test(name.trim());
}

function SegmentDetail({
  segment,
  movement,
  catalogEnriching,
  segmentsDataSource,
  onExportCustomers,
  onExportActionPack,
}: SegmentDetailProps) {
  type CatalogDim = 'brand' | 'category' | 'subcategory' | 'sku';
  const [catalogDim, setCatalogDim] = useState<CatalogDim>('category');

  const behavioral = segment.behavioral;
  const hasCatalogRollups = behavioral?.catalog_match != null;
  const heuristicCats = behavioral?.category_affinity ?? [];
  const catalogCats = behavioral?.category_affinity_catalog ?? [];
  const fromComputedOrders = heuristicCats.length > 0 || hasCatalogRollups;

  const affinityForChart = (): CategoryAffinity[] => {
    if (!fromComputedOrders) return [];
    if (!hasCatalogRollups) return heuristicCats;
    switch (catalogDim) {
      case 'brand':
        return (behavioral?.brand_affinity ?? []).filter((row) => !isGenericCatalogLabel(row.name));
      case 'category':
        return catalogCats.length > 0 ? catalogCats : heuristicCats;
      case 'subcategory':
        return (behavioral?.subcategory_affinity ?? []).filter((row) => !isGenericCatalogLabel(row.name));
      case 'sku':
        return behavioral?.sku_affinity ?? [];
      default:
        return [];
    }
  };

  const chartCategories = affinityForChart();
  const chartRows = chartCategories.slice(0, 12).map((c) => {
    const pct =
      c.revenue_share_pct != null && c.revenue_share_pct > 0
        ? c.revenue_share_pct
        : Math.round((c.affinity ?? 0) * 10000) / 100;
    return {
      label: truncateAffinityLabel(c.name),
      fullLabel: c.name,
      pct,
      revenue: c.revenue_eur ?? 0,
      stockOnHand: c.stock_on_hand,
      qtySold: c.qty_sold,
      categoryPath: c.category_path,
    };
  });

  const chartHeight = Math.min(420, Math.max(220, 48 + chartRows.length * 36));
  const cm = behavioral?.catalog_match;

  const brandAff = (behavioral?.brand_affinity ?? []).filter((row) => !isGenericCatalogLabel(row.name));
  const subAff = (behavioral?.subcategory_affinity ?? []).filter((row) => !isGenericCatalogLabel(row.name));
  const priceSens = behavioral?.price_sensitivity ?? null;
  const channelPills = behavioral?.preferred_channels?.length ? behavioral.preferred_channels : [];

  const dimLabel: Record<CatalogDim, string> = {
    brand: 'Brands',
    category: 'Categories',
    subcategory: 'Subcategories',
    sku: 'SKU',
  };

  const leftChartTitle = hasCatalogRollups
    ? `Mix κατανάλωσης · ${dimLabel[catalogDim]}`
    : 'Consumption mix · Categories';
  const movementTone =
    movement && movement.countDelta !== 0
      ? movement.countDelta > 0
        ? 'positive'
        : 'negative'
      : null;
  const movementColor = movementTone === 'positive' ? '#16A34A' : movementTone === 'negative' ? '#DC2626' : '#6B7280';
  const movementIcon =
    movementTone === 'positive' ? (
      <TrendingUp size={12} aria-hidden />
    ) : movementTone === 'negative' ? (
      <TrendingDown size={12} aria-hidden />
    ) : null;

  return (
    <Card padding="lg">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl"
            style={{ backgroundColor: `${segment.color}20` }}
          >
            {/* no emoji icons */}
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#1A1A1A]">{segment.name}</h3>
            <p className="text-[#4A4A4A]">{segment.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-medium text-[#374151]">
                Πελάτες: <span className="font-mono font-bold text-[#111827]">{formatNumber(segment.count ?? 0)}</span>
                {movementTone && movement ? (
                  <span className="ml-1 inline-flex items-center gap-0.5 font-mono font-bold" style={{ color: movementColor }}>
                    {movementIcon}
                    {movement.countDelta > 0 ? '+' : ''}
                    {formatNumber(movement.countDelta, 0)}
                  </span>
                ) : null}
              </span>
              <span className="rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-medium text-[#374151]">
                % πελατών: <span className="font-mono font-bold" style={{ color: segment.color }}>{fmtPct(segment.percentage ?? 0)}%</span>
                {movementTone && movement ? (
                  <span className="ml-1 inline-flex items-center gap-0.5 font-mono font-bold" style={{ color: movementColor }}>
                    {movementIcon}
                    {movement.percentageDelta > 0 ? '+' : ''}
                    {formatNumber(movement.percentageDelta, 1)}%
                  </span>
                ) : null}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div>
          <h4 className="font-medium text-[#1A1A1A] mb-2">{leftChartTitle}</h4>
          {catalogEnriching && !cm && (
            <p className="text-[11px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded px-2 py-1 mb-2">
              Φόρτωση catalog… προσωρινά εμφανίζονται heuristic κατηγορίες· τα Brand/SKU tabs συμπληρώνονται μετά.
            </p>
          )}
          {cm && (
            <p className="text-[11px] text-[#6B7280] mb-2">
              Catalog match: {formatNumber(cm.revenue_matched_pct, 1)}% τζίρου γραμμών ·{' '}
              {formatNumber(cm.lines_matched_pct, 1)}% γραμμών ({cm.lines_matched}/{cm.lines_total})
            </p>
          )}
          {hasCatalogRollups && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(['brand', 'category', 'subcategory', 'sku'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setCatalogDim(d)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                    catalogDim === d
                      ? 'bg-[var(--nts-accent)] text-white'
                      : 'bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB]'
                  }`}
                >
                  {dimLabel[d]}
                </button>
              ))}
            </div>
          )}
          {chartRows.length > 0 ? (
            <div className="w-full min-h-[220px] rounded-xl border border-[#F3F4F6] bg-gradient-to-b from-white to-[#FAFAFA] px-2 py-3" style={{ height: chartHeight }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} layout="vertical" margin={{ left: 8, right: 18, top: 6, bottom: 6 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F3F4F6" />
                  <XAxis
                    type="number"
                    domain={[0, 'dataMax']}
                    tick={{ fontSize: 11, fill: '#4A4A4A' }}
                    tickFormatter={(v) => `${formatNumber(Number(v), Number(v) >= 10 ? 0 : 1)}%`}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={136}
                    tick={{ fontSize: 11, fill: '#374151' }}
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                  />
                  <Tooltip
                    cursor={{ fill: '#FFF7ED' }}
                    content={<SegmentConsumptionTooltip />}
                  />
                  <Bar
                    dataKey="pct"
                    fill={segment.color}
                    fillOpacity={0.88}
                    radius={[0, 6, 6, 0]}
                    barSize={20}
                    background={{ fill: '#F8FAFC', radius: 6 }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex min-h-[16rem] flex-col items-center justify-center rounded-lg bg-[#F5F5F5] px-4 py-8 text-center">
              <p className="text-sm font-medium text-[#374151]">
                {segmentsDataSource === 'ecommerce'
                  ? 'Δεν υπάρχουν δεδομένα γραμμών προϊόντων για αυτό το segment'
                  : 'Δεν υπάρχουν δεδομένα για αυτή τη διάσταση'}
              </p>
              {segmentsDataSource === 'ecommerce' && (
                <p className="mt-2 max-w-md text-xs leading-relaxed text-[#6B7280]">
                  Το RFM από e-shop χρειάζεται γραμμές παραγγελίας (SKU/title/product id). Μετά από πλήρες sync των connectors,
                  εδώ εμφανίζονται πραγματικές κατηγορίες και — όταν φορτώνει ο catalog — μάρκες/υποκατηγορίες από το κατάστημα και το ERP.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Preferred Brands</h5>
            {brandAff.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {brandAff.slice(0, 12).map((row) => (
                  <span key={row.name} title={row.revenue_eur != null ? `${formatCurrencyCompact(row.revenue_eur)}` : undefined}>
                    <Badge variant="default">{row.name}</Badge>
                  </span>
                ))}
              </div>
            ) : fromComputedOrders && hasCatalogRollups ? (
              <p className="text-xs text-[#6B7280] leading-relaxed">
                Δεν εντοπίστηκε brand στο catalog για τις γραμμές του segment (ή όλα ως «Λοιπά»).
              </p>
            ) : (
              <p className="text-xs text-[#4A4A4A]">Δεν υπάρχουν δεδομένα</p>
            )}
          </div>

          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Subcategories</h5>
            {subAff.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {subAff.slice(0, 12).map((row) => (
                  <Badge key={row.name} variant="info">{row.name}</Badge>
                ))}
              </div>
            ) : fromComputedOrders && hasCatalogRollups ? (
              <p className="text-xs text-[#6B7280] leading-relaxed">
                Δεν υπάρχουν υποκατηγορίες στο catalog (π.χ. δεύτερο επίπεδο Woo ή ERP subcategory).
              </p>
            ) : (
              <p className="text-xs text-[#4A4A4A]">Δεν υπάρχουν δεδομένα</p>
            )}
          </div>

          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Ευαισθησία τιμής</h5>
            {priceSens ? (
              <Badge
                variant={
                  priceSens === 'low' ? 'success' :
                  priceSens === 'medium' ? 'warning' : 'danger'
                }
                size="md"
              >
                {priceSens.toUpperCase()}
              </Badge>
            ) : (
              <p className="text-xs text-[#4A4A4A]">Δεν υπάρχουν δεδομένα</p>
            )}
          </div>

          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Προτιμώμενα κανάλια</h5>
            <div className="flex flex-wrap gap-2">
              {channelPills.length > 0 ? (
                channelPills.map((channel) => (
                  <Badge key={channel} variant="info">{channel}</Badge>
                ))
              ) : (
                <p className="text-xs text-[#4A4A4A]">Δεν υπάρχουν δεδομένα</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Button variant="primary" className="w-full" icon={<Users size={16} />} onClick={() => onExportCustomers?.('csv')}>
              Λίστα πελατών + email (.csv)
            </Button>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" icon={<FileSpreadsheet size={14} />} onClick={() => onExportActionPack?.('xlsx')}>
                Action Pack
              </Button>
              <Button variant="secondary" className="flex-1" icon={<Download size={14} />} onClick={() => onExportCustomers?.('xlsx')}>
                Πελάτες .xlsx
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
