import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  Calendar,
  FileText,
  Mail,
  Clock,
  ChevronRight,
  Plus,
  X,
  Trash2,
  BarChart3,
  Users,
  Package,
  Megaphone,
  Target,
  Tag,
} from 'lucide-react';
import { Card, CardHeader, Badge, Button, Spinner, PageHeader, ModalHeader } from '../common';
import { useProductSource } from '../../hooks/useProductSource';
import { useSegments } from '../../hooks/useSegments';
import { useCampaigns } from '../../hooks/useCampaigns';
import { useOrganic } from '../../hooks/useOrganic';
import { useBrand } from '../../hooks/useBrand';
import { useEcommerceSummary } from '../../hooks/useEcommerceSummary';
import { formatCurrencyCompact, formatNumber } from '../../utils/format';
import { useToast } from '../common/Toast';
import {
  exportReport,
  isPdfSupported,
  getScheduledReports,
  saveScheduledReport,
  deleteScheduledReport,
  type ScheduledReport,
  type ReportFormat,
} from '../../services/reportExport';

interface ReportTypeItem {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  format: string;
  lastGenerated: string;
}

const reportTypes: ReportTypeItem[] = [
  {
    id: 'executive',
    name: 'Executive Summary',
    description: 'High-level KPIs και ROI overview για board presentations',
    icon: <BarChart3 size={20} />,
    format: 'PDF',
    lastGenerated: 'πριν 2 ώρες'
  },
  {
    id: 'segment',
    name: 'Segment Performance',
    description: 'Λεπτομερής ανάλυση segments με RFM, behavioral και firmographic οπτικές',
    icon: <Users size={20} />,
    format: 'PDF/Excel',
    lastGenerated: 'πριν 1 ημέρα'
  },
  {
    id: 'inventory',
    name: 'Inventory Health',
    description: 'Επίπεδα αποθεμάτων, ανάλυση ηλικίας, και ευκαιρίες βελτιστοποίησης',
    icon: <Package size={20} />,
    format: 'Excel',
    lastGenerated: 'πριν 3 ώρες'
  },
  {
    id: 'channel',
    name: 'Απόδοση ανά κανάλι',
    description: 'Ανάλυση ROAS ανά κανάλι και κατανομή budget',
    icon: <Megaphone size={20} />,
    format: 'PDF/Excel',
    lastGenerated: 'πριν 6 ώρες'
  },
  {
    id: 'campaign',
    name: 'Campaign Performance',
    description: 'Λεπτομερή αποτελέσματα για όλα τα marketing campaigns',
    icon: <Target size={20} />,
    format: 'Excel',
    lastGenerated: 'πριν 12 ώρες'
  },
  {
    id: 'product',
    name: 'Product Prioritization',
    description: 'Current scoring and ranking based on strategy weights',
    icon: <Tag size={20} />,
    format: 'Excel/CSV',
    lastGenerated: 'πριν 1 ώρα'
  }
];

const DEFAULT_SCHEDULES: ScheduledReport[] = [
  { id: 'sched_demo_1', name: 'Weekly Executive Summary', frequency: 'Every Monday 9:00 AM', recipients: ['ceo@company.com', 'cmo@company.com'], reportType: 'executive', status: 'active', createdAt: '' },
  { id: 'sched_demo_2', name: 'Daily Inventory Alert', frequency: 'Daily 8:00 AM', recipients: ['operations@company.com'], reportType: 'inventory', status: 'active', createdAt: '' },
  { id: 'sched_demo_3', name: 'Monthly Performance Review', frequency: 'First Monday of month', recipients: ['team@company.com'], reportType: 'executive', status: 'active', createdAt: '' },
];

