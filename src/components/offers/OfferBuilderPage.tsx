import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useBrand } from '../../hooks/useBrand';
import { useProductSource } from '../../hooks/useProductSource';
import { PageHeader, Card, CardHeader, Button } from '../common';
import { Plus, Trash2, Pencil, Download, FileText } from 'lucide-react';
import type { Offer, OfferLineItem, OfferStatus } from '../../types';
import { sanitizeSpreadsheetCell } from '../../utils/spreadsheetSafe';

const STATUS_META: Record<OfferStatus, { label: string; variant: 'secondary' | 'warning' | 'success' | 'error' }> = {
  draft: { label: 'Πρόχειρο', variant: 'secondary' },
  sent: { label: 'Εστάλη', variant: 'warning' },
  accepted: { label: 'Αποδεκτή', variant: 'success' },
  rejected: { label: 'Απορρίφθηκε', variant: 'error' },
};

const emptyLine = (): OfferLineItem => ({ description: '', quantity: 1, unitPrice: 0, discount: 0 });

interface OfferBuilderPageProps {
  onSectionChange?: (section: string) => void;
}

export function OfferBuilderPage({ onSectionChange: _onSectionChange }: OfferBuilderPageProps = {}) {
  const { currentBrand } = useBrand();
  const { products } = useProductSource();
  const brandId = currentBrand?.id ?? '';
  const qc = useQueryClient();

  const [view, setView] = useState<'list' | 'edit'>('list');
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [form, setForm] = useState<{ accountName: string; date: string; validUntil: string; notes: string; lines: OfferLineItem[] }>({
    accountName: '', date: new Date().toISOString().slice(0, 10), validUntil: '', notes: '', lines: [emptyLine()],
  });

  const { data: offers = [], isLoading } = useQuery({
    queryKey: ['offers', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      const snap = await getDocs(query(collection(db, 'offers'), where('brandId', '==', brandId), orderBy('createdAt', 'desc')));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Offer));
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
  });

  const saveOffer = useMutation({
    mutationFn: async (status: OfferStatus) => {
      const data = {
        ...form,
        brandId,
        status,
        createdBy: '',
        updatedAt: new Date().toISOString(),
      };
      if (editingOffer) {
        await updateDoc(doc(db, 'offers', editingOffer.id), data);
      } else {
        await addDoc(collection(db, 'offers'), { ...data, createdAt: new Date().toISOString() });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['offers', brandId] }); setView('list'); },
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OfferStatus }) => {
      await updateDoc(doc(db, 'offers', id), { status, updatedAt: new Date().toISOString() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers', brandId] }),
  });

  const deleteOffer = useMutation({
    mutationFn: async (id: string) => deleteDoc(doc(db, 'offers', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offers', brandId] }),
  });

  const openNew = () => {
    setEditingOffer(null);
    setForm({ accountName: '', date: new Date().toISOString().slice(0, 10), validUntil: '', notes: '', lines: [emptyLine()] });
    setView('edit');
  };

  const openEdit = (offer: Offer) => {
    setEditingOffer(offer);
    setForm({ accountName: offer.accountName, date: offer.date, validUntil: offer.validUntil ?? '', notes: offer.notes ?? '', lines: offer.lines });
    setView('edit');
  };

  const updateLine = (i: number, patch: Partial<OfferLineItem>) => {
    setForm((f) => { const lines = [...f.lines]; lines[i] = { ...lines[i], ...patch }; return { ...f, lines }; });
  };
  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, emptyLine()] }));
  const removeLine = (i: number) => setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const lineTotals = useMemo(() => form.lines.map((l) => {
    const net = l.quantity * l.unitPrice * (1 - (l.discount ?? 0) / 100);
    const margin = l.costPrice ? ((net - l.quantity * l.costPrice) / net) * 100 : null;
    return { net, margin };
  }), [form.lines]);

  const grandTotal = lineTotals.reduce((s, l) => s + l.net, 0);

  const handleExportCSV = (offer: Offer) => {
    const rows = [
      ['Περιγραφή', 'Ποσότητα', 'Τιμή μονάδας', 'Έκπτωση%', 'Σύνολο'],
      ...offer.lines.map((l) => [l.description, l.quantity, l.unitPrice, l.discount, (l.quantity * l.unitPrice * (1 - l.discount / 100)).toFixed(2)]),
    ];
    const csv = rows.map((r) => r.map(sanitizeSpreadsheetCell).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `offer-${offer.accountName.replace(/\s/g, '-')}.csv`;
    a.click();
  };

  const inputCls = 'w-full rounded-lg border border-[#1f2328]/15 bg-white px-3 py-2 text-sm text-[var(--nts-charcoal)] focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/30';

  if (view === 'edit') return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[var(--text-heading)] sm:text-2xl">{editingOffer ? 'Επεξεργασία Προσφοράς' : 'Νέα Εμπορική Προσφορά'}</h2>}
        description={<p className="text-sm text-[var(--text-secondary)]">Δημιουργία B2B εμπορικής προσφοράς με ανάλυση margin και export.</p>}
        actions={<Button variant="secondary" onClick={() => setView('list')}>← Πίσω</Button>}
      />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2 space-y-5">
          {/* Header */}
          <Card padding="lg">
            <CardHeader title="Στοιχεία Προσφοράς" icon={<FileText size={16} className="text-[var(--nts-medium-gray)]" />} />
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium">Πελάτης / Account *</label>
                <input className={inputCls} value={form.accountName} onChange={(e) => setForm({ ...form, accountName: e.target.value })} placeholder="Επωνυμία πελάτη" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Ημ/νία</label>
                <input type="date" className={inputCls} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Ισχύς έως</label>
                <input type="date" className={inputCls} value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium">Σημειώσεις</label>
                <textarea className={`${inputCls} min-h-[60px] resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
          </Card>

          {/* Line items */}
          <Card padding="none">
            <div className="flex items-center justify-between p-4 border-b border-[#eef0f3]">
              <h3 className="text-sm font-semibold text-[var(--nts-charcoal)]">Γραμμές Προσφοράς</h3>
              <Button variant="secondary" onClick={addLine}><Plus size={14} className="mr-1" /> Γραμμή</Button>
            </div>
            <div className="divide-y divide-[#eef0f3]">
              {form.lines.map((line, i) => (
                <div key={i} className="p-4 grid gap-3 sm:grid-cols-12 items-start">
                  <div className="sm:col-span-4">
                    {i === 0 && <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">Περιγραφή</label>}
                    <input className={inputCls} value={line.description} onChange={(e) => updateLine(i, { description: e.target.value })}
                      placeholder="Περιγραφή / SKU" list={`products-${i}`} />
                    <datalist id={`products-${i}`}>
                      {products.slice(0, 50).map((p: any) => <option key={p.id} value={p.name ?? p.title ?? p.sku ?? ''} />)}
                    </datalist>
                  </div>
                  <div className="sm:col-span-2">
                    {i === 0 && <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">Ποσ.</label>}
                    <input type="number" min={0} step={0.01} className={inputCls} value={line.quantity} onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })} />
                  </div>
                  <div className="sm:col-span-2">
                    {i === 0 && <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">Τιμή</label>}
                    <input type="number" min={0} step={0.01} className={inputCls} value={line.unitPrice} onChange={(e) => updateLine(i, { unitPrice: Number(e.target.value) })} />
                  </div>
                  <div className="sm:col-span-1">
                    {i === 0 && <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">Έκπτ%</label>}
                    <input type="number" min={0} max={100} className={inputCls} value={line.discount} onChange={(e) => updateLine(i, { discount: Number(e.target.value) })} />
                  </div>
                  <div className="sm:col-span-2 text-right">
                    {i === 0 && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">Σύνολο</div>}
                    <p className="py-2 text-sm font-bold font-mono text-[var(--nts-charcoal)]">€{lineTotals[i].net.toFixed(2)}</p>
                    {lineTotals[i].margin != null && (
                      <p className="text-[10px] text-emerald-600 font-medium">margin {lineTotals[i].margin!.toFixed(0)}%</p>
                    )}
                  </div>
                  <div className="sm:col-span-1 flex items-start pt-1">
                    {i === 0 && <div className="mb-1 h-[14px]" />}
                    <button onClick={() => removeLine(i)} disabled={form.lines.length === 1} className="p-1 rounded text-[var(--nts-medium-gray)] hover:bg-red-50 hover:text-red-600 disabled:opacity-30"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Summary */}
        <div className="space-y-4">
          <Card padding="lg">
            <h3 className="mb-4 text-sm font-semibold text-[var(--nts-charcoal)]">Σύνοψη</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-[var(--nts-medium-gray)]">
                <span>Γραμμές</span><span className="font-mono">{form.lines.length}</span>
              </div>
              <div className="flex justify-between border-t border-[#eef0f3] pt-2 font-bold text-[var(--nts-charcoal)]">
                <span>Σύνολο</span>
                <span className="font-mono text-lg text-[var(--nts-accent-text)]">€{grandTotal.toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-5 space-y-2">
              <Button variant="primary" className="w-full" onClick={() => saveOffer.mutate('draft')} disabled={!form.accountName || saveOffer.isPending}>
                Αποθήκευση ως πρόχειρο
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => saveOffer.mutate('sent')} disabled={!form.accountName || saveOffer.isPending}>
                Αποθήκευση & Εστάλη
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commercial Offers"
        description={<p className="text-sm text-[var(--text-secondary)]">Δημιουργία και παρακολούθηση B2B εμπορικών προσφορών με ανάλυση margin ανά γραμμή.</p>}
        actions={<Button variant="primary" onClick={openNew}><Plus size={15} className="mr-1" /> Νέα Προσφορά</Button>}
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Σύνολο', value: offers.length },
          { label: 'Πρόχειρα', value: offers.filter((o) => o.status === 'draft').length },
          { label: 'Αποδεκτές', value: offers.filter((o) => o.status === 'accepted').length },
          { label: 'Εκκρεμείς', value: offers.filter((o) => o.status === 'sent').length },
        ].map((item, i) => (
          <Card key={i} padding="lg">
            <p className="text-[13px] text-[var(--nts-medium-gray)]">{item.label}</p>
            <p className="text-3xl font-bold font-mono text-[var(--nts-charcoal)]">{item.value}</p>
          </Card>
        ))}
      </div>

      <Card padding="none">
        <div className="flex items-center justify-between p-5 border-b border-[#eef0f3]">
          <CardHeader title="Προσφορές" subtitle={`${offers.length} εγγραφές`} icon={<FileText size={18} className="text-[var(--nts-medium-gray)]" />} />
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-sm text-[var(--nts-medium-gray)]">Φόρτωση…</div>
        ) : offers.length === 0 ? (
          <div className="p-10 text-center">
            <FileText size={36} className="mx-auto mb-3 text-[var(--nts-medium-gray)]/40" />
            <p className="text-sm text-[var(--nts-medium-gray)]">Δεν υπάρχουν προσφορές.</p>
            <button onClick={openNew} className="mt-3 text-sm font-semibold text-[var(--nts-accent-text)] hover:underline">Δημιουργία πρώτης προσφοράς →</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr className="border-b border-[#eef0f3] bg-[#f9fafb]">
                  {['Account', 'Ημ/νία', 'Ισχύς έως', 'Σύνολο', 'Γραμμές', 'Κατάσταση', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {offers.map((offer) => {
                  const total = offer.lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - l.discount / 100), 0);
                  return (
                    <tr key={offer.id} className="border-b border-[#eef0f3] hover:bg-[var(--surface-2)]/60">
                      <td className="px-4 py-3 font-medium text-[var(--nts-charcoal)]">{offer.accountName}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{offer.date}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{offer.validUntil ?? '—'}</td>
                      <td className="px-4 py-3 font-mono font-bold text-[var(--nts-charcoal)]">€{total.toFixed(0)}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{offer.lines.length}</td>
                      <td className="px-4 py-3">
                        <select
                          value={offer.status}
                          onChange={(e) => updateStatus.mutate({ id: offer.id, status: e.target.value as OfferStatus })}
                          className="rounded border border-[#eef0f3] bg-white px-2 py-1 text-xs"
                        >
                          {(['draft', 'sent', 'accepted', 'rejected'] as OfferStatus[]).map((s) => (
                            <option key={s} value={s}>{STATUS_META[s].label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(offer)} className="p-1 rounded text-[var(--nts-medium-gray)] hover:bg-[#f0f0f0]"><Pencil size={14} /></button>
                          <button onClick={() => handleExportCSV(offer)} className="p-1 rounded text-[var(--nts-medium-gray)] hover:bg-[#f0f0f0]"><Download size={14} /></button>
                          <button onClick={() => { if (window.confirm('Διαγραφή;')) deleteOffer.mutate(offer.id); }} className="p-1 rounded text-[var(--nts-medium-gray)] hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
