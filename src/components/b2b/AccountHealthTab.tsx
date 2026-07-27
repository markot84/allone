import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, orderBy, query } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useBrand } from '../../hooks/useBrand';
import { useTasks } from '../../hooks/useCoordination';
import { computeAccountHealth, SEGMENT_META, type AccountHealthSegment } from '../../services/accountHealth';
import { Card, Button } from '../common';
import { Plus, Pencil, Trash2, ShieldCheck, TrendingUp, AlertTriangle, Moon, Sparkles } from 'lucide-react';

interface Account {
  id: string;
  brandId: string;
  name: string;
  industry?: string;
  contactName?: string;
  contactEmail?: string;
  lastOrderDate?: string;
  ordersLast6m?: number;
  totalRevenue?: number;
  revenueContribution?: number;
  createdAt: string;
}

const segmentIcon: Record<AccountHealthSegment, React.ReactNode> = {
  champion: <ShieldCheck size={14} className="text-emerald-600" />,
  growing: <TrendingUp size={14} className="text-blue-600" />,
  at_risk: <AlertTriangle size={14} className="text-amber-600" />,
  dormant: <Moon size={14} className="text-gray-400" />,
  new: <Sparkles size={14} className="text-violet-600" />,
};

const emptyForm = (): Omit<Account, 'id' | 'brandId' | 'createdAt'> => ({
  name: '', industry: '', contactName: '', contactEmail: '',
  lastOrderDate: '', ordersLast6m: 0, totalRevenue: 0, revenueContribution: 0,
});

interface AccountHealthTabProps {
  onSectionChange?: (section: string) => void;
}

