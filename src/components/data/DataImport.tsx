import { useState, useRef } from 'react';
import { Upload, FileText, CheckCircle2, XCircle, AlertCircle, Clock, Download } from 'lucide-react';
import { Card, CardHeader, Button } from '../common';
import { importCSV, saveImportJob, getImportJobs, type ImportType, type ImportResult, type ImportJob } from '../../services/import';
import { Text, Heading, Label } from '@primer/react';

export function DataImport() {
  const [selectedType, setSelectedType] = useState<ImportType>('products');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importHistory, setImportHistory] = useState<ImportJob[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importTypes: { value: ImportType; label: string; description: string }[] = [
    { value: 'products', label: 'Products', description: 'Import product inventory data (SKU, name, category, stock, price, etc.)' },
    { value: 'segments', label: 'RFM Segments', description: 'Import customer segment data (name, RFM score, count, revenue share)' },
    { value: 'campaigns', label: 'Campaigns', description: 'Import marketing campaign data' },
    { value: 'analytics', label: 'Analytics', description: 'Import analytics and performance data' },
    { value: 'custom', label: 'Custom Data', description: 'Import custom data structure' },
  ];

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.name.endsWith('.csv')) {
        setSelectedFile(file);
        setImportResult(null);
      } else {
        alert('Please select a CSV file');
      }
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      alert('Please select a file first');
      return;
    }

    setIsImporting(true);
    setImportResult(null);

    try {
      const job: Omit<ImportJob, 'id'> = {
        type: selectedType,
        fileName: selectedFile.name,
        status: 'processing',
        createdAt: new Date(),
      };

      await saveImportJob(job);

      const result = await importCSV(selectedFile, selectedType);

      setImportResult(result);

      // Update job status
      await saveImportJob({
        ...job,
        status: result.success ? 'completed' : 'failed',
        result,
        completedAt: new Date(),
      });

      // Refresh history
      loadHistory();
    } catch (error) {
      setImportResult({
        success: false,
        imported: 0,
        failed: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error occurred'],
        warnings: [],
      });
    } finally {
      setIsImporting(false);
    }
  };

  const loadHistory = async () => {
    try {
      const history = await getImportJobs();
      setImportHistory(history.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    } catch (error) {
      console.error('Failed to load import history:', error);
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Heading as="h2" style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>
          Data Import
        </Heading>
        <Text as="p" style={{ color: 'var(--fgColor-muted, #57606a)', fontSize: 14 }}>
          Import your data from CSV files. Supported formats: Products, Segments, Campaigns, Analytics, and Custom data.
        </Text>
      </div>

      {/* Import Form */}
      <Card padding="lg">
        <CardHeader
          title="Import Data"
          subtitle="Select data type and upload CSV file"
          icon={<Upload size={20} className="text-[var(--nts-charcoal)]" />}
        />

        <div className="space-y-6 mt-6">
          {/* Data Type Selection */}
          <div>
            <Label style={{ marginBottom: 8, display: 'block', fontWeight: 600 }}>Data Type</Label>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {importTypes.map((type) => (
                <button
                  key={type.value}
                  onClick={() => {
                    setSelectedType(type.value);
                    setSelectedFile(null);
                    setImportResult(null);
                    if (fileInputRef.current) {
                      fileInputRef.current.value = '';
                    }
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

          {/* File Upload */}
          <div>
            <Label style={{ marginBottom: 8, display: 'block', fontWeight: 600 }}>CSV File</Label>
            <div className="border-2 border-dashed border-[var(--nts-border-gray)] rounded-lg p-6 text-center">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
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
                {selectedFile ? (
                  <div>
                    <div className="font-medium text-[var(--nts-charcoal)]">{selectedFile.name}</div>
                    <div className="text-sm text-[var(--nts-medium-gray)] mt-1">
                      {(selectedFile.size / 1024).toFixed(2)} KB
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="font-medium text-[var(--nts-charcoal)]">Click to select CSV file</div>
                    <div className="text-sm text-[var(--nts-medium-gray)] mt-1">
                      or drag and drop
                    </div>
                  </div>
                )}
              </label>
            </div>
          </div>

          {/* Template Download */}
          <div className="flex items-center gap-3 p-4 bg-[var(--nts-light-gray)] rounded-lg border border-[var(--nts-border-gray)]">
            <AlertCircle size={18} className="text-[var(--nts-medium-gray)]" />
            <div className="flex-1">
              <div className="text-sm font-medium text-[var(--nts-charcoal)]">Need a template?</div>
              <div className="text-xs text-[var(--nts-medium-gray)] mt-0.5">
                Download a CSV template with the correct column structure
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<Download size={14} />}
              onClick={downloadTemplate}
            >
              Download Template
            </Button>
          </div>

          {/* Import Button */}
          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              onClick={handleImport}
              disabled={!selectedFile || isImporting}
              className="flex-1"
            >
              {isImporting ? 'Importing...' : 'Import Data'}
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

      {/* Import Result */}
      {importResult && (
        <Card padding="lg">
          <CardHeader
            title={importResult.success ? 'Import Successful' : 'Import Failed'}
            subtitle={`${importResult.imported} imported, ${importResult.failed} failed`}
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
            {importHistory.length === 0 ? (
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
