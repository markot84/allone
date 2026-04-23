import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, Loader2 } from 'lucide-react';
import { PerformancePlusLogo } from '../common';
import { useAuth } from '../../hooks';
import { getInviteByToken, acceptInvite } from '../../services/invites';

interface InviteAcceptPageProps {
  token: string;
  onAccepted: () => void;
}

export function InviteAcceptPage({ token, onAccepted }: InviteAcceptPageProps) {
  const { user, loading: authLoading } = useAuth();
  const [invite, setInvite] = useState<Awaited<ReturnType<typeof getInviteByToken>>>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    getInviteByToken(token)
      .then(setInvite)
      .catch((err) => {
        console.error('Invite fetch error:', err);
        setInvite(null);
      })
      .finally(() => setLoading(false));
  }, [token, authLoading]);

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

  if (loading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7]">
        <Loader2 size={28} className="animate-spin text-[var(--nts-accent)]" />
      </div>
    );
  }

  if (!invite) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f7] p-4">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-[360px] bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-7 text-center"
        >
          <p className="text-sm text-[#1A1A1A] font-medium">
            Το invite δεν βρέθηκε, έχει ήδη χρησιμοποιηθεί ή έχει λήξει.
          </p>
          <p className="text-xs text-[#6B7280] mt-2">
            Ζητήστε νέα πρόσκληση από τον διαχειριστή του brand.
          </p>
          <button
            onClick={() => (window.location.href = '/')}
            className="mt-4 w-full py-2.5 rounded-xl bg-[var(--nts-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            Αρχική σελίδα
          </button>
        </motion.div>
      </div>
    );
  }

  const brandName = invite.brand?.name ?? invite.brandId;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f7] px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-[360px]"
      >
        {/* Logo */}
        <div className="flex justify-center mb-7">
          <PerformancePlusLogo height={48} className="mx-auto" />
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-7">
          <div className="text-center mb-6">
            <div className="w-11 h-11 bg-[#DCFCE7] rounded-xl flex items-center justify-center mx-auto mb-3">
              <CheckCircle size={22} className="text-[#22C55E]" />
            </div>
            <h2 className="text-base font-bold text-[#1A1A1A]">Πρόσκληση σε Brand</h2>
            <p className="text-xs text-[#6B7280] mt-1">
              Προσκαλείστε να συμμετάσχετε στο <strong className="text-[#1A1A1A]">{brandName}</strong>
            </p>
          </div>

          {!user ? (
            <div className="space-y-3">
              <p className="text-xs text-[#6B7280] text-center">
                Συνδεθείτε ή δημιουργήστε λογαριασμό για να αποδεχτείτε την πρόσκληση.
              </p>
              <button
                onClick={() => {
                  const returnUrl = `/invite/${token}`;
                  window.location.href = `/?auth=1&returnUrl=${encodeURIComponent(returnUrl)}`;
                }}
                className="w-full py-2.5 rounded-xl bg-[var(--nts-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Σύνδεση / Εγγραφή
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {error && (
                <p className="text-xs text-[#EF4444] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2 text-center">
                  {error}
                </p>
              )}
              <button
                onClick={handleAccept}
                disabled={submitting}
                className="w-full py-2.5 rounded-xl bg-[var(--nts-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Αποδοχή…' : 'Αποδοχή πρόσκλησης'}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