export function AccountHealthTab({ onSectionChange: _onSectionChange }: AccountHealthTabProps = {}) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? '';
  const qc = useQueryClient();
  const { tasks } = useTasks();
  const [filterSegment, setFilterSegment] = useState<AccountHealthSegment | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const [form, setForm] = useState(emptyForm());

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['b2b_accounts', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      const ref = collection(db, 'b2b_accounts', brandId, 'accounts');
      const snap = await getDocs(query(ref, orderBy('name')));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Account));
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
  });

  const addAccount = useMutation({
    mutationFn: async (data: typeof form) => {
      await addDoc(collection(db, 'b2b_accounts', brandId, 'accounts'), { ...data, brandId, createdAt: new Date().toISOString() });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['b2b_accounts', brandId] }),
  });

  const updateAccount = useMutation({
    mutationFn: async ({ id, ...data }: Partial<Account> & { id: string }) => {
      await updateDoc(doc(db, 'b2b_accounts', brandId, 'accounts', id), data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['b2b_accounts', brandId] }),
  });

  const deleteAccount = useMutation({
    mutationFn: async (id: string) => {
      await deleteDoc(doc(db, 'b2b_accounts', brandId, 'accounts', id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['b2b_accounts', brandId] }),
  });

  const scoredAccounts = useMemo(() => {
    return accounts.map((acc) => {
      const openTasks = tasks.filter((t) => t.title.toLowerCase().includes(acc.name.toLowerCase()) && t.status !== 'done').length;
      const health = computeAccountHealth({
        lastOrderDate: acc.lastOrderDate,
        ordersLast6m: acc.ordersLast6m,
        revenueContribution: acc.revenueContribution,
        totalRevenue: acc.totalRevenue,
        openTasks,
      });
      return { ...acc, health };
    }).sort((a, b) => b.health.total - a.health.total);
  }, [accounts, tasks]);

  const segmentCounts = useMemo(() => {
    const counts: Partial<Record<AccountHealthSegment | 'all', number>> = { all: scoredAccounts.length };
    scoredAccounts.forEach(({ health }) => {
      counts[health.segment] = (counts[health.segment] ?? 0) + 1;
    });
    return counts;
  }, [scoredAccounts]);

  const filtered = filterSegment === 'all' ? scoredAccounts : scoredAccounts.filter((a) => a.health.segment === filterSegment);

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (acc: Account) => { setEditing(acc); setForm({ name: acc.name, industry: acc.industry ?? '', contactName: acc.contactName ?? '', contactEmail: acc.contactEmail ?? '', lastOrderDate: acc.lastOrderDate ?? '', ordersLast6m: acc.ordersLast6m ?? 0, totalRevenue: acc.totalRevenue ?? 0, revenueContribution: acc.revenueContribution ?? 0 }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    if (editing) await updateAccount.mutateAsync({ id: editing.id, ...form });
    else await addAccount.mutateAsync(form);
    setShowModal(false);
  };

  const inputCls = 'w-full rounded-lg border border-[#1f2328]/15 bg-white px-3 py-2 text-sm text-[var(--nts-charcoal)] focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/30';

  return (
    <div className="space-y-5">
      {/* Segment summary pills */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'champion', 'growing', 'at_risk', 'dormant', 'new'] as const).map((seg) => {
          const meta = seg === 'all' ? { label: 'Όλοι', color: '#374151', bg: '#f3f4f6' } : SEGMENT_META[seg];
          const count = segmentCounts[seg] ?? 0;
          return (
            <button
              key={seg}
              onClick={() => setFilterSegment(seg)}
              className={[
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all',
                filterSegment === seg ? 'ring-2 ring-offset-1' : 'opacity-70 hover:opacity-100',
              ].join(' ')}
              style={{ color: meta.color, background: meta.bg, borderColor: meta.color + '30', '--tw-ring-color': meta.color } as React.CSSProperties}
            >
              {seg !== 'all' && segmentIcon[seg]}
              {meta.label} {count > 0 && <span className="font-bold">({count})</span>}
            </button>
          );
        })}
        <Button variant="primary" onClick={openAdd} className="ml-auto shrink-0">
          <Plus size={14} className="mr-1" /> Νέος Account
        </Button>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-sm text-[var(--nts-medium-gray)]">Φόρτωση…</div>
      ) : filtered.length === 0 && accounts.length === 0 ? (
        <Card padding="lg">
          <div className="py-8 text-center">
            <ShieldCheck size={40} className="mx-auto mb-3 text-[var(--nts-medium-gray)]/30" />
            <p className="text-sm text-[var(--nts-medium-gray)] max-w-sm mx-auto">Προσθέστε τους B2B πελάτες σας για να δείτε το Account Health Score ανά account.</p>
            <button onClick={openAdd} className="mt-3 text-sm font-semibold text-[var(--nts-accent)] hover:underline">Προσθήκη πρώτου account →</button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((acc) => {
            const meta = SEGMENT_META[acc.health.segment];
            return (
              <Card key={acc.id} padding="none" className="overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold text-[var(--nts-charcoal)]">{acc.name}</p>
                      {acc.industry && <p className="text-xs text-[var(--nts-medium-gray)]">{acc.industry}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(acc)} className="p-1 rounded text-[var(--nts-medium-gray)] hover:bg-[#f0f0f0]"><Pencil size={13} /></button>
                      <button onClick={() => deleteAccount.mutate(acc.id)} className="p-1 rounded text-[var(--nts-medium-gray)] hover:bg-red-50 hover:text-red-600"><Trash2 size={13} /></button>
                    </div>
                  </div>

                  {/* Health score bar */}
                  <div className="mb-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-1.5">
                        {segmentIcon[acc.health.segment]}
                        <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                      </div>
                      <span className="text-lg font-bold font-mono text-[var(--nts-charcoal)]">{acc.health.total}<span className="text-xs font-normal text-[var(--nts-medium-gray)]">/100</span></span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-[#eef0f3] overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${acc.health.total}%`, background: meta.color }} />
                    </div>
                  </div>

                  {/* Dimension breakdown */}
                  <div className="grid grid-cols-4 gap-1 text-center">
                    {[
                      { label: 'R', value: acc.health.recency, tooltip: 'Recency' },
                      { label: 'F', value: acc.health.frequency, tooltip: 'Frequency' },
                      { label: 'M', value: acc.health.monetary, tooltip: 'Monetary' },
                      { label: 'E', value: acc.health.engagement, tooltip: 'Engagement' },
                    ].map((dim) => (
                      <div key={dim.label} title={`${dim.tooltip}: ${dim.value}/25`} className="rounded-lg bg-[#f9fafb] p-1.5">
                        <p className="text-[10px] font-bold text-[var(--nts-medium-gray)]">{dim.label}</p>
                        <p className="text-sm font-bold font-mono text-[var(--nts-charcoal)]">{dim.value}</p>
                      </div>
                    ))}
                  </div>

                  {acc.totalRevenue ? (
                    <p className="mt-3 text-xs text-[var(--nts-medium-gray)]">
                      Έσοδα <strong className="text-[var(--nts-charcoal)]">€{acc.totalRevenue.toLocaleString('el-GR')}</strong>
                      {acc.ordersLast6m ? ` · ${acc.ordersLast6m} παραγγελίες (6μ.)` : ''}
                    </p>
                  ) : null}
                </div>
                <div className="px-4 py-2 border-t border-[#eef0f3] bg-[#fafafa]">
                  <p className="text-[11px] text-[var(--nts-medium-gray)]">{meta.description}</p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-5 text-base font-bold text-[var(--nts-charcoal)]">{editing ? 'Επεξεργασία Account' : 'Νέος Account'}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Επωνυμία *</label>
                <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Κλάδος</label>
                <input className={inputCls} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="π.χ. Retail" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Επαφή</label>
                <input className={inputCls} value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Τελευταία παραγγελία</label>
                <input type="date" className={inputCls} value={form.lastOrderDate} onChange={(e) => setForm({ ...form, lastOrderDate: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Παραγγελίες (6μ.)</label>
                <input type="number" min={0} className={inputCls} value={form.ordersLast6m} onChange={(e) => setForm({ ...form, ordersLast6m: Number(e.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Συνολικά έσοδα (€)</label>
                <input type="number" min={0} className={inputCls} value={form.totalRevenue} onChange={(e) => setForm({ ...form, totalRevenue: Number(e.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">% επί εσόδων (0–1)</label>
                <input type="number" min={0} max={1} step={0.01} className={inputCls} value={form.revenueContribution} onChange={(e) => setForm({ ...form, revenueContribution: Number(e.target.value) })} placeholder="π.χ. 0.15" />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowModal(false)}>Άκυρο</Button>
              <Button variant="primary" onClick={handleSave} disabled={!form.name.trim() || addAccount.isPending}>
                {addAccount.isPending || updateAccount.isPending ? 'Αποθήκευση…' : 'Αποθήκευση'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
