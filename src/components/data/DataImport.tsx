import { useState, useRef, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useBrand } from '../../hooks/useBrand';
import { useRefreshProcurementSignals } from '../../hooks/useProcurementSignals';
import { FileText, CheckCircle2, XCircle, AlertCircle, Clock, Trash2, FileUp, Link as LinkIcon, HelpCircle, ExternalLink, Package, Users, BarChart3, Euro, ClipboardList } from 'lucide-react';
import { Card, Button, Spinner, ProgressBar, useToast, Badge, PageHeader } from '../common';
import { importFile, saveImportJob, getImportJobs, getLastImportDates, isSupportedFile, PRODUCT_COLUMN_MAPPING, type ImportType, type ImportResult, type ImportJob, type ImportProgress, type CampaignChannelOverride } from '../../services/import';
import { auth, buildFunctionUrl, getAppCheckHeader } from '../../config/firebase';
import { FEED_SOURCE_OPTIONS, downloadGoogleAdsCsvTemplate, type FeedSourceType } from '../../data/feedSourceConfig';
import { FeedPreviewModal } from './FeedPreviewModal';
import { FeedSourcesSection } from './FeedSourcesSection';
import { ApiKeyManager } from './ApiKeyManager';
import { ConnectorsPanel } from './ConnectorsPanel';
import { refreshProductIntelligenceOnServer } from '../../services/productIntelligenceAggregate';
import { motion, AnimatePresence } from 'framer-motion';
import { logger } from '../../utils/logger';

export type FileWithType = { file: File; type: ImportType; campaignChannel?: CampaignChannelOverride };

interface DataImportProps {
  initialType?: ImportType;
}

const PROCUREMENT_ENDPOINT = buildFunctionUrl('/importData');

const CURL_SNIPPET = `curl -X POST \\
  ${PROCUREMENT_ENDPOINT} \\
  -H "Authorization: Bearer {API_KEY}" \\
  -F "file=@PROCUREMENT_TEMPLATE.xlsx" \\
  -F "type=procurement"`;

const PYTHON_SNIPPET = `import requests

url = "${PROCUREMENT_ENDPOINT}"
headers = {"Authorization": "Bearer {API_KEY}"}
with open("PROCUREMENT_TEMPLATE.xlsx", "rb") as f:
    resp = requests.post(url, headers=headers, files={"file": f}, data={"type": "procurement"})
print(resp.json())`;

