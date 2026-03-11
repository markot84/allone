import { useState, useRef, useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useBrand } from '../../hooks';
import { FileText, CheckCircle2, XCircle, AlertCircle, Clock, Trash2, FileUp, Link as LinkIcon, HelpCircle, ExternalLink, Package, Users, BarChart3, Euro } from 'lucide-react';
import { Card, Button, Spinner, ProgressBar, useToast, Badge } from '../common';
import { importFile, saveImportJob, getImportJobs, isSupportedFile, PRODUCT_COLUMN_MAPPING, type ImportType, type ImportResult, type ImportJob, type ImportProgress, type CampaignChannelOverride } from '../../services/import';
import { FEED_SOURCE_OPTIONS, downloadGoogleAdsCsvTemplate, type FeedSourceType } from '../../data/feedSourceConfig';
import { FeedPreviewModal } from './FeedPreviewModal';
import { FeedSourcesSection } from './FeedSourcesSection';
import { ApiKeyManager } from './ApiKeyManager';
import { motion, AnimatePresence } from 'framer-motion';

export type FileWithType = { file: File; type: ImportType; campaignChannel?: CampaignChannelOverride };

interface DataImportProps {
  initialType?: ImportType;
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

  const importTypes: { value: ImportType; label: string; icon: React.ReactNode }[] = [
    { value: 'products', label: 'Products', icon: <Package size={16} /> },
    { value: 'segments', label: 'Segments', icon: <Users size={16} /> },
    { value: 'campaigns', label: 'Campaigns', icon: <BarChart3 size={16} /> },
    { value: 'organic', label: 'Οργανικά Έσοδα', icon: <Euro size={16} /> },
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
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
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
      
      if (!isSupportedFile(fileName)) {
        if (isExcel) {
          fileName = fileName.replace(/\.[^.]+$/, '') + '.xlsx';
        } else {
          fileName = fileName.replace(/\.[^.]+$/, '') + '.csv';
        }
      }
      
      const file = new File([blob], fileName, { 
        type: isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : blob.type 
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
      if (errorMsg.includes('CORS') || errorMsg.includes('Failed to fetch')) {
        setUrlError('CORS error: Το URL πρέπει να επιτρέπει cross-origin requests. Προσπαθήστε με Google Cloud signed URL ή άλλο CORS-enabled link.');
      } else {
        setUrlError(`Σφάλμα: ${errorMsg}. Ελέγξτε ότι το URL είναι έγκυρο και προσβάσιμο.`);
      }
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
        
        if (import.meta.env.MODE === 'development') {
          console.debug('[DataImport] Import successful, invalidating queries for:', Array.from(typesImported), 'brandId:', brandId);
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
            console.debug('[DataImport] Campaigns queries invalidated, should refetch now');
          }
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

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const history = await getImportJobs();
      setImportHistory(history.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    } catch (error) {
      console.error('Failed to load import history:', error);
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
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-[#1A1A1A]">Data Import</h2>
        <p className="text-[#4A4A4A] mt-1">
          Import από CSV/Excel ή URL. Υποστηρίζονται: Products, Segments, Campaigns, Analytics. Για προϊόντα: ERP export, Google Ads, Meta Catalog.
        </p>
      </div>

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
                    {importProgress.fileProgress
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
                {importTypes.map((type) => (
                  <button
                    key={type.value}
                    onClick={() => {
                      setSelectedType(type.value);
                      setImportResult(null);
                    }}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      selectedType === type.value
                        ? 'bg-[var(--nts-accent)] text-white shadow-sm'
                        : 'bg-white text-[#4A4A4A] border border-[#E5E5E5] hover:border-[var(--nts-accent)] hover:text-[var(--nts-accent)]'
                    }`}
                  >
                    <span className="mr-2 inline-flex">{type.icon}</span>
                    {type.label}
                  </button>
                ))}
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
                  className="text-sm text-[var(--nts-accent)] hover:underline"
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
              id="file-input"
            />
            <label
              htmlFor="file-input"
              className="cursor-pointer flex flex-col items-center gap-3"
            >
              <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-colors ${
                isDragging ? 'bg-[var(--nts-accent)]' : 'bg-white border-2 border-[#E5E5E5]'
              }`}>
                <FileUp size={32} className={isDragging ? 'text-white' : 'text-[var(--nts-accent)]'} />
              </div>
              <div>
                <p className="text-base font-semibold text-[#1A1A1A]">
                  {isDragging ? 'Αφήστε τα αρχεία εδώ' : 'Σύρετε αρχεία εδώ ή κάντε κλικ για επιλογή'}
                </p>
                <p className="text-sm text-[#9CA3AF] mt-1">
                  CSV, Excel (.xlsx) ή XML (Google Ads) · Πολλαπλά αρχεία υποστηρίζονται
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
                      'Οι στήλες του αρχείου σας αντιστοιχίζονται αυτόματα'
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
                        if (h === 'Sell_Price') return '99.99';
                        if (h === 'Cost_Price') return '60.00';
                        if (h === 'Stock_On_Hand') return '100';
                        if (h === 'Stock_Age_Days') return '30';
                        if (h === 'Gross_Margin_%') return '40.0';
                        if (h === 'Margin_Tier') return 'high';
                        if (h === 'Priority_Flag') return 'New Launch';
                        if (h === 'First_Available_Date') return '2025-01-15';
                        if (h === 'Qty_Sold_Period') return '50';
                        if (h === 'Revenue_Period') return '4999.50';
                        return '';
                      }).join(',')
                    ].join('\n');
                    
                    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                    const link = document.createElement('a');
                    const url = URL.createObjectURL(blob);
                    link.setAttribute('href', url);
                    link.setAttribute('download', 'products_template.csv');
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    toast.success('Template downloaded!');
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
              className="flex items-center gap-2 text-sm font-medium text-[#4A4A4A] hover:text-[var(--nts-accent)] transition-colors"
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
          <div className="flex items-center gap-3 pt-4 border-t border-[#E5E5E5]">
            <Button
              variant="primary"
              loading={isImporting}
              onClick={handleImport}
              disabled={selectedFiles.length === 0 || isImporting}
              className="flex-1"
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

      {/* Feed Sources - saved sources with Sync τώρα */}
      {importMode === 'feed' && <FeedSourcesSection />}

      {/* API Key Management */}
      <ApiKeyManager />

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
