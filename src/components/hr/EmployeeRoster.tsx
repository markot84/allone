import { useState } from 'react';
import { Plus, Pencil, Trash2, UserCheck, UserX } from 'lucide-react';
import { Card, CardHeader, Badge, Button } from '../common';
import { useHREmployees } from '../../hooks/useHRData';
import type { HREmployee, EmployeeStatus } from '../../types';

const DEPARTMENTS = ['Διοίκηση', 'Εμπορική', 'Marketing', 'Logistics', 'Τεχνικό', 'Λογιστήριο', 'Άλλο'];

const statusLabel: Record<EmployeeStatus, string> = {
  active: 'Ενεργός',
  inactive: 'Ανενεργός',
  on_leave: 'Σε άδεια',
};

const statusVariant: Record<EmployeeStatus, 'success' | 'warning' | 'default'> = {
  active: 'success',
  inactive: 'default',
  on_leave: 'warning',
};

const emptyForm = (): Omit<HREmployee, 'id' | 'brandId' | 'createdAt' | 'updatedAt'> => ({
  name: '',
  role: '',
  department: DEPARTMENTS[0],
  monthlyCost: 0,
  startDate: new Date().toISOString().slice(0, 10),
  status: 'active',
  email: '',
  notes: '',
});

export function EmployeeRoster() {
  const { employees, isLoading, addEmployee, updateEmployee, deleteEmployee } = useHREmployees();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<HREmployee | null>(null);
  const [form, setForm] = useState(emptyForm());

  const openAdd = () => { setEditing(null); setForm(emptyForm()); setShowModal(true); };
  const openEdit = (emp: HREmployee) => { setEditing(emp); setForm({ name: emp.name, role: emp.role, department: emp.department, monthlyCost: emp.monthlyCost, startDate: emp.startDate, status: emp.status, email: emp.email ?? '', notes: emp.notes ?? '' }); setShowModal(true); };

  const handleSave = async () => {
    if (!form.name.trim() || !form.role.trim()) return;
    if (editing) {
      await updateEmployee.mutateAsync({ id: editing.id, ...form });
    } else {
      await addEmployee.mutateAsync(form);
    }
    setShowModal(false);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Διαγραφή εργαζομένου;')) return;
    await deleteEmployee.mutateAsync(id);
  };

  const inputCls = 'w-full rounded-lg border border-[#1f2328]/15 bg-white px-3 py-2 text-sm text-[var(--nts-charcoal)] placeholder:text-[var(--nts-medium-gray)] focus:border-[var(--nts-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--nts-accent)]/30';

  return (
    <Card padding="none">
      <div className="flex items-center justify-between p-5 border-b border-[#eef0f3]">
        <CardHeader
          title="Εργαζόμενοι"
          subtitle={`${employees.filter((e) => e.status === 'active').length} ενεργοί`}
          icon={<UserCheck size={18} className="text-[var(--nts-medium-gray)]" />}
        />
        <Button variant="primary" onClick={openAdd} className="shrink-0">
          <Plus size={15} className="mr-1" /> Προσθήκη
        </Button>
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-sm text-[var(--nts-medium-gray)]">Φόρτωση…</div>
      ) : employees.length === 0 ? (
        <div className="p-10 text-center">
          <UserX size={36} className="mx-auto mb-3 text-[var(--nts-medium-gray)]/40" />
          <p className="text-sm text-[var(--nts-medium-gray)]">Δεν υπάρχουν εγγεγραμμένοι εργαζόμενοι.</p>
          <button onClick={openAdd} className="mt-3 text-sm font-semibold text-[var(--nts-accent-text)] hover:underline">
            Προσθήκη πρώτου εργαζόμενου →
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#eef0f3] bg-[#f9fafb]">
                {['Ονοματεπώνυμο', 'Ρόλος', 'Τμήμα', 'Μηνιαίο κόστος', 'Από', 'Κατάσταση', ''].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--nts-medium-gray)]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-[#eef0f3] hover:bg-[#f9fafb]/60 transition-colors">
                  <td className="px-4 py-3 font-medium text-[var(--nts-charcoal)]">{emp.name}</td>
                  <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{emp.role}</td>
                  <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{emp.department}</td>
                  <td className="px-4 py-3 font-mono text-[var(--nts-charcoal)]">€{emp.monthlyCost.toLocaleString('el-GR')}</td>
                  <td className="px-4 py-3 text-[var(--nts-medium-gray)]">{emp.startDate}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[emp.status]} size="sm">{statusLabel[emp.status]}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(emp)} className="rounded p-1 text-[var(--nts-medium-gray)] hover:bg-[#f0f0f0] hover:text-[var(--nts-charcoal)]"><Pencil size={14} /></button>
                      <button onClick={() => handleDelete(emp.id)} className="rounded p-1 text-[var(--nts-medium-gray)] hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <h3 className="mb-5 text-base font-bold text-[var(--nts-charcoal)]">{editing ? 'Επεξεργασία' : 'Νέος Εργαζόμενος'}</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Ονοματεπώνυμο *</label>
                <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="π.χ. Γιώργος Παπαδόπουλος" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Ρόλος *</label>
                <input className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} placeholder="π.χ. Sales Manager" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Τμήμα</label>
                <select className={inputCls} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })}>
                  {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Μηνιαίο κόστος (€)</label>
                <input type="number" min={0} className={inputCls} value={form.monthlyCost} onChange={(e) => setForm({ ...form, monthlyCost: Number(e.target.value) })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Ημ/νία έναρξης</label>
                <input type="date" className={inputCls} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Email</label>
                <input type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="optional" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Κατάσταση</label>
                <select className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EmployeeStatus })}>
                  <option value="active">Ενεργός</option>
                  <option value="inactive">Ανενεργός</option>
                  <option value="on_leave">Σε άδεια</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[var(--nts-charcoal)]">Σημειώσεις</label>
                <textarea className={`${inputCls} min-h-[60px] resize-none`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setShowModal(false)}>Άκυρο</Button>
              <Button variant="primary" onClick={handleSave} disabled={addEmployee.isPending || updateEmployee.isPending}>
                {addEmployee.isPending || updateEmployee.isPending ? 'Αποθήκευση…' : 'Αποθήκευση'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