function ProcurementApiInfo() {
  const [activeTab, setActiveTab] = useState<'curl' | 'python'>('curl');
  const [copied, setCopied] = useState(false);

  const snippet = activeTab === 'curl' ? CURL_SNIPPET : PYTHON_SNIPPET;

  function handleCopy() {
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="mt-8 rounded-2xl border border-[var(--nts-border)] bg-[var(--nts-surface)] shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--nts-border)]">
        <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-[var(--nts-brand-light)]">
          <svg className="w-5 h-5 text-[var(--nts-brand)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--nts-text-primary)]">Αυτόματη Εισαγωγή Procurement</p>
          <p className="text-xs text-[var(--nts-text-muted)]">Στείλε το PROCUREMENT_TEMPLATE.xlsx από ERP/server μέσω HTTP POST</p>
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {/* Endpoint */}
        <div>
          <p className="text-xs font-medium text-[var(--nts-text-muted)] mb-1.5 uppercase tracking-wide">Endpoint</p>
          <div className="flex items-center gap-2 rounded-lg bg-[var(--nts-bg)] border border-[var(--nts-border)] px-3 py-2">
            <span className="text-xs font-mono text-[var(--nts-brand)] break-all">{PROCUREMENT_ENDPOINT}</span>
          </div>
        </div>

        {/* Code snippet tabs */}
        <div>
          <div className="flex gap-1 mb-2">
            {(['curl', 'python'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  activeTab === t
                    ? 'bg-[var(--nts-brand)] text-white'
                    : 'text-[var(--nts-text-muted)] hover:text-[var(--nts-text-primary)] hover:bg-[var(--nts-border)]'
                }`}
              >
                {t === 'curl' ? 'cURL' : 'Python'}
              </button>
            ))}
          </div>
          <div className="relative">
            <pre className="text-xs font-mono leading-relaxed text-[var(--nts-text-primary)] bg-[var(--nts-bg)] border border-[var(--nts-border)] rounded-lg p-4 overflow-x-auto whitespace-pre">
              {snippet}
            </pre>
            <button
              onClick={handleCopy}
              className="absolute top-2.5 right-2.5 px-2.5 py-1 text-xs font-medium rounded-md bg-[var(--nts-surface)] border border-[var(--nts-border)] text-[var(--nts-text-muted)] hover:text-[var(--nts-text-primary)] transition-colors"
            >
              {copied ? 'Αντιγράφηκε!' : 'Αντιγραφή'}
            </button>
          </div>
        </div>

        {/* Notes */}
        <ul className="text-xs text-[var(--nts-text-muted)] space-y-1 list-disc list-inside">
          <li>Απαιτείται <code className="font-mono text-[var(--nts-text-primary)]">Authorization: Bearer {'{'}{'{'}API_KEY{'}'}{'}'}</code> — διαχείριση κλειδιού από την παραπάνω ενότητα.</li>
          <li>Το αρχείο πρέπει να ακολουθεί τη δομή <code className="font-mono text-[var(--nts-text-primary)]">PROCUREMENT_TEMPLATE.xlsx</code> (7 sheets).</li>
          <li>Η εισαγωγή αντικαθιστά τα δεδομένα ανά sheet για το συγκεκριμένο brand.</li>
          <li>Η απόκριση επιστρέφει <code className="font-mono text-[var(--nts-text-primary)]">{'{'} "sheets": {'{'}"inventory": 45, ...{'}'}, "totalImported": 315 {'}'}</code>.</li>
        </ul>
      </div>
    </div>
  );
}

export function DataImport({ initialType }: DataImportProps = {}) {
  const { currentBrand } = useBrand();
  const [selectedType, setSelectedType] = useState<ImportType>(initialType ?? 'products');

  useEffect(() => {
    if (initialType) setSelectedType(initialType);
  }, [initialType]);
  const [selectedFiles, setSelectedFiles] = useState<FileWithType[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; fileName: string; fileProgress?: ImportProgress } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importHistory, setImportHistory] = useState<ImportJob[]>([]);
  const [lastImportDates, setLastImportDates] = useState<Record<string, Date>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [importMode, setImportMode] = useState<'standard' | 'feed'>('standard');
  const [selectedFeedSource, setSelectedFeedSource] = useState<FeedSourceType>('erp');
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewFileIndex, setPreviewFileIndex] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const { refresh: refreshProcurementSignals } = useRefreshProcurementSignals();

  const importTypes: { value: ImportType; label: string; icon: React.ReactNode }[] = [
    { value: 'products', label: 'Προϊόντα', icon: <Package size={16} /> },
    { value: 'segments', label: 'Segments (RFM)', icon: <Users size={16} /> },
    { value: 'campaigns', label: 'Καμπάνιες', icon: <BarChart3 size={16} /> },
    { value: 'organic', label: 'Οργανικά Έσοδα', icon: <Euro size={16} /> },
    { value: 'procurement', label: 'Procurement (7 καρτέλες)', icon: <ClipboardList size={16} /> },
  ];

  const isFeedImport = importMode === 'feed' && selectedType === 'products';

  const handleFileSelect = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const valid = fileArray.filter(f => isSupportedFile(f.name));
    if (valid.length < fileArray.length) {
      toast.error(`${fileArray.length - valid.length} αρχείο(α) παραλείφθηκαν (χρησιμοποιήστε .csv, .xlsx ή .xml)`);
    }
    if (valid.length) {
      setSelectedFiles(prev => [...prev, ...valid.map(f => ({
        file: f,
        type: selectedType,
        ...(selectedType === 'campaigns' ? { campaignChannel: null as CampaignChannelOverride } : {}),
      }))]);
      setImportResult(null);
      setUrlError(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [selectedType, toast]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files);
    }
  }, [handleFileSelect]);

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setImportResult(null);
  };

  const clearFiles = () => {
    setSelectedFiles([]);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const setFileType = (index: number, type: ImportType) => {
    setSelectedFiles(prev => prev.map((item, i) =>
      i === index ? { ...item, type, ...(type === 'campaigns' ? { campaignChannel: null as CampaignChannelOverride } : {}) } : item
    ));
    setImportResult(null);
  };

  const setFileCampaignChannel = (index: number, channel: CampaignChannelOverride) => {
    setSelectedFiles(prev => prev.map((item, i) => i === index ? { ...item, campaignChannel: channel } : item));
    setImportResult(null);
  };

  const handleLoadFromUrl = async () => {
    const url = importUrl.trim();
    if (!url) {
      setUrlError('Εισάγετε URL');
      return;
    }
    
    // Validate URL format
    try {
      new URL(url);
    } catch {
      setUrlError('Μη έγκυρο URL format');
      return;
    }
    
    setUrlLoading(true);
    setUrlError(null);
    setImportResult(null);
    try {
      // Fetch server-side (SSRF-guarded fetchImportUrl): most feed hosts send no CORS headers.
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Συνδεθείτε ξανά και δοκιμάστε.');
      const appCheck = await getAppCheckHeader();
      const res = await fetch(buildFunctionUrl('fetchImportUrl'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, ...appCheck },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* non-JSON error body */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const contentType = res.headers.get('Content-Type') || blob.type;
      const disposition = res.headers.get('Content-Disposition');
      
      // Extract filename from URL or Content-Disposition header
      let fileName = url.split('/').pop()?.split('?')[0] || 'import.csv';
      if (disposition) {
        const match = disposition.match(/filename[*]?=(?:UTF-8'')?["']?([^"';]+)/i);
        if (match?.[1]) fileName = decodeURIComponent(match[1].trim());
      }
      
      // Detect file type from content type or filename
      const isExcel =
        contentType.includes('spreadsheet') ||
        contentType.includes('excel') ||
        contentType.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') ||
        fileName.toLowerCase().endsWith('.xlsx') ||
        fileName.toLowerCase().endsWith('.xls');
      // XML feeds must NOT be renamed to .csv, or the importer parses each XML line as a CSV row.
      const isXml =
        contentType.includes('xml') ||
        fileName.toLowerCase().endsWith('.xml');

      if (!isSupportedFile(fileName)) {
        if (isExcel) {
          fileName = fileName.replace(/\.[^.]+$/, '') + '.xlsx';
        } else if (isXml) {
          fileName = fileName.replace(/\.[^.]+$/, '') + '.xml';
        } else {
          fileName = fileName.replace(/\.[^.]+$/, '') + '.csv';
        }
      }

      const file = new File([blob], fileName, {
        type: isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : (isXml ? 'application/xml' : blob.type)
      });
      setSelectedFiles(prev => [...prev, {
        file,
        type: selectedType,
        ...(selectedType === 'campaigns' ? { campaignChannel: null as CampaignChannelOverride } : {}),
      }]);
      setImportUrl('');
      toast.success(`Το αρχείο "${fileName}" φορτώθηκε επιτυχώς. Κάντε κλικ στο Import για εισαγωγή.`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      // Fetch goes through fetchImportUrl server-side, so surface the proxy's actual error (not CORS).
      setUrlError(`Σφάλμα: ${errorMsg}. Ελέγξτε ότι το URL είναι έγκυρο και προσβάσιμο.`);
    } finally {
      setUrlLoading(false);
    }
  };

  const handleImport = async () => {
    if (selectedFiles.length === 0) {
      alert('Please select at least one file');
      return;
    }
    if (!currentBrand) {
      toast.error('Επιλέξτε ή δημιουργήστε brand πριν την εισαγωγή.');
      return;
    }

    const total = selectedFiles.length;
    const results: ImportResult[] = [];

    flushSync(() => {
      setIsImporting(true);
      setImportResult(null);
      setImportProgress({ current: 0, total, fileName: selectedFiles[0].file.name });
    });

    try {
      const job: Omit<ImportJob, 'id'> = {
        brandId: currentBrand.id,
        type: selectedType,
        fileName: total === 1 ? selectedFiles[0].file.name : `${total} files`,
        status: 'processing',
        createdAt: new Date(),
      };

      await saveImportJob(job);

      const firstCampaignIdx = selectedFiles.findIndex((f) => f.type === 'campaigns');
      for (let i = 0; i < selectedFiles.length; i++) {
        const { file, type } = selectedFiles[i];
        const effectiveType = isFeedImport ? 'products' : type;
        const appendCampaigns = effectiveType === 'campaigns' && firstCampaignIdx >= 0 && i > firstCampaignIdx;
        flushSync(() => {
          setImportProgress({ current: i + 1, total, fileName: file.name, fileProgress: undefined });
        });
        const result = await importFile(
          file,
          effectiveType,
          (p) => setImportProgress((prev) => prev ? { ...prev, fileProgress: p } : null),
          currentBrand?.id ?? null,
          isFeedImport ? selectedFeedSource : undefined,
          effectiveType === 'campaigns' ? selectedFiles[i].campaignChannel : undefined,
          appendCampaigns
        );
        results.push(result);
      }

      const aggregated: ImportResult = {
        success: results.every(r => r.success),
        imported: results.reduce((s, r) => s + r.imported, 0),
        failed: results.reduce((s, r) => s + r.failed, 0),
        errors: results.flatMap((r, i) =>
          r.errors.map(e => `[${selectedFiles[i].file.name}] ${e}`)
        ),
        warnings: results.flatMap((r, i) =>
          r.warnings.map(w => `[${selectedFiles[i].file.name}] ${w}`)
        ),
      };

      setImportResult(aggregated);

      await saveImportJob({
        ...job,
        status: aggregated.success ? 'completed' : 'failed',
        result: aggregated,
        completedAt: new Date(),
      });

      if (aggregated.success) {
        toast.success(
          aggregated.imported > 0
            ? `Επιτυχής εισαγωγή: ${aggregated.imported} εγγραφές εισήχθησαν.`
            : 'Η ενέργεια ολοκληρώθηκε.'
        );
        const typesImported = new Set(isFeedImport ? ['products'] : selectedFiles.map((f) => f.type));
        const brandId = currentBrand?.id ?? null;
        queryClient.removeQueries({ queryKey: ['brandSyncVersion', brandId] });
        queryClient.invalidateQueries({ queryKey: ['brandSyncVersion', brandId] });
        
        if (import.meta.env.MODE === 'development') {
          logger.debug('[DataImport] Import successful, invalidating queries for:', { typesImported: Array.from(typesImported), brandId });
        }
        
        // Invalidate queries with brandId to ensure fresh data
        if (typesImported.has('products')) {
          queryClient.invalidateQueries({ queryKey: ['products', brandId] });
          queryClient.invalidateQueries({ queryKey: ['products'] });
        }
        if (typesImported.has('segments')) {
          queryClient.invalidateQueries({ queryKey: ['segments', brandId] });
          queryClient.invalidateQueries({ queryKey: ['segments'] });
        }
        if (typesImported.has('analytics')) {
          queryClient.invalidateQueries({ queryKey: ['analytics', brandId] });
          queryClient.invalidateQueries({ queryKey: ['analytics'] });
        }
        if (typesImported.has('organic')) {
          queryClient.invalidateQueries({ queryKey: ['organic', brandId] });
          queryClient.invalidateQueries({ queryKey: ['organic'] });
        }
        if (typesImported.has('campaigns')) {
          queryClient.invalidateQueries({ queryKey: ['campaigns', brandId] });
          queryClient.invalidateQueries({ queryKey: ['campaigns'] });
          if (import.meta.env.MODE === 'development') {
            logger.debug('[DataImport] Campaigns queries invalidated, should refetch now');
          }
        }
        if (typesImported.has('procurement')) {
          // useProcurement's ['procurement-sheet', brandId, key] queries (refetchOnMount:false +
          // staleTime 10') MUST be invalidated explicitly, else pages keep stale stock post-upload.
          queryClient.removeQueries({ queryKey: ['procurement-sheet'] });
          queryClient.removeQueries({ queryKey: ['procurement'] });
          queryClient.removeQueries({ queryKey: ['procurement_signals', brandId] });
          queryClient.removeQueries({ queryKey: ['productIntelligenceAggregate', brandId] });
          queryClient.removeQueries({ queryKey: ['productIntelligencePage', brandId] });
          queryClient.removeQueries({ queryKey: ['productIntelligenceInventory', brandId] });
          queryClient.invalidateQueries({ queryKey: ['procurement-sheet'] });
          queryClient.invalidateQueries({ queryKey: ['procurement'] });
          // Re-aggregate procurement_signals server-side, then rebuild the Product Intelligence
          // aggregate AFTER signals complete (PI/Dashboard stock comes from here for Procurement brands).
          const piBrandId = brandId;
          refreshProcurementSignals()
            .then((r) => {
              if (!r.ok && import.meta.env.MODE === 'development') {
                logger.warn('[DataImport] refreshProcurementSignals failed:', { err: r.error });
              }
              if (!piBrandId) return;
              return refreshProductIntelligenceOnServer(piBrandId).then(() => {
                queryClient.invalidateQueries({ queryKey: ['productIntelligenceAggregate', piBrandId] });
                queryClient.invalidateQueries({ queryKey: ['productIntelligencePage', piBrandId] });
                queryClient.invalidateQueries({ queryKey: ['brandSyncVersion', piBrandId] });
              });
            })
            .catch((err: unknown) => {
              if (import.meta.env.MODE === 'development') {
                logger.warn('[DataImport] post-procurement refresh failed:', { err });
              }
            });
        }
      } else {
        toast.error(
          aggregated.errors.length > 0
            ? `Η εισαγωγή απέτυχε: ${aggregated.errors[0]}`
            : 'Η εισαγωγή απέτυχε.'
        );
      }

      loadHistory();
      setSelectedFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const isPermission = /permission|denied|unauthenticated/i.test(msg);
      setImportResult({
        success: false,
        imported: 0,
        failed: 0,
        errors: [
          msg,
          ...(isPermission
            ? ['Ελέγξτε Firestore rules και αν χρειάζεται deploy: firebase deploy --only firestore:rules']
            : []),
        ],
        warnings: [],
      });
      toast.error(isPermission ? 'Απορρίφθηκε από τη βάση (rules/auth). Δείτε λεπτομέρειες κάτω.' : `Σφάλμα: ${msg}`);
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  const brandId = currentBrand?.id ?? null;

  useEffect(() => {
    if (!brandId) return;
    getLastImportDates(brandId).then(setLastImportDates).catch(() => {});
  }, [brandId]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const history = await getImportJobs(brandId);
      setImportHistory(history.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    } catch (error) {
      logger.error('Failed to load import history:', { err: error });
      toast.error('Αποτυχία φόρτωσης ιστορικού');
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleConfirmImportFromPreview = () => {
    setShowPreviewModal(false);
    handleImport();
  };

  const getStatusIcon = (status: ImportJob['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 size={16} className="text-[#1a7f37]" />;
      case 'failed':
        return <XCircle size={16} className="text-[#cf222e]" />;
      case 'processing':
        return <Clock size={16} className="text-[#4A4A4A]" />;
      default:
        return <Clock size={16} className="text-[#57606a]" />;
    }
  };



  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[var(--text-heading)] sm:text-2xl">Data Import</h2>}
        description={
          <p className="text-sm text-[#4A4A4A] sm:text-base">
            Import από CSV/Excel ή URL. Υποστηρίζονται: Products, Segments, Campaigns, Analytics. Για προϊόντα: ERP export, Google Ads, Meta Catalog.
          </p>
        }
      />

      {/* Import Mode: Standard vs Feed Sources */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setImportMode('standard'); setImportResult(null); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            importMode === 'standard'
              ? 'bg-[var(--nts-accent)] text-white shadow-sm'
              : 'bg-white text-[#4A4A4A] border border-[#E5E5E5] hover:border-[var(--nts-accent)]'
          }`}
        >
          Standard Import
        </button>
        <button
          onClick={() => { setImportMode('feed'); setSelectedType('products'); setImportResult(null); }}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            importMode === 'feed'
              ? 'bg-[var(--nts-accent)] text-white shadow-sm'
              : 'bg-white text-[#4A4A4A] border border-[#E5E5E5] hover:border-[var(--nts-accent)]'
          }`}
        >
          Feed Sources (ERP, Google Ads, Meta)
        </button>
      </div>

      {/* Progress bar - fixed at top when importing so it's always visible */}
      <AnimatePresence>
        {isImporting && importProgress && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-[#F5F5F5] border border-[#E5E5E5] rounded-lg p-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Spinner size="sm" />
                  <span className="text-sm font-semibold text-[#4A4A4A]">
                    {importProgress.fileProgress?.phase
                      ? importProgress.fileProgress.phase
                      : importProgress.fileProgress
                        ? `Εισαγωγή ${importProgress.fileProgress.rowsProcessed.toLocaleString()} / ${importProgress.fileProgress.totalRows.toLocaleString()} εγγραφών`
                        : `Εισαγωγή αρχείου ${importProgress.current} από ${importProgress.total}`}
                  </span>
                </div>
                <span className="text-sm font-mono font-semibold text-[#4A4A4A] flex-shrink-0">
                  {importProgress.fileProgress
                    ? `${Math.round((importProgress.fileProgress.rowsProcessed / importProgress.fileProgress.totalRows) * 100)}%`
                    : `${Math.round(((importProgress.current || 0) / importProgress.total) * 100)}%`}
                </span>
              </div>
              <ProgressBar
                value={importProgress.fileProgress?.rowsProcessed ?? importProgress.current ?? 0}
                max={importProgress.fileProgress?.totalRows ?? importProgress.total ?? 1}
                size="lg"
                color="#4A4A4A"
              />
              <p className="text-xs text-gray-600 truncate" title={importProgress.fileName}>
                {importProgress.fileName}
                {importProgress.fileProgress && (
                  <span className="ml-1">· batch {importProgress.fileProgress.batchIndex}/{importProgress.fileProgress.totalBatches}</span>
                )}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import Form */}
      <Card>
        <div className="p-6 space-y-6">
          {/* Feed Source selector - when Feed mode */}
          {importMode === 'feed' && (
            <div className="p-4 bg-[var(--nts-light-gray)] border border-[var(--borderColor-default,#d0d7de)] rounded-lg">
              <p className="text-sm font-medium text-[#4A4A4A] mb-3">Πηγή Feed:</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {FEED_SOURCE_OPTIONS.map((feed) => (
                  <button
                    key={feed.id}
                    onClick={() => setSelectedFeedSource(feed.id)}
                    className={`p-4 rounded-lg border text-left transition-all ${
                      selectedFeedSource === feed.id
                        ? 'border-[var(--nts-accent)] bg-white shadow-sm'
                        : 'border-[#E5E5E5] bg-white hover:border-[var(--nts-accent)]/50'
                    }`}
                  >
                    <span className="text-[var(--nts-medium-gray)]">{feed.icon}</span>
                    <p className="font-semibold text-[#1A1A1A] mt-1">{feed.name}</p>
                    <p className="text-xs text-[#6B7280] mt-0.5">{feed.description}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Compact Type Selection - Tab-like buttons (hidden in Feed mode) */}
          {importMode === 'standard' && (
            <div>
              <p className="text-sm font-medium text-[#4A4A4A] mb-3">Επιλέξτε τύπο δεδομένων:</p>
              <div className="flex flex-wrap gap-2">
                {importTypes.map((type) => {
                  const lastDate = lastImportDates[type.value];
                  return (
                  <button
                    key={type.value}
                    onClick={() => {
                      setSelectedType(type.value);
                      setImportResult(null);
                    }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex flex-col items-start ${
                      selectedType === type.value
                        ? 'bg-[var(--nts-accent)] text-white shadow-sm'
                        : 'bg-white text-[#4A4A4A] border border-[#E5E5E5] hover:border-[var(--nts-accent)] hover:text-[var(--nts-accent-text)]'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-flex">{type.icon}</span>
                      {type.label}
                    </span>
                    {lastDate && (
                      <span className={`text-[10px] mt-0.5 ${selectedType === type.value ? 'text-white/80' : 'text-[#9CA3AF]'}`}>
                        Τελευταίο: {lastDate.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </span>
                    )}
                  </button>
                  );
                })}
              </div>
            </div>
          )}
          {importMode === 'feed' && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm text-[#4A4A4A]">
                Εισαγωγή προϊόντων από <strong>{FEED_SOURCE_OPTIONS.find(f => f.id === selectedFeedSource)?.name}</strong>
              </p>
              {selectedFeedSource === 'google_ads' && (
                <button
                  type="button"
                  onClick={downloadGoogleAdsCsvTemplate}
                  className="text-sm text-[var(--nts-accent-text)] hover:underline"
                >
                  Λήψη CSV template
                </button>
              )}
            </div>
          )}

          {/* Drag & Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
              isDragging
                ? 'border-[var(--nts-accent)] bg-[var(--nts-light-gray)]'
                : 'border-[#E5E5E5] bg-[#F9F9F9] hover:border-[var(--nts-accent)] hover:bg-[var(--nts-light-gray)]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xml"
              multiple
              onChange={(e) => {
                if (e.target.files) {
                  handleFileSelect(e.target.files);
                }
              }}
              className="hidden"
              style={{ display: 'none' }}
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className="cursor-pointer flex flex-col items-center gap-3"
            >
              <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${
                isDragging ? 'bg-[var(--nts-accent)]' : 'bg-white border-2 border-[#E5E5E5]'
              }`}>
                <FileUp size={32} className={isDragging ? 'text-white' : 'text-[var(--nts-accent-text)]'} />
              </div>
              <div>
                <p className="text-base font-semibold text-[#1A1A1A]">
                  {isDragging ? 'Αφήστε τα αρχεία εδώ' : 'Σύρετε αρχεία εδώ ή κάντε κλικ για επιλογή'}
                </p>
                <p className="text-sm text-[#9CA3AF] mt-1">
                  CSV, Excel (.xlsx) ή XML (Google Ads / Skroutz) · Πολλαπλά αρχεία υποστηρίζονται
                </p>
              </div>
            </label>
          </div>

          {/* Selected Files List with Animations */}
          <AnimatePresence>
            {selectedFiles.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[#1A1A1A]">
                    {selectedFiles.length} {selectedFiles.length === 1 ? 'αρχείο επιλέχθηκε' : 'αρχεία επιλέχθηκαν'}
                  </p>
                  <div className="flex items-center gap-2">
                    {(isFeedImport || (importMode === 'standard' && selectedType === 'products')) && selectedFiles.length > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setPreviewFileIndex(0);
                          setShowPreviewModal(true);
                        }}
                      >
                        Preview
                      </Button>
                    )}
                    <button
                      onClick={clearFiles}
                      className="text-xs text-[#9CA3AF] hover:text-[#EF4444] flex items-center gap-1"
                    >
                      <Trash2 size={14} />
                      Καθαρισμός όλων
                    </button>
                  </div>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  <AnimatePresence>
                    {selectedFiles.map((item, index) => (
                      <motion.div
                        key={`${item.file.name}-${index}`}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="flex items-center gap-3 p-3 bg-white border border-[#E5E5E5] rounded-lg hover:border-[var(--nts-accent)] transition-colors"
                      >
                        <FileText size={20} className="text-[#9CA3AF] flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#1A1A1A] truncate" title={item.file.name}>
                            {item.file.name}
                          </p>
                          <p className="text-xs text-[#9CA3AF]">
                            {(item.file.size / 1024).toFixed(1)} KB
                          </p>
                        </div>
                        {importMode === 'standard' ? (
                          item.type === 'campaigns' ? (
                            <select
                              value={item.campaignChannel ?? ''}
                              onChange={(e) => setFileCampaignChannel(index, (e.target.value || null) as CampaignChannelOverride)}
                              className="text-xs border border-[#E5E5E5] rounded px-2 py-1 bg-white text-[#1A1A1A] focus:outline-none focus:border-[var(--nts-accent)]"
                              title="Campaign Channel"
                            >
                              <option value="">Αυτόματη</option>
                              <option value="Google Ads">Google Ads</option>
                              <option value="Meta">Meta</option>
                            </select>
                          ) : (
                            <select
                              value={item.type}
                              onChange={(e) => setFileType(index, e.target.value as ImportType)}
                              className={`text-xs border rounded px-2 py-1 bg-white text-[#1A1A1A] focus:outline-none focus:border-[var(--nts-accent)] ${
                                (item.file.name.toLowerCase().includes('campaign') || item.file.name.toLowerCase().includes('google ads') || item.file.name.toLowerCase().includes('meta'))
                                  ? 'border-gray-400 bg-[var(--nts-light-gray)]'
                                  : 'border-[#E5E5E5]'
                              }`}
                            >
                              {importTypes.map((t) => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                          )
                        ) : (
                          <span className="text-xs text-[#6B7280] px-2 py-1 bg-[#F5F5F5] rounded">
                            Products
                          </span>
                        )}
                        <button
                          onClick={() => removeFile(index)}
                          className="p-1 rounded text-[#9CA3AF] hover:text-[#EF4444] hover:bg-red-50 transition-colors"
                          aria-label="Remove file"
                        >
                          <XCircle size={18} />
                        </button>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Column Mapping Info & Download Template - Products only */}
          {(selectedType === 'products' || importMode === 'feed') && (
            <div className="border-t border-[#E5E5E5] pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-[#1A1A1A]">
                    {importMode === 'feed' ? (
                      <>Για <strong>{FEED_SOURCE_OPTIONS.find(f => f.id === selectedFeedSource)?.name}</strong>: id→sku, title→name, price→price κλπ. Αυτόματη αντιστοίχιση.</>
                    ) : (
                      'Οι στήλες του flat ERP αρχείου αντιστοιχίζονται αυτόματα'
                    )}
                  </p>
                  <button
                    onClick={() => {
                      window.location.hash = 'help?article=column-mapping-table';
                      const event = new CustomEvent('navigate-to-help');
                      window.dispatchEvent(event);
                    }}
                    className="inline-flex items-center gap-1 text-xs text-[#F97316] hover:text-[#EA580C] transition-colors group"
                    title="Δείτε όλες τις πιθανές εκδοχές ονομάτων στηλών στο Help"
                  >
                    <HelpCircle size={14} />
                    <span>Δείτε πίνακα</span>
                    <ExternalLink size={12} />
                  </button>
                </div>
                <Button
                  onClick={() => {
                    // Create CSV template from PRODUCT_COLUMN_MAPPING
                    const headers = PRODUCT_COLUMN_MAPPING.map(m => m.fileColumn).filter(h => !h.includes('+') && h !== 'Sell_Price + Cost_Price');
                    const csvContent = [
                      headers.join(','),
                      // Add example row with sample data
                      headers.map((h) => {
                        if (h === 'SKU_ID') return 'SKU-001';
                        if (h === 'Product_Name') return 'Sample Product';
                        if (h === 'Category') return 'Electronics';
                        if (h === 'Subcategory') return 'Audio';
                        if (h === 'Brand') return 'allone';
                        if (h === 'Barcode') return '5201234567890';
                        if (h === 'Status') return 'active';
                        if (h === 'Sell_Price') return '99.99';
                        if (h === 'Cost_Price') return '60.00';
                        if (h === 'List_Price') return '119.99';
                        if (h === 'Stock_On_Hand') return '100';
                        if (h === 'Available_Stock') return '88';
                        if (h === 'Stock_Age_Days') return '30';
                        if (h === 'Last_Sale_Date') return '2026-03-10';
                        if (h === 'Gross_Margin_%') return '40.0';
                        if (h === 'Margin_Tier') return 'high';
                        if (h === 'Priority_Flag') return 'New Launch';
                        if (h === 'Supplier') return 'Main Supplier';
                        if (h === 'First_Available_Date') return '2025-01-15';
                        if (h === 'Qty_Sold_Period') return '50';
                        if (h === 'Revenue_Period') return '4999.50';
                        if (h === 'Reorder_Point') return '20';
                        if (h === 'Reorder_Qty') return '60';
                        if (h === 'ABC_Class') return 'A';
                        if (h === 'Flow_Group') return 'Core';
                        if (h === 'Seasonality_Tag') return 'All_Year';
                        return '';
                      }).join(',')
                    ].join('\n');
                    
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', 'products_erp_flat_template.csv');
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    toast.success('ERP flat template downloaded!');
                  }}
                  variant="secondary"
                  size="sm"
                >
                  <FileText size={14} className="mr-1" />
                  Download Template
                </Button>
              </div>
            </div>
          )}

          {/* Collapsible URL Import */}
          <div className="border-t border-[#E5E5E5] pt-4">
            <button
              onClick={() => setShowUrlImport(!showUrlImport)}
              className="flex items-center gap-2 text-sm font-medium text-[#4A4A4A] hover:text-[var(--nts-accent-text)] transition-colors"
            >
              <LinkIcon size={16} />
              Εισαγωγή από URL
              {showUrlImport ? ' ▲' : ' ▼'}
            </button>
            {showUrlImport && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 space-y-2"
              >
                <div className="flex gap-2">
                  <input
                    type="url"
                    placeholder="https://... (CSV ή Excel file URL)"
                    value={importUrl}
                    onChange={(e) => { setImportUrl(e.target.value); setUrlError(null); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !urlLoading && importUrl.trim()) {
                        handleLoadFromUrl();
                      }
                    }}
                    className="flex-1 px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:border-[var(--nts-accent)]"
                  />
                  <Button
                    variant="primary"
                    onClick={handleLoadFromUrl}
                    disabled={urlLoading || !importUrl.trim()}
                  >
                    {urlLoading ? <Spinner size="sm" className="mr-2" /> : null}
                    Φόρτωση
                  </Button>
                </div>
                {urlError && (
                  <p className="text-sm text-[#EF4444] flex items-start gap-2">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    <span>{urlError}</span>
                  </p>
                )}
              </motion.div>
            )}
          </div>


          {/* Import Button */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-4 border-t border-[#E5E5E5]">
            <Button
              variant="primary"
              loading={isImporting}
              onClick={handleImport}
              disabled={selectedFiles.length === 0 || isImporting}
              className="w-full sm:flex-1"
            >
              {isImporting ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Εισαγωγή...
                </>
              ) : selectedFiles.length > 0 ? (
                `Εισαγωγή ${selectedFiles.length} ${selectedFiles.length === 1 ? 'αρχείου' : 'αρχείων'}`
              ) : (
                'Επιλέξτε αρχεία'
              )}
            </Button>
            <Button
              variant="secondary"
              className="w-full sm:w-auto sm:flex-none"
              onClick={() => {
                setShowHistory(!showHistory);
                if (!showHistory) {
                  loadHistory();
                }
              }}
            >
              {showHistory ? 'Απόκρυψη' : 'Ιστορικό'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Import Result - Animated */}
      <AnimatePresence>
        {importResult && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
          >
            <Card className={importResult.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}>
              <div className="p-6">
                <div className="flex items-start gap-4">
                  {importResult.success ? (
                    <CheckCircle2 size={24} className="text-green-600 flex-shrink-0 mt-1" />
                  ) : (
                    <XCircle size={24} className="text-red-600 flex-shrink-0 mt-1" />
                  )}
                  <div className="flex-1">
                    <h3 className={`text-lg font-semibold mb-1 ${importResult.success ? 'text-green-800' : 'text-red-800'}`}>
                      {importResult.success ? 'Επιτυχής εισαγωγή' : 'Η εισαγωγή απέτυχε'}
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">
                      {importResult.imported > 0 && `${importResult.imported} εισήχθησαν`}
                      {importResult.failed > 0 && ` · ${importResult.failed} απέτυχαν`}
                    </p>
                    
                    {importResult.errors.length > 0 && (
                      <div className="mt-4 space-y-1">
                        <p className="text-sm font-medium text-red-800">Σφάλματα:</p>
                        <ul className="text-sm text-red-700 space-y-1 max-h-32 overflow-y-auto">
                          {importResult.errors.slice(0, 5).map((error, index) => (
                            <li key={index} className="flex items-start gap-2">
                              <span className="text-red-500">•</span>
                              <span>{error}</span>
                            </li>
                          ))}
                          {importResult.errors.length > 5 && (
                            <li className="text-gray-500">...και {importResult.errors.length - 5} ακόμα</li>
                          )}
                        </ul>
                      </div>
                    )}
                    
                    {importResult.warnings.length > 0 && (
                      <div className="mt-4 space-y-1">
                        <p className="text-sm font-medium text-orange-800">Προειδοποιήσεις:</p>
                        <ul className="text-sm text-orange-700 space-y-1">
                          {importResult.warnings.slice(0, 3).map((warning, index) => (
                            <li key={index} className="flex items-start gap-2">
                              <span className="text-orange-500">•</span>
                              <span>{warning}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Import History - Collapsible */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <Card>
              <div className="p-6">
                <h3 className="text-lg font-semibold text-[#1A1A1A] mb-4 flex items-center gap-2">
                  <Clock size={20} />
                  Ιστορικό Εισαγωγών
                </h3>
                <div className="space-y-3">
                  {historyLoading ? (
                    <div className="py-12">
                      <Spinner size="md" label="Φόρτωση ιστορικού…" />
                    </div>
                  ) : importHistory.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      Δεν υπάρχει ιστορικό εισαγωγών ακόμα
                    </div>
                  ) : (
                    importHistory.map((job) => (
                      <div
                        key={job.id}
                        className="p-4 border border-[#E5E5E5] rounded-lg bg-white hover:border-[var(--nts-accent)] transition-colors"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              {getStatusIcon(job.status)}
                              <div className="font-semibold text-[#1A1A1A]">{job.fileName}</div>
                              <Badge variant="default">{job.type}</Badge>
                            </div>
                            <div className="text-sm text-gray-500">
                              {job.createdAt.toLocaleString('el-GR')}
                              {job.result && (
                                <span className="ml-2">
                                  • {job.result.imported} εισήχθησαν, {job.result.failed} απέτυχαν
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-xs text-gray-500 capitalize">
                            {job.status}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feed Sources - saved sources with Sync now */}
      {importMode === 'feed' && <FeedSourcesSection />}

      {/* Ad Platform Connectors (Google Ads, Meta) */}
      <ConnectorsPanel />

      {/* API Key Management */}
      <ApiKeyManager />

      {/* Procurement Automated Import */}
      <ProcurementApiInfo />

      {/* Feed Preview Modal */}
      <FeedPreviewModal
        isOpen={showPreviewModal}
        onClose={() => setShowPreviewModal(false)}
        file={selectedFiles[previewFileIndex]?.file ?? null}
        feedSourceType={isFeedImport ? selectedFeedSource : undefined}
        onConfirmImport={handleConfirmImportFromPreview}
      />
    </div>
  );
}
