import { useState } from 'react';
import { Plus, Calendar, CheckCircle2, XCircle, Clock } from 'lucide-react';
import { Card, CardHeader, Badge, Button } from '../common';
import { useHREmployees, useHRLeaves } from '../../hooks/useHRData';
import type { LeaveType, LeaveStatus } from '../../types';

const leaveTypeLabel: Record<LeaveType, string> = {
  annual: 'Κανονική',
  sick: 'Ασθένεια',
  other: 'Άλλο',
};

const leaveStatusIcon: Record<LeaveStatus, React.ReactNode> = {
  pending: <Clock size={14} className="text-amber-500" />,
  approved: <CheckCircle2 size={14} className="text-emerald-600" />,
  rejected: <XCircle size={14} className="text-red-500" />,
};

const leaveStatusVariant: Record<LeaveStatus, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
};

const leaveStatusLabel: Record<LeaveStatus, string> = {
  pending: 'Εκκρεμεί',
  approved: 'Εγκρίθηκε',
  rejected: 'Απορρίφθηκε',
};

function daysBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.max(1, Math.round(ms / 86400000) + 1);
}

export function LeaveTracker() {
  const { employees } = useHREmployees();
  const { leaves, pendingLeaves, isLoading, addLeave, updateLeave } = useHRLeaves();
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({
    employeeId: '',
    employeeName: '',
    type: 'annual' as LeaveType,
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    notes: '',
  });

  const today = new Date().toISOString().slice(0, 10);
  const activeLeaves = leaves.filter((l) => l.status === 'approved' && l.startDate <= today && l.endDate >= today);

  const handleSave = async () => {
    if (!form.employeeId) return;
    await addLeave.mutateAsync({ ...form, status: 'pending' });
    setShowModal(false);
  };

  const handleStatus = async (id: string, status: LeaveStatus) => {
    await updateLeave.mutateAsync({ id, status });
  };

  const inputCls = 'w-full rounded-lg border border-[#1f2328]/15 bg-white px-3 py-2 text-sm text-[var(--nts-charcoal)] focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/30';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Σε άδεια σήμερα', value: `${activeLeaves.length}`, sub: 'εγκεκριμένες' },
          { label: 'Εκκρεμείς αιτήσεις', value: `${pendingLeaves.length}`, sub: 'απαιτούν έγκριση' },
          { label: 'Σύνολο ημερών (φέτος)', value: `${leaves.filter((l) => l.status === 'approved' && l.startDate.startsWith(new Date().getFullYear().toString())).reduce((s, l) => s + daysBetween(l.startDate, l.endDate), 0)}`, sub: 'εγκεκριμένες ημέρες' },
        ].map((item, i) => (
          <Card key={i} padding="lg">
            <p className="text-[13px] font-medium text-[var(--nts-medium-gray)]">{item.label}</p>
            <p className="mt-1 text-3xl font-bold font-mono text-[var(--nts-charcoal)]">{item.value}</p>
            <p className="mt-1 text-xs text-[var(--nts-medium-gray)]">{item.sub}</p>
          </Card>
        ))}
      </div>

      <Card padding="none">
        <div className="flex items-center justify-between p-5 border-b border-[#eef0f3]">
          <CardHeader
            title="Αιτήσεις αδείας"
            subtitle={`${leaves.length} εγγραφές`}
            icon={<Calendar size={18} className="text-[var(--nts-medium-gray)]" />}
          />
          <Button variant="primary" onClick={() => setShowModal(true)} disabled={employees.length === 0} className="shrink-0">
            <Plus size={15} className="mr-1" /> Νέα άδεια
          </Button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-sm text-[var(--nts-medium-gray)]">Φόρτωση…</div>
        ) : leaves.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--nts-medium-gray)]">Δεν υπάρχουν αιτήσεις αδείας.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table w-full text-sm">
              <thead>
                <tr className="border-b border-[#eef0f3] bg-[#f9fafb]">
                  {['Εργαζόμενος', 'Τύπος', 'Από', 'Έως', 'Ημέρες', 'Κατάσταση', 'Ενέργειες'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaves.map((lv) => (
                  <tr key={lv.id} className="border-b border-[#eef0f3] hover:bg-[var(--surface-2)]/60">
                    <td className="px-4 py-3 font-medium text-[var(--nts-charcoal)]">{lv.employeeName}</td>
                    <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{leaveTypeLabel[lv.type]}</td>
                    <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{lv.startDate}</td>
                    <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{lv.endDate}</td>
                    <td className="px-4 py-3 font-mono text-[var(--nts-charcoal)]">{daysBetween(lv.startDate, lv.endDate)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        {leaveStatusIcon[lv.status]}
                        <Badge variant={leaveStatusVariant[lv.status]} size="sm">{leaveStatusLabel[lv.status]}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {lv.status === 'pending' && (
                        <div className="flex gap-2">
                          <button onClick={() => handleStatus(lv.id, 'approved')} className="rounded px-2 py-1 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100">Έγκριση</button>
                          <button onClick={() => handleStatus(lv.id, 'rejected')} className="rounded px-2 py-1 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100">Απόρριψη</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-5 text-base font-bold text-[var(--nts-charcoal)]">Νέα αίτηση άδειας</h3>
            <div className="grid gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Εργαζόμενος *</label>
                <select className={inputCls} value={form.employeeId} onChange={(e) => {
                  const emp = employees.find((x) => x.id === e.target.value);
                  setForm({ ...form, employeeId: e.target.value, employeeName: emp?.name ?? '' });
                }}>
                  <option value="">-- Επιλογή --</option>
                  {employees.filter((emp) => emp.status === 'active').map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Τύπος</label>
                <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LeaveType })}>
                  <option value="annual">Κανονική</option>
                  <option value="sick">Ασθένεια</option>
                  <option value="other">Άλλο</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Από</label>
                  <input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Έως</label>
                  <input type="date" className={inputCls} value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Σημειώσεις</label>
                <textarea className={`${inputCls} min-h-[60px] resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowModal(false)}>Άκυρο</Button>
              <Button variant="primary" onClick={handleSave} disabled={!form.employeeId || addLeave.isPending}>
                {addLeave.isPending ? 'Αποθήκευση…' : 'Αποθήκευση'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
