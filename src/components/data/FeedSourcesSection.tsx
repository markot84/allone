import { useState } from 'react';
import { Plus, RefreshCw, Trash2, Pencil, Link as LinkIcon, FileText } from 'lucide-react';
import { Card, Button, Spinner, useToast, PageHeader } from '../common';
import { useFeedSources } from '../../hooks/useFeedSources';
import { useBrand } from '../../hooks/useBrand';
import { FEED_SOURCE_OPTIONS } from '../../data/feedSourceConfig';
import { FeedSourcesService } from '../../services/feedSources';
import { importFile } from '../../services/import';
import { useIsBrandOwnerOrAdmin } from '../../hooks/useIsBrandOwnerOrAdmin';
import { auth, buildFunctionUrl, getAppCheckHeader } from '../../config/firebase';
import { useQueryClient } from '@tanstack/react-query';
import type { FeedSource } from '../../types';

export function FeedSourcesSection() {
  const { currentBrand } = useBrand();
  const canManageCatalog = useIsBrandOwnerOrAdmin();
  const { feedSources, isLoading, create, update, remove, isCreating, isDeleting } = useFeedSources();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [formType, setFormType] = useState<FeedSource['type']>('erp');
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();

  const resetForm = () => {
    setFormName('');
    setFormUrl('');
    setFormType('erp');
    setShowForm(false);
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBrand?.id || !formName.trim() || !formUrl.trim()) {
      toast.error('Συμπληρώστε όνομα και URL');
      return;
    }
    if (!canManageCatalog) {
      toast.error('Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να διαχειριστεί feed προϊόντων.');
      return;
    }
    try {
      if (editingId) {
        await update({ id: editingId, data: { name: formName.trim(), url: formUrl.trim(), type: formType } });
        toast.success('Ενημερώθηκε');
      } else {
        await create({
          brandId: currentBrand.id,
          name: formName.trim(),
          url: formUrl.trim(),
          type: formType,
        });
        toast.success('Προστέθηκε');
      }
      resetForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Σφάλμα');
    }
  };

  const handleSync = async (source: FeedSource) => {
    if (!currentBrand?.id) return;
    if (!canManageCatalog) {
      toast.error('Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να συγχρονίσει feed προϊόντων.');
      return;
    }
    setSyncingId(source.id);
    try {
      // Fetch server-side: most feed hosts don't allow cross-origin browser
      // fetches (→ "Failed to fetch"). fetchImportUrl (SSRF-guarded) returns the
      // bytes for us, same as the manual URL importer.
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Συνδεθείτε ξανά και δοκιμάστε.');
      const appCheck = await getAppCheckHeader();
      const res = await fetch(buildFunctionUrl('fetchImportUrl'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}`, ...appCheck },
        body: JSON.stringify({ url: source.url }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* non-JSON error body */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const contentType = res.headers.get('Content-Type') || '';
      const disposition = res.headers.get('Content-Disposition');
      let fileName = source.url.split('/').pop()?.split('?')[0] || 'feed.csv';
      if (disposition) {
        const m = disposition.match(/filename[*]?=(?:UTF-8'')?["']?([^"';]+)/i);
        if (m?.[1]) fileName = decodeURIComponent(m[1].trim());
      }
      const isExcel = contentType.includes('spreadsheet') || fileName.toLowerCase().endsWith('.xlsx');
      const isXml = contentType.includes('xml') || fileName.toLowerCase().endsWith('.xml');
      let finalName = fileName;
      if ((source.type === 'google_ads' || source.type === 'skroutz') && isXml && !fileName.toLowerCase().endsWith('.xml')) {
        finalName = fileName.replace(/\.[^.]+$/, '') + '.xml';
      }
      const file = new File([blob], finalName, {
        type: isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : isXml ? 'application/xml' : 'text/csv',
      });
      const result = await importFile(file, 'products', undefined, currentBrand.id, source.type);
      await FeedSourcesService.updateLastRun(
        source.id,
        result.success ? 'success' : 'failed',
        result.imported,
        result.errors[0]
      );
      if (result.success) {
        toast.success(`Εισαγωγή: ${result.imported} προϊόντα`);
        queryClient.invalidateQueries({ queryKey: ['products', currentBrand.id] });
        queryClient.invalidateQueries({ queryKey: ['feed_sources', currentBrand.id] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['feed_sources', currentBrand.id] });
        toast.error(result.errors[0] || 'Αποτυχία εισαγωγής');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await FeedSourcesService.updateLastRun(source.id, 'failed', undefined, msg);
      queryClient.invalidateQueries({ queryKey: ['feed_sources', currentBrand.id] });
      // Fetch now goes through fetchImportUrl server-side — CORS is no longer a
      // failure mode, so surface the proxy's actual error.
      toast.error(msg);
    } finally {
      setSyncingId(null);
    }
  };

  const handleEdit = (s: FeedSource) => {
    setEditingId(s.id);
    setFormName(s.name);
    setFormUrl(s.url);
    setFormType(s.type);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!canManageCatalog) {
      toast.error('Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να διαγράψει feed προϊόντων.');
      return;
    }
    if (!confirm('Διαγραφή feed source;')) return;
    try {
      await remove(id);
      toast.success('Διαγράφηκε');
    } catch {
      toast.error('Αποτυχία διαγραφής');
    }
  };

  const typeInfo = (t: FeedSource['type']) => FEED_SOURCE_OPTIONS.find((f) => f.id === t);

  return (
    <div id="feed-sources-section">
    <Card>
      <div className="p-6">
        <PageHeader
          className="mb-4"
          toolbarAriaLabel="Feed sources"
          title={
            <h3 className="flex items-center gap-2 text-base font-semibold text-[var(--text-primary)] sm:text-lg">
              <LinkIcon size={20} className="shrink-0" />
              Αποθηκευμένα Feed Sources
            </h3>
          }
          actions={
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => { resetForm(); setShowForm(true); }}
              disabled={!currentBrand || !canManageCatalog}
              title={canManageCatalog ? undefined : 'Μόνο ιδιοκτήτης ή διαχειριστής μπορεί να προσθέσει feed'}
              className="min-h-[36px] w-full sm:w-auto"
            >
              Προσθήκη
            </Button>
          }
        />

        {showForm && (
          <form onSubmit={handleSubmit} className="mb-4 p-4 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]">
            <h4 className="font-medium text-[var(--text-primary)] mb-3">{editingId ? 'Επεξεργασία' : 'Νέο Feed Source'}</h4>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[var(--text-secondary)] block mb-1">Όνομα</label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="π.χ. ERP Daily Export"
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
                  required
                />
              </div>
              <div>
                <label className="text-xs text-[var(--text-secondary)] block mb-1">Τύπος</label>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as FeedSource['type'])}
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
                >
                  {FEED_SOURCE_OPTIONS.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[var(--text-secondary)] block mb-1">URL</label>
                <input
                  type="url"
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 border border-[var(--border)] rounded-lg text-sm"
                  required
                />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <Button type="submit" variant="primary" size="sm" disabled={isCreating}>
                {editingId ? 'Αποθήκευση' : 'Προσθήκη'}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={resetForm}>
                Ακύρωση
              </Button>
            </div>
          </form>
        )}

        {isLoading ? (
          <div className="py-8 flex justify-center">
            <Spinner size="md" />
          </div>
        ) : feedSources.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)] py-4">
            Δεν υπάρχουν αποθηκευμένα feed sources. Προσθέστε ένα για γρήγορη εισαγωγή με «Sync τώρα».
          </p>
        ) : (
          <div className="space-y-2">
            {feedSources.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 p-3 border border-[var(--border)] rounded-lg hover:border-[var(--nts-accent)]/50 transition-colors"
              >
                <span className="text-[var(--nts-medium-gray)]">{typeInfo(s.type)?.icon ?? <FileText size={20} />}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-[var(--text-primary)] truncate">{s.name}</p>
                  <p className="text-xs text-[var(--text-muted)] truncate" title={s.url}>{s.url}</p>
                  {s.lastRun && (
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">
                      Τελευταία: {new Date(s.lastRun).toLocaleString('el-GR')}
                      {s.lastStatus === 'success' && s.lastImported != null && (
                        <span className="text-green-600 ml-1">· {s.lastImported} εισήχθησαν</span>
                      )}
                      {s.lastStatus === 'failed' && (
                        <span className="text-red-600 ml-1">· Αποτυχία</span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    variant="primary"
                    size="sm"
                    icon={syncingId === s.id ? <Spinner size="sm" /> : <RefreshCw size={14} />}
                    onClick={() => handleSync(s)}
                    disabled={!!syncingId}
                  >
                    Sync τώρα
                  </Button>
                  <button
                    onClick={() => handleEdit(s)}
                    disabled={!canManageCatalog}
                    className="p-2 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-muted)] disabled:opacity-40"
                    title={canManageCatalog ? 'Επεξεργασία' : 'Μόνο ιδιοκτήτης ή διαχειριστής'}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="p-2 rounded-lg hover:bg-red-50 text-[var(--text-muted)] hover:text-red-600 disabled:opacity-40"
                    title={canManageCatalog ? 'Διαγραφή' : 'Μόνο ιδιοκτήτης ή διαχειριστής'}
                    disabled={isDeleting || !canManageCatalog}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
    </div>
  );
}
