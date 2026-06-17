import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Loader2, Save } from 'lucide-react';
import { useAuth, useBrand, useBrandMembers } from '../../hooks';
import { MembersService } from '../../services/coordination';
import type { BrandDepartment } from '../../types';
import { DEPARTMENT_LABELS } from '../../types';

export function MyDepartmentCard() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { currentBrand } = useBrand();
  const { members, isLoading } = useBrandMembers();
  const [department, setDepartment] = useState<BrandDepartment>('other');
  /** When true, the select reflects a user choice — don't sync from Firestore (avoids a "step back" after refetch). */
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const me = user?.uid ? members.find((m) => m.userId === user.uid) : undefined;

  useEffect(() => {
    if (dirty) return;
    if (me?.department) setDepartment(me.department);
  }, [me?.department, me?.userId, dirty]);

  useEffect(() => {
    setDirty(false);
  }, [currentBrand?.id, user?.uid]);

  const handleSave = async () => {
    if (!currentBrand || !user?.uid) return;
    const value = department;
    setSaving(true);
    setSaved(false);
    try {
      await MembersService.updateDepartment(currentBrand.id, user.uid, value);
      await qc.invalidateQueries({ queryKey: ['members', currentBrand.id] });
      await qc.refetchQueries({ queryKey: ['members', currentBrand.id] });
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      /* noop */
    }
    setSaving(false);
  };

  if (!currentBrand || !user) return null;

  return (
    <div className="p-4 border border-[var(--nts-border-gray)] rounded-xl bg-white">
      <h3 className="font-semibold text-[var(--nts-charcoal)] mb-1 flex items-center gap-2">
        <Building2 size={18} />
        Το τμήμα σας στο {currentBrand.name}
      </h3>
      <p className="text-sm text-[var(--nts-medium-gray)] mb-4">
        Εμφανίζεται στους πίνακες χρηστών και στις ροές συντονισμού. Μπορείτε να το αλλάξετε οποτεδήποτε.
      </p>

      {isLoading && !me ? (
        <div className="flex justify-center py-4">
          <Loader2 size={20} className="animate-spin text-[var(--nts-medium-gray)]" />
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <label className="block flex-1 min-w-0">
            <span className="text-xs font-medium text-[var(--nts-charcoal)]">Τμήμα / ρόλος</span>
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value as BrandDepartment);
                setDirty(true);
                setSaved(false);
              }}
              className="mt-1 w-full px-3 py-2 text-sm bg-white border border-[var(--nts-border-gray)] rounded-lg"
            >
              {Object.entries(DEPARTMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !me || me.department === department}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[var(--nts-accent)] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 sm:shrink-0"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Αποθήκευση
          </button>
        </div>
      )}
      {saved && <p className="text-xs text-green-600 font-medium mt-2">Αποθηκεύτηκε.</p>}
    </div>
  );
}
