import { useState } from 'react';
import { UserPlus, Mail, CheckCircle2 } from 'lucide-react';
import { Button } from '../common';
import { createInvite } from '../../services/invites';
import { APP_URL, auth, FUNCTIONS_BASE_URL, getAppCheckHeader } from '../../config/firebase';
import { useAuth } from '../../hooks';
import { useBrand } from '../../hooks';
import type { BrandDepartment } from '../../types';
import { DEPARTMENT_LABELS } from '../../types';

interface InviteUserCardProps {
  onInviteCreated?: (link: string) => void;
}

export function InviteUserCard({ onInviteCreated }: InviteUserCardProps) {
  const { user } = useAuth();
  const { currentBrand } = useBrand();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [department, setDepartment] = useState<BrandDepartment>('other');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailSendNote, setEmailSendNote] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setEmailSent(false);
    setEmailSendNote(null);
    if (!currentBrand || !user?.uid) {
      setError('Επιλέξτε brand');
      return;
    }
    setSubmitting(true);
    try {
      const { token } = await createInvite(currentBrand.id, email.trim(), role, user.uid, department);
      const link = `${APP_URL.replace(/\/$/, '')}/invite/${token}`;
      setInviteLink(link);
      onInviteCreated?.(link);

      if (email.trim()) {
        try {
          const idToken = await auth.currentUser?.getIdToken();
          if (idToken) {
            const deptLabel = DEPARTMENT_LABELS[department] || '';
            const inviteUrl = `${FUNCTIONS_BASE_URL.replace(/\/$/, '')}/sendInviteEmail`;
            const appCheck = await getAppCheckHeader();
            const res = await fetch(inviteUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${idToken}`,
                ...appCheck,
              },
              body: JSON.stringify({
                to: email.trim(),
                brandId: currentBrand.id,
                brandName: currentBrand.name,
                inviteLink: link,
                role,
                department: deptLabel,
              }),
            });
            const json = (await res.json().catch(() => ({}))) as {
              ok?: boolean;
              reason?: string;
            };
            if (res.ok && json.ok === true) {
              setEmailSent(true);
            } else if (json.reason === 'smtp_not_configured') {
              setEmailSendNote(
                'Το email δεν στάλθηκε: δεν είναι ρυθμισμένο SMTP στο backend (Firebase secrets SMTP_EMAIL / SMTP_PASSWORD). Χρησιμοποιήστε το link παρακάτω ή ρυθμίστε τα secrets και ξαναδοκιμάστε.'
              );
            } else {
              setEmailSendNote(
                `Αποτυχία αποστολής email (${res.status}). Το link παραμένει έγκυρο — αντιγράψτε το χειροκίνητα.`
              );
            }
          }
        } catch {
          setEmailSendNote('Σφάλμα δικτύου κατά την αποστολή email. Αντιγράψτε το link παρακάτω.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Σφάλμα');
    } finally {
      setSubmitting(false);
    }
  };

  if (!currentBrand) return null;

  return (
    <div className="p-4 border border-[var(--nts-border-gray)] rounded-xl bg-[var(--nts-light-gray)]">
      <h4 className="font-semibold text-[var(--nts-charcoal)] mb-3 flex items-center gap-2">
        <UserPlus size={18} />
        Καλέστε χρήστη στο {currentBrand.name}
      </h4>
      <p className="text-sm text-[var(--nts-medium-gray)] mb-4">
        Στείλτε το link σε νέους ή υπάρχοντες χρήστες. Μπορούν να εγγραφούν ή να συνδεθούν και θα προστεθούν στο brand.
      </p>
      {inviteLink ? (
        <div className="space-y-2">
          {emailSent && (
            <div className="flex items-center gap-2 p-2.5 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 size={16} className="text-green-600 flex-shrink-0" />
              <p className="text-xs text-green-700">
                Email πρόσκλησης εστάλη στο <strong>{email}</strong>
              </p>
            </div>
          )}
          {emailSendNote && (
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 leading-relaxed">
              {emailSendNote}
            </div>
          )}
          <p className="text-sm text-[var(--nts-medium-gray)]">Invite link:</p>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={inviteLink}
              className="flex-1 px-3 py-2 text-sm bg-white border border-[var(--nts-border-gray)] rounded-lg"
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigator.clipboard.writeText(inviteLink)}
            >
              Αντιγραφή
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { setInviteLink(''); setEmail(''); setEmailSent(false); setEmailSendNote(null); setDepartment('other'); }}>
            Νέο invite
          </Button>
        </div>
      ) : (
        <form onSubmit={handleCreate} className="space-y-3">
          {/* Department */}
          <label className="block">
            <span className="text-xs font-medium text-[var(--nts-charcoal)]">Τμήμα / Ρόλος</span>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value as BrandDepartment)}
              className="mt-1 w-full px-3 py-2 text-sm bg-white border border-[var(--nts-border-gray)] rounded-lg"
            >
              {Object.entries(DEPARTMENT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          {/* Role */}
          <label className="block">
            <span className="text-xs font-medium text-[var(--nts-charcoal)]">Δικαιώματα</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm bg-white border border-[var(--nts-border-gray)] rounded-lg"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          {/* Email */}
          <label className="block">
            <span className="text-xs font-medium text-[var(--nts-charcoal)]">Email χρήστη</span>
            <div className="relative mt-1">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@example.com"
                className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-[var(--nts-border-gray)] rounded-lg"
              />
            </div>
            <span className="text-[10px] text-[var(--nts-medium-gray)] mt-0.5 block">
              Θα σταλεί email πρόσκλησης αυτόματα. Αφήστε κενό για link μόνο.
            </span>
          </label>

          {error && <p className="text-sm text-[#EF4444]">{error}</p>}

          <div className="pt-1">
            <Button type="submit" variant="primary" size="sm" disabled={submitting} className="w-full">
              {submitting ? 'Αποστολή…' : email.trim() ? 'Αποστολή πρόσκλησης' : 'Δημιουργία link'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
