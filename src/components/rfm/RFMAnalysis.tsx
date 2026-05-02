import { useState } from 'react';
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
import { Card, CardHeader, Badge, Button, Spinner, Tooltip as InfoTooltip, useToast, PageHeader } from '../common';
import { useSegments, type SegmentDataCoverage, type SegmentsDataSource } from '../../hooks/useSegments';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useBrand } from '../../hooks/useBrand';
import { FirestoreService } from '../../services/firestore';
import { segmentCategoryMatrix } from '../../data';
import { BehavioralTab } from './BehavioralTab';
import { PredictiveTab } from './PredictiveTab';
import { exportSegmentActionPack, exportAllSegmentActionPacks, exportSegmentCustomerList, exportAllSegmentCustomerLists } from '../../services/segmentActionPack';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import type { CategoryAffinity, RFMSegment } from '../../types';

import { formatNumber, formatPercent, formatCurrencyCompact } from '../../utils/format';
const fmtPct = (n: number) => formatNumber(n, 2);

type AnalysisTab = 'rfm' | 'behavioral' | 'predictive';

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

interface SegmentTopProductsTableProps {
  segments: RFMSegment[];
  selectedId: string | null;
  onSelect: (segment: RFMSegment) => void;
  ecommerceMode: boolean;
  isCatalogEnriching: boolean;
}

/**
 * Συγκεντρωτικός πίνακας top προϊόντων ανά segment — ορατός χωρίς να επιλέξει ο χρήστης segment.
 * Προτεραιότητα: sku_affinity (catalog match) → subcategory → category_affinity_catalog → category heuristic.
 */
