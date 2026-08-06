import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useBrand } from '../../hooks/useBrand';
import { PageHeader, Card, CardHeader, Button, KPICard } from '../common';
import { Plus, Pencil, Trash2, MapPin, Users, RefreshCw, AlertCircle } from 'lucide-react';
import type { TerritoryRep, TerritoryAssignment } from '../../types';

type TerritoryTab = 'reps' | 'assignments' | 'reorder';

interface ReorderAccount {
  name: string;
  meanInterval: number;
  lastOrderDate: string;
  nextExpected: string;
  daysOverdue: number;
  isAlert: boolean;
}

const SAMPLE_REORDER: ReorderAccount[] = [
  { name: 'Alpha Retail SA', meanInterval: 30, lastOrderDate: '2026-03-10', nextExpected: '2026-04-09', daysOverdue: 37, isAlert: true },
  { name: 'Beta Distribution', meanInterval: 21, lastOrderDate: '2026-04-20', nextExpected: '2026-05-11', daysOverdue: 5, isAlert: false },
  { name: 'Gamma Stores', meanInterval: 45, lastOrderDate: '2026-02-01', nextExpected: '2026-03-18', daysOverdue: 59, isAlert: true },
];

interface TerritoryPageProps {
  onSectionChange?: (section: string) => void;
}

