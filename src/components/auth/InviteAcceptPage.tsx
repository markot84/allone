import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Loader2 } from 'lucide-react';
import { Button } from '../common';
import { useAuth } from '../../hooks';
import { getInviteByToken, acceptInvite } from '../../services/invites';

interface InviteAcceptPageProps {
  token: string;
  onAccepted: () => void;
}

export function InviteAcceptPage({ token, onAccepted }: InviteAcceptPageProps) {
  const { user } = useAuth();
  const [invite, setInvite] = useState<Awaited<ReturnType<typeof getInviteByToken>>>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getInviteByToken(token)
      .then(setInvite)
      .catch(() => setInvite(null))
      .finally(() => setLoading(false));
  }, [token]);

  const handleAccept = async () => {
    if (!user?.uid || !invite) return;
    setSubmitting(true);
    setError('');
    try {
      await acceptInvite(token, user.uid);
      onAccepted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Σφάλμα');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--nts-light-gray)]">
        <Loader2 size={32} className="animate-spin text-[var(--nts-accent)]" />
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--nts-light-gray)] p-4">
        <div className="bg-white rounded-2xl shadow-lg border border-[var(--nts-border-gray)] p-8 text-center max-w-md">
          <p className="text-[var(--nts-charcoal)] font-medium">Το invite δεν είναι έγκυρο ή έχει λήξει.</p>
          <Button variant="primary" className="mt-4" onClick={() => (window.location.href = '/')}>
            Πήγαινε στην αρχική
          </Button>
        </div>
      </div>
    );
  }

  const brandName = invite.brand?.name ?? invite.brandId;

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[var(--nts-light-gray)] p-4"
      style={{ background: 'linear-gradient(135deg, #f6f8fa 0%, #e9ecef 100%)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-2xl shadow-lg border border-[var(--nts-border-gray)] p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-[#DCFCE7] rounded-xl flex items-center justify-center mx-auto mb-4">
              <CheckCircle size={28} className="text-[#22C55E]" />
            </div>
            <h1 className="text-2xl font-bold text-[var(--nts-charcoal)]">Πρόσκληση σε Brand</h1>
            <p className="text-[var(--nts-medium-gray)] mt-1">
              Σας προσκαλούν να συμμετάσχετε στο <strong>{brandName}</strong>
            </p>
          </div>
          {!user ? (
            <div className="space-y-4">
              <p className="text-sm text-[var(--nts-medium-gray)] text-center">
                Εγγραφείτε νέο λογαριασμό ή συνδεθείτε με υπάρχοντα για να αποδεχτείτε την πρόσκληση στο {brandName}.
              </p>
              <Button
                variant="primary"
                className="w-full"
                onClick={() => {
                  const returnUrl = `/invite/${token}`;
                  window.location.href = `/?returnUrl=${encodeURIComponent(returnUrl)}`;
                }}
              >
                Σύνδεση / Εγγραφή
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {error && <p className="text-sm text-[#EF4444] text-center">{error}</p>}
              <Button
                variant="primary"
                className="w-full"
                onClick={handleAccept}
                disabled={submitting}
              >
                {submitting ? 'Αποδοχή…' : 'Αποδοχή πρόσκλησης'}
              </Button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
