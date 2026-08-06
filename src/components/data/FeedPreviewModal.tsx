import { useState, useEffect } from 'react';
import { X, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { Button, Spinner, ModalHeader } from '../common';
import { previewFileForProducts } from '../../services/import';
import { FEED_SOURCE_CONFIG, type FeedSourceType } from '../../data/feedSourceConfig';

interface FeedPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: File | null;
  feedSourceType?: FeedSourceType;
  onConfirmImport: () => void;
}

const APP_FIELD_LABELS: Record<string, string> = {
  sku: 'SKU',
  name: 'Όνομα',
  category: 'Κατηγορία',
  price: 'Τιμή',
  cost_price: 'Κόστος',
  stock_level: 'Απόθεμα',
  stock_age_days: 'Ημέρες αποθέματος',
  margin_percentage: 'Margin %',
  qty_sold_period: 'Πωλήσεις περίοδος',
  qty_sold_last_7d: 'Πωλήσεις 7 ημερών',
  qty_sold_last_30d: 'Πωλήσεις 30 ημερών',
  qty_sold_last_90d: 'Πωλήσεις 90 ημερών',
  qty_sold_lifetime: 'Πωλήσεις lifetime',
  last_sale_at: 'Τελευταία πώληση',
  revenue_period: 'Revenue περίοδος',
  first_available_date: 'Ημ. πρώτης παραλ.',
  priority_tag: 'Priority',
  margin_tier: 'Margin Tier',
};