export function Reports() {
  const toast = useToast();
  const { currentBrand } = useBrand();
  const { products, count: productsCount } = useProductSource();
  const { segments } = useSegments();
  const segmentsCount = segments.length;
  const { campaigns } = useCampaigns();
  const { records: organicRecords, totalOrganicRevenue, hasOrganicRevenue: hasOrganic } = useOrganic();
  const ecomm = useEcommerceSummary();
  const campaignsTyped = (campaigns ?? []) as import('../../types').Campaign[];

  const [scheduledReports, setScheduledReports] = useState<ScheduledReport[]>(() => {
    const stored = getScheduledReports();
    return stored.length > 0 ? stored : DEFAULT_SCHEDULES;
  });
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleInitialReportType, setScheduleInitialReportType] = useState('executive');
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(null);

  useEffect(() => {
    const stored = getScheduledReports();
    if (stored.length > 0) setScheduledReports(stored);
  }, []);

  const handleGenerate = async (reportId: string, format: ReportFormat = 'excel') => {
    setGeneratingId(reportId);
    try {
      await exportReport(reportId, format, {
        products,
        segments,
        campaigns: campaignsTyped,
        organicRecords,
        totalOrganicRevenue,
        brandName: currentBrand?.name,
      });
      toast.success(`Το report κατέβηκε επιτυχώς (${format.toUpperCase()})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Σφάλμα εξαγωγής');
    } finally {
      setGeneratingId(null);
    }
  };

  const handleSaveSchedule = (name: string, frequency: string, recipients: string[], reportType: string) => {
    saveScheduledReport({ name, frequency, recipients, reportType, status: 'active' });
    setScheduledReports(getScheduledReports());
    setShowScheduleModal(false);
    toast.success('Προγραμματισμός αποθηκεύτηκε');
  };

  const handleDeleteSchedule = (id: string) => {
    deleteScheduledReport(id);
    setScheduledReports(getScheduledReports());
    setExpandedScheduleId(null);
    toast.success('Διαγράφηκε');
  };

  const hasFinancialData = hasOrganic || (campaignsTyped.length > 0) || ecomm.hasData;
  const reportDataCounts: Record<string, number | string> = {
    executive: hasFinancialData ? '✓' : 0,
    segment: segmentsCount,
    inventory: productsCount,
    channel: hasFinancialData ? '✓' : 0,
    campaign: campaigns.length,
    product: productsCount
  };

  return (
    <div className="space-y-6">
      <PageHeader
        toolbarAriaLabel="Αναφορές"
        title={<h2 className="text-xl font-bold text-[#1A1A1A] sm:text-2xl">Reports & Analytics</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
            Generate, schedule, and export performance reports
          </p>
        }
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => setShowCustomModal(true)}
            className="min-h-[36px] w-full sm:w-auto"
          >
            <span className="hidden sm:inline">Προσαρμοσμένη αναφορά</span>
            <span className="sm:hidden">Custom</span>
          </Button>
        }
      />

      {/* Report Types */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportTypes.map((report, index) => (
          <motion.div
            key={report.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <Card padding="md" hover>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-[var(--nts-light-gray)] rounded-xl border border-[var(--nts-border-gray)] flex items-center justify-center text-[var(--nts-medium-gray)]">
                  {report.icon}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-[#1A1A1A]">{report.name}</h3>
                  <p className="text-sm text-[#4A4A4A] mt-1">{report.description}</p>
                  
                  <div className="flex items-center gap-3 mt-3">
                    <Badge variant="default" size="sm">{report.format}</Badge>
                    {reportDataCounts[report.id] !== undefined && (
                      <span className="text-xs text-[#4A4A4A]">
                        Data: {typeof reportDataCounts[report.id] === 'number'
                          ? reportDataCounts[report.id].toLocaleString()
                          : reportDataCounts[report.id]}
                      </span>
                    )}
                    <span className="text-xs text-[#9CA3AF]">
                      Last: {report.lastGenerated}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 mt-4">
                    {isPdfSupported(report.id) && (
                      <Button
                        variant="primary"
                        size="sm"
                        icon={generatingId === report.id ? <Spinner size="sm" /> : <Download size={14} />}
                        disabled={generatingId !== null}
                        onClick={() => handleGenerate(report.id, 'pdf')}
                      >
                        PDF
                      </Button>
                    )}
                    <Button
                      variant={isPdfSupported(report.id) ? 'secondary' : 'primary'}
                      size="sm"
                      icon={generatingId === report.id ? <Spinner size="sm" /> : <Download size={14} />}
                      disabled={generatingId !== null}
                      onClick={() => handleGenerate(report.id, 'excel')}
                    >
                      Excel
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Calendar size={14} />}
                      onClick={() => {
                        setScheduleInitialReportType(report.id);
                        setShowScheduleModal(true);
                      }}
                    >
                      Schedule
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Scheduled Reports */}
      <Card padding="lg">
        <CardHeader
          title="Scheduled Reports"
          subtitle="Αυτοματοποιημένη παράδοση reports"
          icon={<Clock size={20} className="text-[var(--nts-accent)]" />}
          action={
            <Button
              variant="secondary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => {
                setScheduleInitialReportType('executive');
                setShowScheduleModal(true);
              }}
            >
              New Schedule
            </Button>
          }
        />
        <div className="space-y-4">
          {scheduledReports.map((report, index) => (
            <motion.div
              key={report.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              className="p-4 bg-[#F5F5F5] rounded-xl"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                    <FileText size={20} className="text-[var(--nts-accent)]" />
                  </div>
                  <div>
                    <h4 className="font-medium text-[#1A1A1A]">{report.name}</h4>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="text-xs text-[#4A4A4A] flex items-center gap-1">
                        <Clock size={12} />
                        {report.frequency}
                      </span>
                      <span className="text-xs text-[#4A4A4A] flex items-center gap-1">
                        <Mail size={12} />
                        {report.recipients?.length ?? 0} recipients
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="success" size="sm">{report.status === 'active' ? 'Ενεργό' : 'Σε παύση'}</Badge>
                  <button
                    className="p-2 hover:bg-white rounded-lg transition-colors"
                    onClick={() => setExpandedScheduleId(expandedScheduleId === report.id ? null : report.id)}
                  >
                    <ChevronRight size={16} className={`text-[#4A4A4A] transition-transform ${expandedScheduleId === report.id ? 'rotate-90' : ''}`} />
                  </button>
                </div>
              </div>
              <AnimatePresence>
                {expandedScheduleId === report.id && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-4 pt-4 border-t border-[#E5E5E5] flex items-center gap-2"
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Download size={14} />}
                      onClick={() => handleGenerate(report.reportType, isPdfSupported(report.reportType) ? 'pdf' : 'excel')}
                    >
                      Generate τώρα
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => handleDeleteSchedule(report.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      Διαγραφή
                    </Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#1A1A1A] font-mono">{productsCount}</p>
            <p className="text-sm text-[#4A4A4A] mt-1">Products</p>
            <p className="text-xs text-[#22C55E]">In catalog</p>
          </div>
        </Card>
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#1A1A1A] font-mono">{segmentsCount}</p>
            <p className="text-sm text-[#4A4A4A] mt-1">Segments</p>
            <p className="text-xs text-[#4A4A4A]">RFM</p>
          </div>
        </Card>
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#1A1A1A] font-mono">{campaignsTyped.length}</p>
            <p className="text-sm text-[#4A4A4A] mt-1">Campaigns</p>
            <p className="text-xs text-[#8B5CF6]">Ενεργό</p>
          </div>
        </Card>
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#1A1A1A] font-mono">{hasOrganic ? '✓' : '—'}</p>
            <p className="text-sm text-[#4A4A4A] mt-1">Οργανικά Έσοδα</p>
            <p className="text-xs text-[#22C55E]">{hasOrganic ? 'Εισαγόμενα' : 'Χωρίς δεδομένα'}</p>
          </div>
        </Card>
        <Card padding="md">
          <div className="text-center">
            <p className="text-3xl font-bold text-[#1A1A1A] font-mono">{ecomm.hasData ? formatNumber(ecomm.orderCount) : '—'}</p>
            <p className="text-sm text-[#4A4A4A] mt-1">E-shop Orders</p>
            <p className="text-xs text-[#4A4A4A]">{ecomm.hasData ? formatCurrencyCompact(ecomm.totalRevenue) : 'Χωρίς δεδομένα'}</p>
          </div>
        </Card>
      </div>

      {/* Schedule Modal */}
      <AnimatePresence>
        {showScheduleModal && (
          <ScheduleModal
            reportTypes={reportTypes}
            initialReportType={scheduleInitialReportType}
            onClose={() => setShowScheduleModal(false)}
            onSave={handleSaveSchedule}
          />
        )}
      </AnimatePresence>

      {/* Custom Report Modal */}
      <AnimatePresence>
        {showCustomModal && (
          <CustomReportModal
            reportTypes={reportTypes}
            onClose={() => setShowCustomModal(false)}
            onGenerate={(id, format) => { handleGenerate(id, format); setShowCustomModal(false); }}
            generating={generatingId !== null}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function ScheduleModal({
  reportTypes,
  initialReportType,
  onClose,
  onSave,
}: {
  reportTypes: ReportTypeItem[];
  initialReportType: string;
  onClose: () => void;
  onSave: (name: string, frequency: string, recipients: string[], reportType: string) => void;
}) {
  const [name, setName] = useState('');
  const [frequency, setFrequency] = useState('Every Monday 9:00 AM');
  const [recipientsStr, setRecipientsStr] = useState('');
  const [reportType, setReportType] = useState(() => initialReportType);

  useEffect(() => {
    setReportType(initialReportType);
  }, [initialReportType]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const recipients = recipientsStr.split(/[,;\s]+/).map((r) => r.trim()).filter(Boolean);
    if (!name.trim()) return;
    onSave(name.trim(), frequency, recipients, reportType);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          toolbarAriaLabel="Κλείσιμο"
          title={<h3 className="text-lg font-bold text-[#1A1A1A]">Νέος Προγραμματισμός Report</h3>}
          actions={
            <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-[#F5F5F5]">
              <X size={20} className="text-[#4A4A4A]" />
            </button>
          }
        />
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#4A4A4A] mb-1">Όνομα</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="π.χ. Weekly Executive Summary"
              className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)]"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#4A4A4A] mb-1">Τύπος Report</label>
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)]"
            >
              {reportTypes.map((r: ReportTypeItem) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#4A4A4A] mb-1">Συχνότητα</label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value)}
              className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)]"
            >
              <option value="Daily 8:00 AM">Καθημερινά 8:00</option>
              <option value="Every Monday 9:00 AM">Καθε Δευτέρα 9:00</option>
              <option value="First Monday of month">Πρώτη Δευτέρα του μήνα</option>
              <option value="Every Friday 17:00">Καθε Παρασκευή 17:00</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[#4A4A4A] mb-1">Email recipients (χωρισμένα με κόμμα)</label>
            <input
              value={recipientsStr}
              onChange={(e) => setRecipientsStr(e.target.value)}
              placeholder="email1@company.com, email2@company.com"
              className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)]"
            />
          </div>
          <div className="flex gap-3 pt-4">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1">Ακύρωση</Button>
            <Button type="submit" variant="primary" className="flex-1">Αποθήκευση</Button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

function CustomReportModal({
  reportTypes,
  onClose,
  onGenerate,
  generating,
}: {
  reportTypes: ReportTypeItem[];
  onClose: () => void;
  onGenerate: (id: string, format: ReportFormat) => void;
  generating: boolean;
}) {
  const [selectedId, setSelectedId] = useState('executive');
  const [format, setFormat] = useState<ReportFormat>('pdf');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <ModalHeader
          toolbarAriaLabel="Κλείσιμο"
          title={<h3 className="text-lg font-bold text-[#1A1A1A]">Προσαρμοσμένη αναφορά</h3>}
          actions={
            <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-[#F5F5F5]">
              <X size={20} className="text-[#4A4A4A]" />
            </button>
          }
        />
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#4A4A4A] mb-2">Επιλέξτε τύπο report</label>
            <select
              value={selectedId}
              onChange={(e) => {
                setSelectedId(e.target.value);
                setFormat(isPdfSupported(e.target.value) ? 'pdf' : 'excel');
              }}
              className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)]"
            >
              {reportTypes.map((r: ReportTypeItem) => (
                <option key={r.id} value={r.id}>{r.name} ({r.format})</option>
              ))}
            </select>
          </div>
          {isPdfSupported(selectedId) && (
            <div>
              <label className="block text-sm font-medium text-[#4A4A4A] mb-2">Μορφή</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as ReportFormat)}
                className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)]"
              >
                <option value="pdf">PDF</option>
                <option value="excel">Excel</option>
              </select>
            </div>
          )}
          <div className="flex gap-3 pt-4">
            <Button variant="ghost" onClick={onClose} className="flex-1">Ακύρωση</Button>
            <Button
              variant="primary"
              icon={generating ? <Spinner size="sm" /> : <Download size={14} />}
              disabled={generating}
              onClick={() => onGenerate(selectedId, format)}
              className="flex-1"
            >
              Generate {format.toUpperCase()}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
