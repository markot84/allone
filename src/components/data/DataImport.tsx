import { useState, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, CheckCircle2, XCircle, AlertCircle, Clock, Download, Trash2 } from 'lucide-react';
import { Card, CardHeader, Button, Spinner, ProgressBar, useToast, Tooltip } from '../common';
import { importFile, saveImportJob, getImportJobs, isSupportedFile, parseCSV, type ImportType, type ImportResult, type ImportJob, type ImportProgress } from '../../services/import';
import * as XLSX from 'xlsx';
import { Text, Heading, Label } from '@primer/react';

export type FileWithType = { file: File; type: ImportType };

export function DataImport() {
  const [selectedType, setSelectedType] = useState<ImportType>('products');
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const queryClient = useQueryClient();

  const importTypes: { value: ImportType; label: string; description: string }[] = [
    { value: 'products', label: 'Products', description: 'Import product inventory data (SKU, name, category, stock, price, etc.)' },
    { value: 'segments', label: 'RFM Segments', description: 'Import customer segment data (name, RFM score, count, revenue share)' },
    { value: 'campaigns', label: 'Campaigns', description: 'Import marketing campaign data' },
    { value: 'analytics', label: 'Analytics', description: 'Import analytics and performance data' },
    { value: 'custom', label: 'Custom Data', description: 'Import custom data structure' },
  ];

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList?.length) return;
    const all = Array.from(fileList);
    const valid = all.filter(f => isSupportedFile(f.name));
    if (valid.length < all.length) {
      alert(`${all.length - valid.length} file(s) skipped (use .csv or .xlsx)`);
    }
    if (valid.length) {
      setSelectedFiles(prev => [...prev, ...valid.map(f => ({ file: f, type: selectedType }))]);
      setImportResult(null);
      setUrlError(null);
    }
    requestAnimationFrame(() => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    });
  };

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
    setSelectedFiles(prev => prev.map((item, i) => i === index ? { ...item, type } : item));
    setImportResult(null);
  };

  const handleLoadFromUrl = async () => {
    const url = importUrl.trim();
    if (!url) {
      setUrlError('Enter a URL');
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
      const disposition = res.headers.get('Content-Disposition');
      let fileName = url.split('/').pop()?.split('?')[0] || 'import.csv';
      if (disposition) {
        const match = disposition.match(/filename[*]?=(?:UTF-8'')?["']?([^"';]+)/i);
        if (match?.[1]) fileName = match[1].trim();
      }
      if (!isSupportedFile(fileName)) {
        if (blob.type.includes('spreadsheet') || blob.type.includes('excel')) fileName = 'import.xlsx';
        else fileName = fileName.replace(/\.[^.]+$/, '') + '.csv';
      }
      const file = new File([blob], fileName, { type: blob.type });
      setSelectedFiles(prev => [...prev, { file, type: selectedType }]);
      setImportUrl('');
      toast.success(`Το αρχείο "${fileName}" φορτώθηκε. Πάτα Import για εισαγωγή.`);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Failed to load from URL. Check CORS and link.');
    } finally {
      setUrlLoading(false);
    }
  };

  const handleImport = async () => {
    if (selectedFiles.length === 0) {
      alert('Please select at least one file');
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

      for (let i = 0; i < selectedFiles.length; i++) {
        const { file, type } = selectedFiles[i];
        flushSync(() => {
          setImportProgress({ current: i + 1, total, fileName: file.name, fileProgress: undefined });
        });
        const result = await importFile(file, type, (p) => {
          setImportProgress((prev) => prev ? { ...prev, fileProgress: p } : null);
        });
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
        const typesImported = new Set(selectedFiles.map((f) => f.type));
        if (typesImported.has('products')) queryClient.invalidateQueries({ queryKey: ['products'] });
        if (typesImported.has('segments')) queryClient.invalidateQueries({ queryKey: ['segments'] });
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

  const getStatusIcon = (status: ImportJob['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 size={16} className="text-[#1a7f37]" />;
      case 'failed':
        return <XCircle size={16} className="text-[#cf222e]" />;
      case 'processing':
        return <Clock size={16} className="text-[#0969da]" />;
      default:
        return <Clock size={16} className="text-[#57606a]" />;
    }
  };

  const getCSVTemplate = (type: ImportType) => {
    const templates: Record<ImportType, string> = {
      products: `SKU,Name,Category,Margin Tier,Margin Percentage,Stock Level,Stock Capacity,Stock Age Days,Price,Priority Tag
PROD-001,Product Name,Electronics,high,35.5,100,500,30,99.99,featured
PROD-002,Another Product,Clothing,medium,25.0,50,200,15,49.99,`,
      segments: `Name,RFM Score,Count,Percentage,Revenue Share,Color,Description
Champions,555,1500,25.5,45.2,#22c55e,High value customers
Loyal,444,2000,34.0,30.1,#3b82f6,Regular customers`,
      campaigns: `Name,Channel,Budget,Start Date,End Date,Status
Summer Sale,Email Marketing,5000,2026-06-01,2026-08-31,active`,
      analytics: `Date,Metric,Value,Channel
2026-01-01,Revenue,50000,Email Marketing
2026-01-02,Revenue,52000,Meta Ads`,
      custom: `Column1,Column2,Column3
Value1,Value2,Value3`,
    };
    return templates[type];
  };

  const downloadTemplate = () => {
    const template = getCSVTemplate(selectedType);
    const blob = new Blob([template], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedType}_template.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadTemplateXlsx = () => {
    const template = getCSVTemplate(selectedType);
    const rows = parseCSV(template);
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    XLSX.writeFile(wb, `${selectedType}_template.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Heading as="h2" style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
          Data Import
        </Heading>
        <Text as="p" style={{ color: 'var(--fgColor-muted, #57606a)', fontSize: 14 }}>
          Import your data from CSV or Excel (.xlsx) files, or paste a direct link (e.g. Google Cloud signed URL). Supported types: Products, Segments, Campaigns, Analytics, Custom.
        </Text>
      </div>

      {/* Progress bar - fixed at top when importing so it's always visible */}
      {isImporting && importProgress && (
        <Card padding="lg" className="border-[#0969da]/40 bg-[#ddf4ff]/60">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Spinner size="sm" />
                <span className="text-sm font-semibold text-[#0969da]">
                  {importProgress.fileProgress
                    ? `Εισαγωγή ${importProgress.fileProgress.rowsProcessed.toLocaleString()} / ${importProgress.fileProgress.totalRows.toLocaleString()} εγγραφών`
                    : `Εισαγωγή αρχείου ${importProgress.current} από ${importProgress.total}`}
                </span>
              </div>
              <span className="text-sm font-mono font-semibold text-[#0969da] flex-shrink-0">
                {importProgress.fileProgress
                  ? `${Math.round((importProgress.fileProgress.rowsProcessed / importProgress.fileProgress.totalRows) * 100)}%`
                  : `${Math.round(((importProgress.current || 0) / importProgress.total) * 100)}%`}
              </span>
            </div>
            <ProgressBar
              value={importProgress.fileProgress?.rowsProcessed ?? importProgress.current ?? 0}
              max={importProgress.fileProgress?.totalRows ?? importProgress.total ?? 1}
              size="lg"
              color="#0969da"
            />
            <p className="text-xs text-[var(--nts-medium-gray)] truncate" title={importProgress.fileName}>
              {importProgress.fileName}
              {importProgress.fileProgress && (
                <span className="ml-1">· batch {importProgress.fileProgress.batchIndex}/{importProgress.fileProgress.totalBatches}</span>
              )}
            </p>
            <p className="text-xs text-[#0969da] animate-pulse">
              {importProgress.fileProgress ? 'Εγγραφή στη βάση…' : 'Ανάλυση αρχείου…'}
            </p>
          </div>
        </Card>
      )}

      {/* Import Form */}
      <Card padding="lg">
        <CardHeader
          title="Import Data"
          subtitle="Select data type and upload CSV file"
          icon={<Upload size={20} className="text-[var(--nts-charcoal)]" />}
        />

        <div className="space-y-6 mt-6">
          {/* Data Type Selection (default for new files) */}
          <div>
            <Label style={{ marginBottom: 8, display: 'block', fontWeight: 600 }}>
              <Tooltip content="Ο τύπος που θα ανατεθεί σε νέα αρχεία. Μπορείς να αλλάξεις τύπο ανά αρχείο στη λίστα.">Default type for new files</Tooltip>
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {importTypes.map((type) => (
                <button
                  key={type.value}
                  onClick={() => {
                    setSelectedType(type.value);
                    setImportResult(null);
                  }}
                  className={`p-4 rounded-lg border-2 text-left transition-all ${
                    selectedType === type.value
                      ? 'border-[var(--nts-charcoal)] bg-[var(--nts-light-gray)]'
                      : 'border-[var(--nts-border-gray)] bg-white hover:border-[var(--nts-medium-gray)]'
                  }`}
                >
                  <div className="font-semibold text-[var(--nts-charcoal)] mb-1">{type.label}</div>
                  <div className="text-sm text-[var(--nts-medium-gray)]">{type.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Import from URL */}
          <div>
            <Label style={{ marginBottom: 8, display: 'block', fontWeight: 600 }}>
              <Tooltip content="Επικόλλησε URL αρχείου (π.χ. Google Cloud signed URL). Τα αρχεία πρέπει να επιτρέπουν CORS.">Or import from link</Tooltip>
            </Label>
            <div className="flex gap-2 flex-wrap">
              <input
                type="url"
                placeholder="https://... (e.g. Google Cloud signed URL)"
                value={importUrl}
                onChange={(e) => { setImportUrl(e.target.value); setUrlError(null); }}
                className="flex-1 min-w-[200px] px-3 py-2 border border-[var(--nts-border-gray)] rounded-lg text-sm focus:outline-none focus:border-[#FF6B35]"
              />
              <Button
                variant="secondary"
                onClick={handleLoadFromUrl}
                disabled={urlLoading}
              >
                {urlLoading ? 'Loading...' : 'Load from URL'}
              </Button>
            </div>
            {urlError && (
              <p className="text-sm text-[#cf222e] mt-1">{urlError}</p>
            )}
          </div>

          {/* File Upload */}
          <div>
            <Label style={{ marginBottom: 8, display: 'block', fontWeight: 600 }}>
              <Tooltip content="Ανέβασε .csv ή .xlsx. Monday.com, DSS και SignalLab exports υποστηρίζονται με auto-detection στηλών.">Files (CSV or Excel)</Tooltip>
            </Label>
            <div className="border-2 border-dashed border-[var(--nts-border-gray)] rounded-lg p-6 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                id="csv-file-input"
              />
              <label
                htmlFor="csv-file-input"
                className="cursor-pointer flex flex-col items-center gap-3"
              >
                <div className="w-12 h-12 rounded-lg border border-[var(--nts-border-gray)] bg-[var(--nts-light-gray)] flex items-center justify-center">
                  <FileText size={24} className="text-[var(--nts-medium-gray)]" />
                </div>
                <div>
                  <div className="font-medium text-[var(--nts-charcoal)]">
                    {selectedFiles.length > 0
                      ? `${selectedFiles.length} file(s) selected`
                      : 'Click to select one or more .csv or .xlsx'}
                  </div>
                  <div className="text-sm text-[var(--nts-medium-gray)] mt-1">
                    Ctrl+Click ή Shift+Click για πολλά αρχεία · ή load from URL above
                  </div>
                </div>
              </label>
              {selectedFiles.length > 0 && (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => fileInputRef.current?.click()}
                >
                  + Προσθήκη ακόμα αρχείων
                </Button>
              )}
            </div>

            {selectedFiles.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--nts-charcoal)]">Selected files — ορίστε τύπο ανά αρχείο</span>
                  <button
                    type="button"
                    onClick={clearFiles}
                    className="text-xs text-[var(--nts-medium-gray)] hover:text-[#cf222e] flex items-center gap-1"
                  >
                    <Trash2 size={12} /> Clear all
                  </button>
                </div>
                <ul className="max-h-52 overflow-y-auto rounded-lg border border-[var(--nts-border-gray)] divide-y divide-[var(--nts-border-gray)]">
                  {selectedFiles.map((item, index) => (
                    <li
                      key={`${item.file.name}-${index}`}
                      className="flex items-center gap-2 px-3 py-2 bg-white text-sm flex-wrap"
                    >
                      <span className="font-medium text-[var(--nts-charcoal)] truncate min-w-0 flex-1" title={item.file.name}>
                        {item.file.name}
                      </span>
                      <select
                        value={item.type}
                        onChange={(e) => setFileType(index, e.target.value as ImportType)}
                        className="text-xs border border-[var(--nts-border-gray)] rounded px-2 py-1 bg-white text-[var(--nts-charcoal)] focus:outline-none focus:border-[#FF6B35]"
                        title="Τύπος εισαγωγής για αυτό το αρχείο"
                      >
                        {importTypes.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                      <span className="text-[var(--nts-medium-gray)] flex-shrink-0">
                        {(item.file.size / 1024).toFixed(1)} KB
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="p-1 rounded text-[var(--nts-medium-gray)] hover:bg-[#ffebe9] hover:text-[#cf222e]"
                        aria-label="Remove file"
                      >
                        <XCircle size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Template Download */}
          <div className="flex flex-wrap items-center gap-3 p-4 bg-[var(--nts-light-gray)] rounded-lg border border-[var(--nts-border-gray)]">
            <AlertCircle size={18} className="text-[var(--nts-medium-gray)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[var(--nts-charcoal)]">Need a template?</div>
              <div className="text-xs text-[var(--nts-medium-gray)] mt-0.5">
                Download CSV or Excel with the correct column structure
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={14} />}
                onClick={downloadTemplate}
              >
                CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={14} />}
                onClick={downloadTemplateXlsx}
              >
                Excel
              </Button>
            </div>
          </div>

          {/* Import Button */}
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              loading={isImporting}
              onClick={handleImport}
              disabled={selectedFiles.length === 0 || isImporting}
              className="flex-1"
            >
              {selectedFiles.length > 0
                ? `Import ${selectedFiles.length} file(s)`
                : 'Import Data'}
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
              {showHistory ? 'Hide' : 'Show'} History
            </Button>
          </div>
        </div>
      </Card>

      {/* Import Result - success/failure message */}
      {importResult && (
        <Card
          padding="lg"
          className={
            importResult.success
              ? 'border-[#1a7f37]/40 bg-[#dafbe1]/30'
              : 'border-[#cf222e]/40 bg-[#ffebe9]/30'
          }
        >
          <CardHeader
            title={importResult.success ? 'Η εισαγωγή ολοκληρώθηκε επιτυχώς' : 'Η εισαγωγή απέτυχε'}
            subtitle={`${importResult.imported} εγγραφές εισήχθησαν, ${importResult.failed} απέτυχαν`}
            icon={
              importResult.success ? (
                <CheckCircle2 size={20} className="text-[#1a7f37]" />
              ) : (
                <XCircle size={20} className="text-[#cf222e]" />
              )
            }
          />

          <div className="mt-6 space-y-4">
            {importResult.imported > 0 && (
              <div className="p-4 bg-[#dafbe1] rounded-lg border border-[#1a7f37]/20">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={18} className="text-[#1a7f37]" />
                  <div className="font-semibold text-[#1a7f37]">
                    {importResult.imported} records imported successfully
                  </div>
                </div>
              </div>
            )}

            {importResult.errors.length > 0 && (
              <div className="p-4 bg-[#ffebe9] rounded-lg border border-[#cf222e]/20">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle size={18} className="text-[#cf222e]" />
                  <div className="font-semibold text-[#cf222e]">Errors ({importResult.errors.length})</div>
                </div>
                <ul className="list-disc list-inside space-y-1 text-sm text-[#cf222e] ml-6">
                  {importResult.errors.slice(0, 10).map((error, index) => (
                    <li key={index}>{error}</li>
                  ))}
                  {importResult.errors.length > 10 && (
                    <li className="text-[var(--nts-medium-gray)]">
                      ...and {importResult.errors.length - 10} more errors
                    </li>
                  )}
                </ul>
              </div>
            )}

            {importResult.warnings.length > 0 && (
              <div className="p-4 bg-[#fff8c5] rounded-lg border border-[#9a6700]/20">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle size={18} className="text-[#9a6700]" />
                  <div className="font-semibold text-[#9a6700]">Warnings ({importResult.warnings.length})</div>
                </div>
                <ul className="list-disc list-inside space-y-1 text-sm text-[#9a6700] ml-6">
                  {importResult.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Import History */}
      {showHistory && (
        <Card padding="lg">
          <CardHeader
            title="Import History"
            subtitle="Recent import jobs"
            icon={<Clock size={20} className="text-[var(--nts-charcoal)]" />}
          />

          <div className="mt-6 space-y-3">
            {historyLoading ? (
              <div className="py-12">
                <Spinner size="md" label="Φόρτωση ιστορικού…" />
              </div>
            ) : importHistory.length === 0 ? (
              <div className="text-center py-8 text-[var(--nts-medium-gray)]">
                No import history yet
              </div>
            ) : (
              importHistory.map((job) => (
                <div
                  key={job.id}
                  className="p-4 border border-[var(--nts-border-gray)] rounded-lg bg-white"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusIcon(job.status)}
                        <div className="font-semibold text-[var(--nts-charcoal)]">{job.fileName}</div>
                        <div className="text-xs text-[var(--nts-medium-gray)] px-2 py-0.5 bg-[var(--nts-light-gray)] rounded">
                          {job.type}
                        </div>
                      </div>
                      <div className="text-sm text-[var(--nts-medium-gray)]">
                        {job.createdAt.toLocaleString()}
                        {job.result && (
                          <span className="ml-2">
                            • {job.result.imported} imported, {job.result.failed} failed
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-[var(--nts-medium-gray)] capitalize">
                      {job.status}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