export function FeedPreviewModal({
  isOpen,
  onClose,
  file,
  feedSourceType,
  onConfirmImport,
}: FeedPreviewModalProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewFileForProducts>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !file) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    previewFileForProducts(file, feedSourceType ?? undefined)
      .then(setPreview)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [isOpen, file, feedSourceType]);

  if (!isOpen) return null;

  const config = feedSourceType ? FEED_SOURCE_CONFIG[feedSourceType] : null;

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed inset-4 md:inset-8 lg:inset-12 bg-white rounded-xl shadow-2xl z-50 flex flex-col overflow-hidden">
        <ModalHeader
          toolbarAriaLabel="Κλείσιμο preview"
          title={
            <h3 className="break-words text-lg font-bold text-[var(--text-primary)]">
              Preview — {file?.name ?? 'αρχείο'}
            </h3>
          }
          actions={
            <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-[var(--surface-2)]">
              <X size={20} />
            </button>
          }
        />
        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16">
              <Spinner size="lg" label="Ανάλυση αρχείου…" />
            </div>
          )}
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
              <AlertCircle size={20} className="text-red-600" />
              <span className="text-red-800">{error}</span>
            </div>
          )}
          {!loading && !error && preview && (
            <div className="space-y-6">
              {/* Validation summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-[#F0FDF4] border border-[#86EFAC] rounded-lg">
                  <p className="text-xs text-[#166534]">Έγκυρα</p>
                  <p className="text-xl font-bold text-[#15803D]">{preview.validCount}</p>
                </div>
                <div className="p-3 bg-[#FEF2F2] border border-[#FECACA] rounded-lg">
                  <p className="text-xs text-[#991B1B]">Σφάλματα</p>
                  <p className="text-xl font-bold text-[#DC2626]">{preview.errorCount}</p>
                </div>
                <div className="p-3 bg-[var(--surface-2)] rounded-lg">
                  <p className="text-xs text-[var(--text-secondary)]">Σύνολο γραμμών</p>
                  <p className="text-xl font-bold text-[var(--text-primary)]">{preview.totalRows}</p>
                </div>
                <div className="p-3 bg-[var(--surface-2)] rounded-lg">
                  <p className="text-xs text-[var(--text-secondary)]">Στήλες</p>
                  <p className="text-xl font-bold text-[var(--text-primary)]">{preview.headers.length}</p>
                </div>
              </div>

              {/* Column mapping - only when feed source selected */}
              {config && (
              <div>
                <h4 className="font-semibold text-[var(--text-primary)] mb-2">Αντιστοίχιση στηλών ({config.name})</h4>
                <div className="border border-[var(--border)] rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-[var(--surface-2)] text-left text-xs text-[var(--text-secondary)]">
                        <th className="px-3 py-2">Feed column</th>
                        <th className="px-3 py-2"><ArrowRight size={14} className="inline" /></th>
                        <th className="px-3 py-2">App field</th>
                        <th className="px-3 py-2">Στο αρχείο</th>
                      </tr>
                    </thead>
                    <tbody>
                      {config.columnAliases.map((a) => {
                        const feedNorm = a.feedColumn.toLowerCase().replace(/\s+/g, '_');
                        const found = preview.headers.some((h) => h.toLowerCase().replace(/\s+/g, '_') === feedNorm);
                        return (
                          <tr key={a.feedColumn} className={`border-t border-[var(--border)] ${!found ? 'opacity-50' : ''}`}>
                            <td className="px-3 py-2 font-mono text-xs">
                              {a.feedColumn}
                              {a.required && !found && <span className="text-red-500 ml-1">*</span>}
                            </td>
                            <td className="px-3 py-2 text-[var(--text-muted)]">→</td>
                            <td className="px-3 py-2">{APP_FIELD_LABELS[a.appField] ?? a.appField}</td>
                            <td className="px-3 py-2">{found ? <CheckCircle2 size={14} className="text-green-600" /> : '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {preview.headers.length > 0 && (
                    <p className="text-xs text-[var(--text-muted)] px-3 py-2 border-t border-[var(--border)]">
                      Ανιχνευμένες στήλες: {preview.headers.join(', ')}
                    </p>
                  )}
                </div>
              </div>
              )}
              {!config && preview.headers.length > 0 && (
                <div className="p-3 bg-[var(--surface-2)] rounded-lg">
                  <p className="text-sm font-medium text-[var(--text-secondary)]">Ανιχνευμένες στήλες:</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{preview.headers.join(', ')}</p>
                </div>
              )}

              {/* Sample rows (mapped) */}
              {preview.mappedSample.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[var(--text-primary)] mb-2">Δείγμα (πρώτες {preview.mappedSample.length} γραμμές)</h4>
                  <div className="border border-[var(--border)] rounded-lg overflow-x-auto max-h-48 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-[var(--surface-2)]">
                        <tr className="text-left text-xs text-[var(--text-secondary)]">
                          {['sku', 'name', 'price', 'stock_level', 'category'].map((k) => (
                            <th key={k} className="px-3 py-2">{APP_FIELD_LABELS[k] ?? k}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.mappedSample.map((row, i) => (
                          <tr key={i} className="border-t border-[var(--border)]">
                            {['sku', 'name', 'price', 'stock_level', 'category'].map((k) => (
                              <td key={k} className="px-3 py-2 truncate max-w-[120px]" title={row[k]}>
                                {row[k] || '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Errors */}
              {preview.errors.length > 0 && (
                <div>
                  <h4 className="font-semibold text-[#DC2626] mb-2">Σφάλματα validation</h4>
                  <ul className="text-sm text-[#991B1B] space-y-1 max-h-32 overflow-y-auto bg-red-50 p-3 rounded-lg">
                    {preview.errors.slice(0, 10).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                    {preview.errors.length > 10 && (
                      <li className="text-[var(--text-muted)]">…και {preview.errors.length - 10} ακόμα</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-[var(--border)] flex items-center justify-between gap-3">
          <Button variant="secondary" onClick={onClose}>
            Ακύρωση
          </Button>
          {preview && (
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                onConfirmImport();
              }}
              disabled={preview.validCount === 0}
            >
              {preview.validCount > 0 ? (
                <>Εισαγωγή {preview.validCount} προϊόντων</>
              ) : (
                'Δεν υπάρχουν έγκυρες γραμμές'
              )}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