function SegmentTopProductsTable({
  segments,
  selectedId,
  onSelect,
  ecommerceMode,
  isCatalogEnriching,
}: SegmentTopProductsTableProps) {
  if (segments.length === 0) return null;

  const pickTop = (segment: RFMSegment): { rows: CategoryAffinity[]; sourceLabel: string } => {
    const b = segment.behavioral;
    const sku = b?.sku_affinity ?? [];
    if (sku.length > 0) return { rows: sku.slice(0, 3), sourceLabel: 'SKU' };
    const sub = b?.subcategory_affinity ?? [];
    if (sub.length > 0) return { rows: sub.slice(0, 3), sourceLabel: 'Υποκατ.' };
    const catCat = b?.category_affinity_catalog ?? [];
    if (catCat.length > 0) return { rows: catCat.slice(0, 3), sourceLabel: 'Κατηγορία' };
    const cat = b?.category_affinity ?? [];
    return { rows: cat.slice(0, 3), sourceLabel: cat.length > 0 ? 'Κατηγορία' : '—' };
  };

  return (
    <Card padding="lg" className="border border-[#E8EAED] shadow-[0_4px_24px_rgba(15,23,42,0.06)]">
      <CardHeader
        title="Top προϊόντα ανά segment"
        subtitle="Τα 3 προϊόντα/κατηγορίες με τη μεγαλύτερη συμμετοχή στον τζίρο κάθε segment. Πάτησε γραμμή για πλήρες drill-down."
      />
      {ecommerceMode && isCatalogEnriching && (
        <p className="-mt-2 mb-3 text-xs text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-lg px-3 py-2">
          Φόρτωση catalog… τα SKU εμφανίζονται όταν ολοκληρωθεί το alignment (μέχρι τότε δείχνουμε κατηγορίες).
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
              <th className="px-3 py-2.5">Segment</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">Πελάτες</th>
              <th className="px-3 py-2.5 text-right whitespace-nowrap">% τζίρου</th>
              <th className="px-3 py-2.5">#1 (πηγή)</th>
              <th className="px-3 py-2.5">#2</th>
              <th className="px-3 py-2.5">#3</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => {
              const { rows, sourceLabel } = pickTop(segment);
              const sel = selectedId === segment.id;
              const cell = (row: CategoryAffinity | undefined) => {
                if (!row) return <span className="text-[#9CA3AF]">—</span>;
                const rev = row.revenue_eur;
                const pct = row.revenue_share_pct;
                const tooltip = [
                  row.name,
                  rev != null && rev > 0 ? formatCurrencyCompact(rev) : null,
                  pct != null && pct > 0 ? `${formatNumber(pct, 1)}%` : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <span title={tooltip} className="block min-w-0 truncate">
                    <span className="text-[#374151]">{row.name}</span>
                    {pct != null && pct > 0 && (
                      <span className="ml-1 font-mono text-[11px] text-[#9CA3AF]">{formatNumber(pct, 1)}%</span>
                    )}
                  </span>
                );
              };
              return (
                <tr
                  key={segment.id}
                  className={`cursor-pointer border-b border-[#F3F4F6] transition-colors last:border-b-0 ${
                    sel ? 'bg-[#EFF6FF]' : 'hover:bg-[#FAFAFA]'
                  }`}
                  onClick={() => onSelect(segment)}
                >
                  <td className="px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: segment.color }} />
                      <span className="min-w-0 font-medium text-[#111827] truncate">{segment.name}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[#374151]">
                    {formatNumber(segment.count ?? 0)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums font-semibold text-[#374151]">
                    {fmtPct(segment.revenue_share ?? 0)}%
                  </td>
                  <td className="max-w-[14rem] px-3 py-2.5 text-[#374151]">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="shrink-0 rounded bg-[#F3F4F6] px-1.5 py-0.5 text-[10px] font-medium text-[#6B7280]">
                        {sourceLabel}
                      </span>
                      {cell(rows[0])}
                    </span>
                  </td>
                  <td className="max-w-[14rem] px-3 py-2.5 text-[#374151]">{cell(rows[1])}</td>
                  <td className="max-w-[14rem] px-3 py-2.5 text-[#374151]">{cell(rows[2])}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

interface RFMAnalysisProps {
  onSectionChange?: (section: string) => void;
}

export function RFMAnalysis({ onSectionChange }: RFMAnalysisProps = {}) {
  const [selectedSegment, setSelectedSegment] = useState<RFMSegment | null>(null);
  const [activeTab, setActiveTab] = useState<AnalysisTab>('rfm');
  const {
    segments: rfmSegments,
    totalCustomers,
    isLoading: segmentsLoading,
    ordersLoading,
    ordersError,
    hasImported: hasImportedSegments,
    dataSource: rfmDataSource,
    setDataSourcePreference,
    sourcePreference: rfmSourcePref,
    canComputeFromOrders,
    dataCoverage,
    orderRfmMeta,
    segmentMigration,
    importSegmentsAvailable,
    isCatalogEnriching,
  } = useSegments();
  const ecomm = useEcommerceSummary();
  const { currentBrand } = useBrand();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { activeStrategy } = useActiveStrategy();
  const channelRecommendation = activeStrategy?.channelRecommendation ?? null;
  const totalCustomersDisplay = Math.max(totalCustomers, dataCoverage.totalCustomers);
  const segmentColorById = new Map(rfmSegments.map((segment) => [segment.id, segment.color]));

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

  const handleDeleteSegments = async () => {
    if (rfmDataSource === 'ecommerce') return;
    if (!currentBrand?.id) return;
    if (!window.confirm(`Διαγραφή όλων των segments (${rfmSegments.length}) για το brand "${currentBrand.name}"; Αυτή η ενέργεια δεν αναιρείται.`)) return;
    setIsDeleting(true);
    try {
      await FirestoreService.deleteCollection('segments', currentBrand.id);
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
      <div className="flex items-center justify-center min-h-[50vh]">
        <Spinner size="lg" label="Φόρτωση data analysis segments…" />
      </div>
    );
  }

  if (!hasImportedSegments) {
    const hasEcomm = ecomm.connectedPlatforms.length > 0;
    const stillLoadingOrders = ordersLoading && !ordersError;
    return (
      <div className="space-y-6">
        <PageHeader
          title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Data Analysis</h2>}
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
              <p className="text-xs leading-relaxed text-[#4A4A4A] max-w-md">
                Σε μεγάλα brands ο αρχικός υπολογισμός RFM μπορεί να διαρκέσει 1–3 λεπτά. Μην κλείνετε τη σελίδα.
              </p>
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
                  ? 'Συνδέσατε e-shop, αλλά δεν βρέθηκαν αρκετές παραγγελίες με αναγνωρισμένο πελάτη (συνήθως guest checkout).'
                  : 'Δεν υπάρχουν ακόμα δεδομένα προς ανάλυση.'}
              </p>
              {hasEcomm && !canComputeFromOrders && (
                <p className="text-sm text-[#4A4A4A] mb-4 text-left">
                  Μετά το deploy, κάντε ξανά <strong>sync</strong> το connector ώστε να αποθηκεύεται το εσωτερικό <code className="text-xs bg-[#F3F4F6] px-1 rounded">customerId</code> ανά
                  παραγγελία (όχι email). Guest-only καλάθια εξακολουθούν να μην μετράνε σε RFM.
                </p>
              )}
              <p className="text-sm text-[#4A4A4A]">
                Εναλλακτικά, ανεβάστε aggregate segments από την{' '}
                <button
                  type="button"
                  onClick={() => onSectionChange?.('data-segments')}
                  className="font-semibold text-[var(--nts-accent)] hover:underline focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:ring-offset-1 rounded"
                >
                  καρτέλα εισαγωγής segments
                </button>
                .
              </p>
            </div>
          )}
        </Card>
      </div>
    );
  }

  /** Μόνο e-shop RFM, χωρίς «άλλους» πελάτες — το μεγάλο μπλοκ κάλυψης διπλασιάζει τα ίδια νούμερα. */
  const compactCoverageOk =
    rfmDataSource === 'ecommerce' &&
    rfmSourcePref === 'orders' &&
    dataCoverage.otherCustomers <= 0 &&
    dataCoverage.eShopPenetration >= 99;

  return (
    <div className="space-y-3">
      <PageHeader
        className="gap-2 lg:gap-4 [&_.space-y-1]:space-y-0"
        toolbarAriaLabel="Εξαγωγή και διαγραφή segments"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl leading-tight">Data Analysis</h2>}
        actions={
          <>
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

      {/* Μία συμπαγής γραμμή: πηγή + μεγέθη — χωρίς επανάληψη με κάλυψη όταν είναι καθαρό e-shop */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[#E8EAED] bg-[#FAFBFC] px-3 py-2 text-[12px] text-[#374151]">
        {importSegmentsAvailable && canComputeFromOrders ? (
          <label className="flex items-center gap-2 shrink-0">
            <span className="text-[#6B7280] whitespace-nowrap">Πηγή</span>
            <select
              className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[12px] text-[#1A1A1A] max-w-[11rem]"
              value={rfmSourcePref}
              onChange={(e) => setDataSourcePreference(e.target.value as 'orders' | 'external')}
              aria-label="Πηγή RFM segments"
            >
              <option value="orders">e-shop orders</option>
              <option value="external">e-shop &amp; others</option>
            </select>
          </label>
        ) : null}
        {importSegmentsAvailable && canComputeFromOrders ? (
          <span className="hidden sm:inline h-4 w-px shrink-0 bg-[#E5E7EB]" aria-hidden />
        ) : null}
        {hasImportedSegments ? (
          <span className="font-semibold tabular-nums text-[#111827]">
            {rfmSegments.length} segments · {formatNumber(totalCustomersDisplay)} πελάτες
          </span>
        ) : null}
        {rfmDataSource === 'ecommerce' ? (
          <span className="text-[#6B7280]">Raw παραγγελίες 12μήνου · quintiles</span>
        ) : (
          <span className="text-[#6B7280]">Εισαγωγή / ERP εκτός e-shop</span>
        )}
        {rfmDataSource === 'ecommerce' && orderRfmMeta && orderRfmMeta.guestOrdersSkipped > 0 ? (
          <span className="text-[11px] font-medium text-[#B45309]" title="Δεν συμπεριλαμβάνονται στο RFM">
            · guest χωρίς id: {formatNumber(orderRfmMeta.guestOrdersSkipped)}
          </span>
        ) : null}
        {isCatalogEnriching ? (
          <span className="text-[11px] text-amber-800">· catalog προϊόντων…</span>
        ) : null}
        <details className="sm:ml-auto min-w-0 max-w-full sm:max-w-[22rem] text-[11px]">
          <summary className="cursor-pointer font-semibold text-[var(--nts-accent)] hover:underline">
            Σημειώσεις υπολογισμού
          </summary>
          <div className="mt-2 space-y-2 rounded-md border border-[#E5E7EB] bg-white p-2.5 text-[#4A4A4A] leading-snug">
            <p>
              Οι καρτέλες <strong>RFM</strong>, <strong>Behavioral</strong>, <strong>Predictive</strong> μοιράζονται τα ίδια segments· αλλάζει μόνο η οπτικοποίηση (κατανομή / προφίλ / LTV).
            </p>
            {rfmDataSource === 'ecommerce' && (
              <p className="text-[11px]">
                Από αναγνωρίσιμο e-shop customer στο τελευταίο 12μηνο — email-only guest orders μένουν εκτός RFM.
              </p>
            )}
            {isCatalogEnriching && (
              <p className="text-[11px] text-amber-900 bg-amber-50 px-2 py-1 rounded border border-amber-100">
                Φόρτωση catalog για brands/SKU· τα charts στο segment detail ενημερώνονται όταν ολοκληρωθεί.
              </p>
            )}
            {compactCoverageOk && (
              <p className="text-[11px] text-[#6B7280]">{dataCoverage.marketingPolicy}</p>
            )}
          </div>
        </details>
      </div>

      {!compactCoverageOk ? (
        <DataCoverageBlock dataCoverage={dataCoverage} totalDisplayed={totalCustomersDisplay} />
      ) : null}

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
                  data={rfmSegments}
                  cx="50%"
                  cy="50%"
                  innerRadius={68}
                  outerRadius={108}
                  paddingAngle={2}
                  dataKey="percentage"
                  nameKey="name"
                  animationBegin={0}
                  animationDuration={700}
                >
                  {rfmSegments.map((segment) => (
                    <Cell
                      key={segment.id}
                      fill={segment.color}
                      stroke={selectedSegment?.id === segment.id ? '#1A1A1A' : 'none'}
                      strokeWidth={2}
                      className="transition-opacity"
                      opacity={selectedSegment ? (selectedSegment.id === segment.id ? 1 : 0.38) : 1}
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
                onClick={() =>
                  setSelectedSegment(selectedSegment?.id === segment.id ? null : segment)
                }
                className={`flex min-w-0 items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
                  selectedSegment?.id === segment.id ? 'bg-[#F3F4F6] ring-1 ring-[#E5E7EB]' : 'hover:bg-[#F9FAFB]'
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
                  data={rfmSegments}
                  cx="50%"
                  cy="50%"
                  innerRadius={68}
                  outerRadius={108}
                  paddingAngle={2}
                  dataKey="revenue_share"
                  nameKey="name"
                  animationBegin={0}
                  animationDuration={700}
                >
                  {rfmSegments.map((segment) => (
                    <Cell
                      key={segment.id}
                      fill={segment.color}
                      stroke={selectedSegment?.id === segment.id ? '#1A1A1A' : 'none'}
                      strokeWidth={2}
                      className="transition-opacity"
                      opacity={selectedSegment ? (selectedSegment.id === segment.id ? 1 : 0.38) : 1}
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
                onClick={() =>
                  setSelectedSegment(selectedSegment?.id === segment.id ? null : segment)
                }
                className={`flex min-w-0 items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${
                  selectedSegment?.id === segment.id ? 'bg-[#F3F4F6] ring-1 ring-[#E5E7EB]' : 'hover:bg-[#F9FAFB]'
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

      <SegmentTopProductsTable
        segments={rfmSegments}
        selectedId={selectedSegment?.id ?? null}
        onSelect={(segment) =>
          setSelectedSegment(selectedSegment?.id === segment.id ? null : segment)
        }
        ecommerceMode={rfmDataSource === 'ecommerce'}
        isCatalogEnriching={isCatalogEnriching}
      />

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
                onSelect={() =>
                  setSelectedSegment(selectedSegment?.id === segment.id ? null : segment)
                }
                onExport={(fmt) => handleExportSegment(segment, fmt)}
              />
            ))}
          </div>
        </div>
      </details>

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
              hasImportedSegments={hasImportedSegments}
              catalogEnriching={isCatalogEnriching}
              segmentsDataSource={rfmDataSource}
              onClose={() => setSelectedSegment(null)}
              onExportCustomers={(fmt) => handleExportCustomerList(selectedSegment, fmt)}
              onExportActionPack={(fmt) => handleExportSegment(selectedSegment, fmt)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Migration Flow */}
      <Card padding="lg">
        <CardHeader
          title="Segment Migration"
          subtitle={hasImportedSegments ? `Τελευταίες ${segmentMigration?.periodDays ?? 30} ημέρες` : ''}
          icon={<ArrowRight size={20} className="text-[var(--nts-accent)]" />}
        />
        <div className="space-y-3">
          {hasImportedSegments && rfmSegments.length > 0 ? (
            segmentMigration?.canCompute && segmentMigration.flows.length > 0 ? (
              <>
                <p className="text-xs text-[#6B7280]">
                  Σύγκριση {formatNumber(segmentMigration.comparedCustomers)} αναγνωρίσιμων πελατών με e-shop ιστορικό πριν και μετά την περίοδο.
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
                Δεν υπάρχουν αρκετές μετακινήσεις μεταξύ segments τις τελευταίες {segmentMigration?.periodDays ?? 30} ημέρες. Το σύστημα χρειάζεται αναγνωρίσιμους πελάτες με ιστορικό και πριν την περίοδο.
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

function DataCoverageBlock({
  dataCoverage,
  totalDisplayed,
}: {
  dataCoverage: SegmentDataCoverage;
  totalDisplayed: number;
}) {
  const compact =
    dataCoverage.otherCustomers <= 0 && dataCoverage.eShopPenetration >= 99.5;

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[#E5E5E5] bg-gradient-to-r from-[#FAFAFA] via-white to-[#FAFAFA] px-3 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Κάλυψη δεδομένων</span>
        <span className="text-sm font-bold text-[#1A1A1A]">{formatNumber(totalDisplayed)} πελάτες</span>
        <span className="hidden text-[#D1D5DB] sm:inline">|</span>
        <span className="text-xs font-medium text-[#4A4A4A]">{dataCoverage.policyLabel}</span>
        <details className="w-full sm:ml-auto sm:w-auto">
          <summary className="cursor-pointer text-xs font-semibold text-[var(--nts-accent)] hover:underline">
            Λεπτομέρειες κάλυψης
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <CoverageMetric label="Σύνολο" value={formatNumber(dataCoverage.totalCustomers)} />
            <CoverageMetric label="E-shop" value={formatNumber(dataCoverage.eShopCustomers)} />
            <CoverageMetric label="Others" value={formatNumber(dataCoverage.otherCustomers)} />
            <CoverageMetric label="E-shop %" value={`${formatNumber(dataCoverage.eShopPenetration, 1)}%`} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[#6B7280]">{dataCoverage.marketingPolicy}</p>
        </details>
      </div>
    );
  }

  return (
    <Card padding="sm" className="overflow-hidden border border-[#E5E5E5] bg-[#FAFAFA]">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA3AF]">Data Coverage</p>
          <h3 className="mt-0.5 text-sm font-bold text-[#1A1A1A]">Πολιτική: {dataCoverage.policyLabel}</h3>
          <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[#4A4A4A]">{dataCoverage.marketingPolicy}</p>
        </div>
        <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2">
          <CoverageMetric label="Σύνολο" value={formatNumber(dataCoverage.totalCustomers)} />
          <CoverageMetric label="E-shop" value={formatNumber(dataCoverage.eShopCustomers)} />
          <CoverageMetric label="Others / ERP" value={formatNumber(dataCoverage.otherCustomers)} />
          <CoverageMetric label="E-shop %" value={`${formatNumber(dataCoverage.eShopPenetration, 1)}%`} />
        </div>
      </div>
    </Card>
  );
}

function CoverageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-[#E5E5E5] bg-white px-2.5 py-2 sm:px-3">
      <p className="truncate text-[10px] font-medium text-[#9CA3AF] sm:text-[11px]" title={label}>{label}</p>
      <p className="mt-0.5 truncate font-mono text-sm font-bold text-[#1A1A1A] sm:text-base" title={value}>{value}</p>
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
  hasImportedSegments: boolean;
  /** Κατάλογος ακόμα φορτώνει — tabs heuristic μέχρι να έρθουν τα *_products. */
  catalogEnriching?: boolean;
  /** Από πού προέρχονται τα segments — για e-shop δεν χρησιμοποιούμε demo matrix κατανάλωσης. */
  segmentsDataSource: SegmentsDataSource;
  onClose: () => void;
  onExportCustomers?: (fmt: 'xlsx' | 'csv') => void;
  onExportActionPack?: (fmt: 'xlsx' | 'csv') => void;
}

function truncateAffinityLabel(name: string, max = 40): string {
  const t = name.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function SegmentDetail({
  segment,
  hasImportedSegments,
  catalogEnriching,
  segmentsDataSource,
  onClose,
  onExportCustomers,
  onExportActionPack,
}: SegmentDetailProps) {
  type CatalogDim = 'brand' | 'category' | 'subcategory' | 'sku';
  const [catalogDim, setCatalogDim] = useState<CatalogDim>('category');

  const allowConsumptionDemo = segmentsDataSource !== 'ecommerce';

  const behavioral = segment.behavioral;
  const hasCatalogRollups = behavioral?.catalog_match != null;
  const heuristicCats = behavioral?.category_affinity ?? [];
  const catalogCats = behavioral?.category_affinity_catalog ?? [];
  const fromComputedOrders = heuristicCats.length > 0 || hasCatalogRollups;

  const mockRow = allowConsumptionDemo && hasImportedSegments ? segmentCategoryMatrix[segment.id] : undefined;
  const mockCategories = mockRow?.categories?.length ? mockRow.categories : [];

  const affinityForChart = (): CategoryAffinity[] => {
    if (!fromComputedOrders) return allowConsumptionDemo ? mockCategories : [];
    if (!hasCatalogRollups) return heuristicCats;
    switch (catalogDim) {
      case 'brand':
        return behavioral?.brand_affinity ?? [];
      case 'category':
        return catalogCats.length > 0 ? catalogCats : heuristicCats;
      case 'subcategory':
        return behavioral?.subcategory_affinity ?? [];
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
    };
  });

  const chartHeight = Math.min(420, Math.max(220, 48 + chartRows.length * 36));
  const cm = behavioral?.catalog_match;

  const mockBrands = allowConsumptionDemo && !fromComputedOrders && mockRow?.brands?.length ? mockRow.brands : [];
  const brandAff = behavioral?.brand_affinity ?? [];
  const subAff = behavioral?.subcategory_affinity ?? [];
  const priceSens =
    behavioral?.price_sensitivity ??
    (allowConsumptionDemo ? mockRow?.price_sensitivity : undefined) ??
    'medium';
  const channelPills =
    behavioral?.preferred_channels?.length
      ? behavioral.preferred_channels
      : allowConsumptionDemo && mockRow?.preferred_channels?.length
        ? mockRow.preferred_channels
        : [];

  const dimLabel: Record<CatalogDim, string> = {
    brand: 'Μάρκες',
    category: 'Κατηγορίες',
    subcategory: 'Υποκατηγορίες',
    sku: 'SKU',
  };

  const leftChartTitle = hasCatalogRollups
    ? `Mix κατανάλωσης · ${dimLabel[catalogDim]}`
    : 'Προτιμώμενα categories / mix κατανάλωσης';

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
          </div>
        </div>
        <Button variant="ghost" onClick={onClose}>Κλείσιμο</Button>
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
            <div className="w-full min-h-[220px]" style={{ height: chartHeight }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} layout="vertical" margin={{ left: 6, right: 14, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F0F0F0" />
                  <XAxis
                    type="number"
                    domain={[0, 'dataMax']}
                    tick={{ fontSize: 11, fill: '#4A4A4A' }}
                    tickFormatter={(v) => `${formatNumber(Number(v), Number(v) >= 10 ? 0 : 1)}%`}
                  />
                  <YAxis type="category" dataKey="label" width={120} tick={{ fontSize: 11 }} interval={0} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #E5E5E5',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                    formatter={(value: unknown, _n: unknown, item: { payload?: { fullLabel?: string; revenue?: number } }) => {
                      const v = Number(value) || 0;
                      const r = item?.payload?.revenue;
                      const extra = r != null && r > 0 ? ` · ${formatCurrencyCompact(r)}` : '';
                      return [`${formatNumber(v, 1)}%${extra}`, item?.payload?.fullLabel ?? 'Γραμμή'];
                    }}
                  />
                  <Bar dataKey="pct" fill={segment.color} radius={[0, 4, 4, 0]} barSize={22} />
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
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Προτιμώμενα brands</h5>
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
                Δεν εντοπίστηκε εμπορική μάρκα στο catalog για τις γραμμές του segment (ή όλα ως «Λοιπά»).
              </p>
            ) : mockBrands.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {mockBrands.map((brand) => (
                  <Badge key={brand} variant="default">{brand}</Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#4A4A4A]">Δεν υπάρχουν δεδομένα</p>
            )}
          </div>

          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Υποκατηγορίες</h5>
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
            <Badge
              variant={
                priceSens === 'low' ? 'success' :
                priceSens === 'medium' ? 'warning' : 'danger'
              }
              size="md"
            >
              {priceSens.toUpperCase()}
            </Badge>
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
              Εξαγωγή ID πελατών (.csv)
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
