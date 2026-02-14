import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '../common';
import { createInvite } from '../../services/invites';
import { APP_URL } from '../../config/firebase';
import { useAuth } from '../../hooks';
import { useBrand } from '../../hooks';

interface InviteUserCardProps {
  onInviteCreated?: (link: string) => void;
}

export function InviteUserCard({ onInviteCreated }: InviteUserCardProps) {
  const { user } = useAuth();
  const { currentBrand } = useBrand();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!currentBrand || !user?.uid) {
      setError('Επιλέξτε brand');
      return;
    }
    setSubmitting(true);
    try {
      const { token } = await createInvite(currentBrand.id, email.trim(), role, user.uid);
      const link = `${APP_URL.replace(/\/$/, '')}/invite/${token}`;
      setInviteLink(link);
      onInviteCreated?.(link);
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
          <Button variant="ghost" size="sm" onClick={() => setInviteLink('')}>
            Νέο invite
          </Button>
        </div>
      ) : (
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="flex gap-2 flex-wrap">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={submitting}
              onClick={() => handleCreate({ preventDefault: () => {} } as React.FormEvent)}
            >
              Δημιουργία link
            </Button>
          </div>
          <p className="text-xs text-[var(--nts-medium-gray)]">Ή συμπληρώστε email για audit:</p>
          <input
            id="invite-email"
            name="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com (προαιρετικό)"
            className="w-full px-3 py-2 text-sm bg-white border border-[var(--nts-border-gray)] rounded-lg"
          />
          <select
            id="invite-role"
            name="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-[var(--nts-border-gray)] rounded-lg"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          {error && <p className="text-sm text-[#EF4444]">{error}</p>}
          <Button type="submit" variant="primary" size="sm" disabled={submitting}>
            Δημιουργία invite
          </Button>
        </form>
      )}
    </div>
  );
}
