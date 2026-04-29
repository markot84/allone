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
import { useSegments } from '../../hooks/useSegments';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { useBrand } from '../../hooks/useBrand';
import { FirestoreService } from '../../services/firestore';
import { segmentCategoryMatrix } from '../../data';
import { BehavioralTab } from './BehavioralTab';
import { PredictiveTab } from './PredictiveTab';
import { exportSegmentActionPack, exportAllSegmentActionPacks, exportSegmentCustomerList, exportAllSegmentCustomerLists } from '../../services/segmentActionPack';
import { useActiveStrategy } from '../../hooks/useActiveStrategy';
import type { RFMSegment } from '../../types';

import { formatNumber, formatPercent } from '../../utils/format';
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
    hasImported: hasImportedSegments,
    dataSource: rfmDataSource,
    setDataSourcePreference,
    sourcePreference: rfmSourcePref,
    canComputeFromOrders,
    dataCoverage,
    orderRfmMeta,
    segmentMigration,
    importSegmentsAvailable,
  } = useSegments();
  const ecomm = useEcommerceSummary();
  const { currentBrand } = useBrand();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { activeStrategy } = useActiveStrategy();
  const channelRecommendation = activeStrategy?.channelRecommendation ?? null;
  const totalCustomersDisplay = totalCustomers;
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
        <Card padding="lg" className="text-center py-12 max-w-2xl mx-auto">
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
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {rfmDataSource === 'ecommerce' && orderRfmMeta && (
        <div className="rounded-lg border border-[#A7F3D0] bg-[#ECFDF5] px-4 py-3 text-sm text-[#065F46]">
          RFM, Behavioral και Predictive LTV βασίζονται σε <strong>υπολογισμό από raw παραγγελίες</strong> (εσωτερικό customerId).
          {orderRfmMeta.guestOrdersSkipped > 0 && (
            <span className="block mt-1 text-[#047857]">
              {orderRfmMeta.guestOrdersSkipped} guest / χωρίς id παραγγελίες εξαιρέθηκαν του RFM.
            </span>
          )}
        </div>
      )}

      {importSegmentsAvailable && canComputeFromOrders && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <span className="text-sm text-[#4A4A4A]">Πηγή δεδομένων</span>
          <select
            className="text-sm border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white text-[#1A1A1A] max-w-md"
            value={rfmSourcePref}
            onChange={(e) => setDataSourcePreference(e.target.value as 'orders' | 'external')}
            aria-label="Πηγή RFM segments"
          >
            <option value="orders">e-shop orders</option>
            <option value="external">e-shop &amp; others</option>
          </select>
        </div>
      )}

      <PageHeader
        toolbarAriaLabel="Εξαγωγή και διαγραφή segments"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Data Analysis</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base leading-snug">
            RFM, behavioral, predictive — από e-shop orders ή ERP/other data
            {rfmDataSource === 'ecommerce' && (
              <span className="block text-xs text-[#22C55E] mt-1">Πρόοδος: e-commerce (quintiles σε πελάτες)</span>
            )}
            {rfmDataSource === 'import' && (
              <span className="block text-xs text-[#4A4A4A] mt-1">Πρόοδος: e-shop &amp; others</span>
            )}
          </p>
        }
        meta={
          hasImportedSegments ? (
            <p className="text-xs font-medium text-[#22C55E] sm:text-sm">
              {rfmSegments.length} τμήματα · {formatNumber(totalCustomersDisplay)} πελάτες
            </p>
          ) : null
        }
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

      <Card padding="md" className="overflow-hidden border border-[#E5E5E5] bg-[#FAFAFA]">
        <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#9CA3AF]">Data Coverage</p>
            <h3 className="mt-1 text-sm font-bold text-[#1A1A1A]">
              Πολιτική: {dataCoverage.policyLabel}
            </h3>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#4A4A4A]">
              {dataCoverage.marketingPolicy}
            </p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3 xl:max-w-full">
            <CoverageMetric label="Σύνολο" value={formatNumber(dataCoverage.totalCustomers)} />
            <CoverageMetric label="E-shop" value={formatNumber(dataCoverage.eShopCustomers)} />
            <CoverageMetric label="Others / ERP" value={formatNumber(dataCoverage.otherCustomers)} />
            <CoverageMetric label="E-shop %" value={`${formatNumber(dataCoverage.eShopPenetration, 1)}%`} />
          </div>
        </div>
      </Card>

      {/* Analysis Tabs */}
      <div className="-mx-1 max-w-full overflow-x-auto pb-1 sm:mx-0 sm:overflow-visible sm:pb-0">
      <div className="flex w-max items-center gap-1 rounded-xl bg-[var(--nts-light-gray)] p-1 sm:w-fit">
        <TabButton
          active={activeTab === 'rfm'}
          onClick={() => setActiveTab('rfm')}
          icon={<Users size={14} />}
          label="RFM Segments"
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
          tooltipBody="Συμπεριφορική ανάλυση πελατών — πέρα από το «πόσο» αγοράζουν, βλέπεις και το «πώς»."
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
          label="Predictive LTV"
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
      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[var(--nts-light-gray)] rounded-lg flex items-center justify-center">
              <Users size={20} className="text-[var(--nts-accent)]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]"><InfoTooltip content="Συνολικός αριθμός πελατών από τα imported RFM segments. Περιλαμβάνει ενεργούς και ανενεργούς.">Σύνολο Πελατών</InfoTooltip></p>
              <p className="text-xl font-bold text-[#1A1A1A] font-mono">
                {formatNumber(totalCustomersDisplay)}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#DCFCE7] rounded-lg flex items-center justify-center">
              <TrendingUp size={20} className="text-[#22C55E]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]"><InfoTooltip content="Συνολικός αριθμός RFM segments που εμφανίζονται στην ανάλυση. Περιλαμβάνει και ανενεργά / Lost segments.">Σύνολο Segments</InfoTooltip></p>
              <p className="text-xl font-bold text-[#1A1A1A]">
                {rfmSegments.length}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#F5F5F5] rounded-lg flex items-center justify-center">
              <Zap size={20} className="text-[#4A4A4A]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]"><InfoTooltip content="Μέσος όρος RFM score (1–5). Υψηλότερο = καλύτερη ποιότητα πελατολογίου. Κάτω από 3.0 σημαίνει ότι η πλειονότητα των πελατών είναι ανενεργή.">Μέσος Segment Score</InfoTooltip></p>
              <p className="text-xl font-bold text-[#1A1A1A] font-mono">
                {(() => {
                  if (rfmSegments.length === 0) return '0';
                  
                  const scores = rfmSegments
                    .map((s) => calculateAvgRFMScore(s.rfm_score, s.name))
                    .filter((score): score is number => score !== null && !isNaN(score) && isFinite(score));
                  
                  if (scores.length === 0) {
                    // Debug: log segments without valid scores
                    if (import.meta.env.MODE === 'development') {
                      console.debug('No valid RFM scores found. Segments:', rfmSegments.map(s => ({ 
                        name: s.name, 
                        rfm_score: s.rfm_score,
                        rfm_score_type: typeof s.rfm_score 
                      })));
                    }
                    return '0';
                  }
                  
                  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
                  return formatNumber(avg, 1);
                })()}
              </p>
            </div>
          </div>
        </Card>
        <Card padding="md" hover>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#FEF3C7] rounded-lg flex items-center justify-center">
              <TrendingDown size={20} className="text-[#F59E0B]" />
            </div>
            <div>
              <p className="text-sm text-[#4A4A4A]"><InfoTooltip content="Ποσοστό πελατών στο At Risk segment — πελάτες με μειωμένη δραστηριότητα που κινδυνεύουν να χαθούν. Πάνω από 20% απαιτεί άμεση δράση (win-back campaign).">Ποσοστό At Risk</InfoTooltip></p>
              <p className="text-xl font-bold text-[#F59E0B] font-mono">
                {fmtPct(rfmSegments.find(s => s.id === 'at_risk')?.percentage ?? 0)}%
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Segment Cards + Chart */}
      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Segment Cards */}
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 lg:col-span-2">
          {rfmSegments.map((segment, index) => (
            <SegmentCard
              key={segment.id}
              segment={segment}
              index={index}
              isSelected={selectedSegment?.id === segment.id}
              onSelect={() => setSelectedSegment(
                selectedSegment?.id === segment.id ? null : segment
              )}
              onExport={(fmt) => handleExportSegment(segment, fmt)}
            />
          ))}
        </div>

        {/* Distribution Chart */}
        <Card padding="lg" className="flex min-w-0 flex-col">
          <CardHeader
            title="Revenue Distribution"
            subtitle="Ανά segment"
          />
          <div className="min-w-0 w-full flex-shrink-0" style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height={240} minHeight={240}>
              <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                <Pie
                  data={rfmSegments}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="revenue_share"
                  nameKey="name"
                  animationBegin={0}
                  animationDuration={800}
                >
                  {rfmSegments.map((segment) => (
                    <Cell
                      key={segment.id}
                      fill={segment.color}
                      stroke={selectedSegment?.id === segment.id ? '#1A1A1A' : 'none'}
                      strokeWidth={2}
                      className="transition-opacity"
                      opacity={selectedSegment ? (selectedSegment.id === segment.id ? 1 : 0.4) : 1}
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
                  formatter={(value: number | undefined) => [`${fmtPct(value ?? 0)}%`, 'Revenue']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="space-y-1 mt-2">
            {rfmSegments.map((segment) => (
              <div
                key={segment.id}
                className={`
                  flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer transition-all
                  ${selectedSegment?.id === segment.id ? 'bg-[#F5F5F5] ring-1 ring-[#E5E5E5]' : 'hover:bg-[#F5F5F5]'}
                `}
                onClick={() => setSelectedSegment(
                  selectedSegment?.id === segment.id ? null : segment
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: segment.color }}
                  />
                  <span className="text-[13px] text-[#4A4A4A] truncate">{segment.name}</span>
                </div>
                <span className="text-[13px] font-semibold font-mono flex-shrink-0 ml-2" style={{ color: segment.color }}>
                  {fmtPct(segment.revenue_share ?? 0)}%
                </span>
              </div>
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
            <p className="text-xs text-[#4A4A4A]">% of Base</p>
            <p className="font-bold font-mono" style={{ color: segment.color }}>
              {fmtPct(segment.percentage ?? 0)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-[#4A4A4A]">Revenue</p>
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
  onClose: () => void;
  onExportCustomers?: (fmt: 'xlsx' | 'csv') => void;
  onExportActionPack?: (fmt: 'xlsx' | 'csv') => void;
}

const emptyCategoryData = { categories: [], brands: [], price_sensitivity: 'medium' as const, preferred_channels: [] };

function SegmentDetail({ segment, onClose, onExportCustomers, onExportActionPack }: SegmentDetailProps) {
  const { hasImported: hasImportedSegments } = useSegments();
  // Use empty data when no imported segments exist (no mock data)
  const categoryData = hasImportedSegments 
    ? (segmentCategoryMatrix[segment.id] ?? emptyCategoryData)
    : emptyCategoryData;

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
        {/* Category Affinity */}
        <div>
          <h4 className="font-medium text-[#1A1A1A] mb-4">Category Preferences</h4>
          {categoryData?.categories && categoryData.categories.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryData.categories}
                  layout="vertical"
                  margin={{ left: 100 }}
                >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E5E5" />
                <XAxis
                  type="number"
                  domain={[0, 1]}
                  tickFormatter={(v) => formatPercent((v as number) * 100, 0)}
                  tick={{ fill: '#4A4A4A', fontSize: 12 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: '#4A4A4A', fontSize: 12 }}
                  width={95}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #E5E5E5',
                    borderRadius: '8px'
                  }}
                  formatter={(value) => [formatPercent(((value as number) || 0) * 100, 0), 'Affinity']}
                />
                  <Bar dataKey="affinity" fill={segment.color} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center bg-[#F5F5F5] rounded-lg">
              <p className="text-sm text-[#4A4A4A]">Δεν υπάρχουν δεδομένα category preferences</p>
            </div>
          )}
        </div>

        {/* Segment Details */}
        <div className="space-y-4">
          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Preferred Brands</h5>
            <div className="flex flex-wrap gap-2">
              {categoryData?.brands && categoryData.brands.length > 0 ? (
                categoryData.brands.map((brand) => (
                  <Badge key={brand} variant="default">{brand}</Badge>
                ))
              ) : (
                <p className="text-xs text-[#4A4A4A]">Δεν υπάρχουν δεδομένα</p>
              )}
            </div>
          </div>

          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Price Sensitivity</h5>
            <Badge
              variant={
                categoryData?.price_sensitivity === 'low' ? 'success' :
                categoryData?.price_sensitivity === 'medium' ? 'warning' : 'danger'
              }
              size="md"
            >
              {categoryData?.price_sensitivity?.toUpperCase()}
            </Badge>
          </div>

          <div className="p-4 bg-[#F5F5F5] rounded-lg">
            <h5 className="text-sm font-medium text-[#1A1A1A] mb-2">Προτιμώμενα κανάλια</h5>
            <div className="flex flex-wrap gap-2">
              {categoryData?.preferred_channels && categoryData.preferred_channels.length > 0 ? (
                categoryData.preferred_channels.map((channel) => (
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