export function TerritoryPage({ onSectionChange }: TerritoryPageProps = {}) {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? '';
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TerritoryTab>('reps');
  const [showRepModal, setShowRepModal] = useState(false);
  const [editingRep, setEditingRep] = useState<TerritoryRep | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [repForm, setRepForm] = useState({ name: '', email: '', phone: '', region: '', targetAccounts: 0 });
  const [assignForm, setAssignForm] = useState({ accountName: '', repId: '', region: '' });

  const { data: reps = [], isLoading: repsLoading } = useQuery({
    queryKey: ['territory_reps', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      const snap = await getDocs(query(collection(db, 'territories', brandId, 'reps'), orderBy('name')));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as TerritoryRep));
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
  });

  const { data: assignments = [], isLoading: assignLoading } = useQuery({
    queryKey: ['territory_assignments', brandId],
    queryFn: async () => {
      if (!brandId) return [];
      const snap = await getDocs(query(collection(db, 'territories', brandId, 'assignments'), orderBy('assignedAt', 'desc')));
      return snap.docs.map((d) => ({ ...d.data() } as TerritoryAssignment));
    },
    enabled: !!brandId,
    staleTime: 10 * 60 * 1000,
  });

  const addRep = useMutation({
    mutationFn: async (data: typeof repForm) => {
      await addDoc(collection(db, 'territories', brandId, 'reps'), { ...data, brandId, createdAt: new Date().toISOString() });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['territory_reps', brandId] }); setShowRepModal(false); },
  });

  const updateRep = useMutation({
    mutationFn: async ({ id, ...data }: Partial<TerritoryRep> & { id: string }) => {
      await updateDoc(doc(db, 'territories', brandId, 'reps', id), data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['territory_reps', brandId] }); setShowRepModal(false); },
  });

  const deleteRep = useMutation({
    mutationFn: async (id: string) => deleteDoc(doc(db, 'territories', brandId, 'reps', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['territory_reps', brandId] }),
  });

  const addAssignment = useMutation({
    mutationFn: async (data: typeof assignForm) => {
      const rep = reps.find((r) => r.id === data.repId);
      await addDoc(collection(db, 'territories', brandId, 'assignments'), {
        ...data,
        accountId: `acc-${Date.now()}`,
        repName: rep?.name ?? '',
        assignedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['territory_assignments', brandId] }); setShowAssignModal(false); },
  });

  const openEditRep = (rep: TerritoryRep) => {
    setEditingRep(rep);
    setRepForm({ name: rep.name, email: rep.email ?? '', phone: rep.phone ?? '', region: rep.region, targetAccounts: rep.targetAccounts });
    setShowRepModal(true);
  };

  const handleSaveRep = async () => {
    if (editingRep) await updateRep.mutateAsync({ id: editingRep.id, ...repForm });
    else await addRep.mutateAsync(repForm);
  };

  const inputCls = 'w-full rounded-lg border border-[var(--text-primary)]/15 bg-white px-3 py-2 text-sm text-[var(--nts-charcoal)] focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/30';

  const totalTargets = reps.reduce((s, r) => s + (r.targetAccounts ?? 0), 0);
  const alertCount = SAMPLE_REORDER.filter((a) => a.isAlert).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={<h2 className="text-xl font-bold text-[var(--text-heading)] sm:text-2xl">Sales Territory</h2>}
        description={<p className="text-sm text-[var(--text-secondary)]">Διαχείριση γεωγραφικών περιοχών, εκχώρηση accounts σε sales reps και Reorder Intelligence.</p>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KPICard index={0} kpi={{ label: 'Sales Reps', value: `${reps.length}`, changeLabel: 'ενεργοί reps', tooltip: 'Αριθμός sales reps με ανατεθειμένες περιοχές.' }} onClick={() => setActiveTab('reps')} />
        <KPICard index={1} kpi={{ label: 'Ανατεθειμένοι accounts', value: `${assignments.length}`, changeLabel: `${totalTargets} target`, tooltip: 'Accounts που έχουν ανατεθεί σε συγκεκριμένο rep.' }} onClick={() => setActiveTab('assignments')} />
        <KPICard index={2} kpi={{ label: 'Reorder alerts', value: `${alertCount}`, changeLabel: 'accounts καθυστερούν', trend: alertCount > 0 ? 'down' : 'up', tooltip: 'Accounts που καθυστερούν > 1.5x το mean reorder interval.' }} onClick={() => setActiveTab('reorder')} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-1 w-fit">
        {([
          { id: 'reps' as TerritoryTab, label: 'Reps', icon: Users },
          { id: 'assignments' as TerritoryTab, label: 'Ανάθεση', icon: MapPin },
          { id: 'reorder' as TerritoryTab, label: 'Reorder Intelligence', icon: RefreshCw },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={[
              'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
              activeTab === id ? 'bg-white text-[var(--nts-charcoal)] shadow-sm' : 'text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)]',
            ].join(' ')}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Reps tab ─────────────────────────────────────── */}
      {activeTab === 'reps' && (
        <Card padding="none">
          <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
            <CardHeader title="Sales Reps" subtitle={`${reps.length} καταχωρημένοι`} icon={<Users size={18} className="text-[var(--nts-medium-gray)]" />} />
            <Button variant="primary" onClick={() => { setEditingRep(null); setRepForm({ name: '', email: '', phone: '', region: '', targetAccounts: 0 }); setShowRepModal(true); }}>
              <Plus size={14} className="mr-1" /> Νέος Rep
            </Button>
          </div>
          {repsLoading ? (
            <div className="p-8 text-center text-sm text-[var(--nts-medium-gray)]">Φόρτωση…</div>
          ) : reps.length === 0 ? (
            <div className="p-10 text-center text-sm text-[var(--nts-medium-gray)]">Δεν υπάρχουν reps. Προσθέστε τον πρώτο.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-1)]">
                    {['Ονοματεπώνυμο', 'Περιοχή', 'Email', 'Τηλέφωνο', 'Target Accounts', ''].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reps.map((rep) => (
                    <tr key={rep.id} className="border-b border-[var(--border)] hover:bg-[var(--surface-1)]/60">
                      <td className="px-4 py-3 font-medium text-[var(--nts-charcoal)]">{rep.name}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{rep.region}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{rep.email ?? '—'}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{rep.phone ?? '—'}</td>
                      <td className="px-4 py-3 font-mono">{rep.targetAccounts}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openEditRep(rep)} className="p-1 rounded text-[var(--nts-medium-gray)] hover:bg-[var(--border)]"><Pencil size={14} /></button>
                          <button onClick={() => { if (window.confirm('Διαγραφή;')) deleteRep.mutate(rep.id); }} className="p-1 rounded text-[var(--nts-medium-gray)] hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Assignments tab ─────────────────────────────── */}
      {activeTab === 'assignments' && (
        <Card padding="none">
          <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
            <CardHeader title="Ανάθεση Accounts" subtitle={`${assignments.length} εκχωρήσεις`} icon={<MapPin size={18} className="text-[var(--nts-medium-gray)]" />} />
            <Button variant="primary" disabled={reps.length === 0} onClick={() => { setAssignForm({ accountName: '', repId: '', region: '' }); setShowAssignModal(true); }}>
              <Plus size={14} className="mr-1" /> Νέα Ανάθεση
            </Button>
          </div>
          {assignLoading ? (
            <div className="p-8 text-center text-sm text-[var(--nts-medium-gray)]">Φόρτωση…</div>
          ) : assignments.length === 0 ? (
            <div className="p-10 text-center text-sm text-[var(--nts-medium-gray)]">Δεν υπάρχουν αναθέσεις.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-1)]">
                    {['Account', 'Rep', 'Περιοχή', 'Ανατέθηκε'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a, i) => (
                    <tr key={i} className="border-b border-[var(--border)] hover:bg-[var(--surface-1)]/60">
                      <td className="px-4 py-3 font-medium text-[var(--nts-charcoal)]">{a.accountName}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{a.repName}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{a.region}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{a.assignedAt?.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── Reorder Intelligence tab ─────────────────────── */}
      {activeTab === 'reorder' && (
        <div className="space-y-4">
          <Card padding="lg">
            <CardHeader
              title="Reorder Intelligence"
              subtitle="Πρόβλεψη επόμενης παραγγελίας & alerts"
              icon={<RefreshCw size={18} className="text-[var(--nts-medium-gray)]" />}
            />
            <p className="mt-2 text-sm text-[var(--nts-medium-gray)]">
              Ανάλυση inter-order intervals ανά account. Accounts που καθυστερούν &gt; 1.5× το mean interval εμφανίζονται ως <strong className="text-red-600">alert</strong>.
              Μελλοντικά αυτά μπορούν να δημιουργηθούν ως tasks στο Coordination.
            </p>
          </Card>

          <Card padding="none">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-1)]">
                    {['Account', 'Mean interval', 'Τελευταία αγορά', 'Αναμένεται', 'Ημέρες καθυστ.', 'Κατάσταση'].map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_REORDER.map((acc) => (
                    <tr key={acc.name} className={`border-b border-[var(--border)] ${acc.isAlert ? 'bg-red-50/40' : ''}`}>
                      <td className="px-4 py-3 font-medium text-[var(--nts-charcoal)]">{acc.name}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{acc.meanInterval}d</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{acc.lastOrderDate}</td>
                      <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{acc.nextExpected}</td>
                      <td className={`px-4 py-3 font-mono font-bold ${acc.isAlert ? 'text-red-600' : 'text-[var(--nts-medium-gray)]'}`}>
                        {acc.daysOverdue > 0 ? `+${acc.daysOverdue}d` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {acc.isAlert ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-red-600">
                            <AlertCircle size={13} />
                            Επικοινωνία
                          </div>
                        ) : (
                          <span className="text-xs text-emerald-600 font-semibold">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-amber-50 border-t border-amber-100 text-xs text-amber-700">
              <strong>Demo data:</strong> Τα δεδομένα αυτά είναι ενδεικτικά. Σύνδεσε ERP ή invoicing feed για πραγματική ανάλυση.
              {onSectionChange && <button onClick={() => onSectionChange('data')} className="ml-2 underline font-semibold">Σύνδεση Data →</button>}
            </div>
          </Card>
        </div>
      )}

      {/* Rep modal */}
      {showRepModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowRepModal(false); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-5 text-base font-bold text-[var(--nts-charcoal)]">{editingRep ? 'Επεξεργασία Rep' : 'Νέος Sales Rep'}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium">Ονοματεπώνυμο *</label>
                <input className={inputCls} value={repForm.name} onChange={(e) => setRepForm({ ...repForm, name: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Περιοχή *</label>
                <input className={inputCls} value={repForm.region} onChange={(e) => setRepForm({ ...repForm, region: e.target.value })} placeholder="π.χ. Βόρεια Ελλάδα" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Target Accounts</label>
                <input type="number" min={0} className={inputCls} value={repForm.targetAccounts} onChange={(e) => setRepForm({ ...repForm, targetAccounts: Number(e.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Email</label>
                <input type="email" className={inputCls} value={repForm.email} onChange={(e) => setRepForm({ ...repForm, email: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Τηλέφωνο</label>
                <input className={inputCls} value={repForm.phone} onChange={(e) => setRepForm({ ...repForm, phone: e.target.value })} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowRepModal(false)}>Άκυρο</Button>
              <Button variant="primary" onClick={handleSaveRep} disabled={!repForm.name || addRep.isPending}>{addRep.isPending ? 'Αποθήκευση…' : 'Αποθήκευση'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Assign modal */}
      {showAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowAssignModal(false); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-5 text-base font-bold text-[var(--nts-charcoal)]">Νέα Ανάθεση</h3>
            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium">Account</label>
                <input className={inputCls} value={assignForm.accountName} onChange={(e) => setAssignForm({ ...assignForm, accountName: e.target.value })} placeholder="Επωνυμία account" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Sales Rep</label>
                <select className={inputCls} value={assignForm.repId} onChange={(e) => setAssignForm({ ...assignForm, repId: e.target.value })}>
                  <option value="">-- Επιλογή --</option>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.region}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Περιοχή</label>
                <input className={inputCls} value={assignForm.region} onChange={(e) => setAssignForm({ ...assignForm, region: e.target.value })} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowAssignModal(false)}>Άκυρο</Button>
              <Button variant="primary" onClick={() => addAssignment.mutate(assignForm)} disabled={!assignForm.accountName || !assignForm.repId || addAssignment.isPending}>
                {addAssignment.isPending ? 'Αποθήκευση…' : 'Αποθήκευση'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
