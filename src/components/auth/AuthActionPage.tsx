import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Lock, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { verifyPasswordResetCode, confirmPasswordReset, applyActionCode } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { Button } from '../common';
import { SUPPORT_EMAIL } from '../../config/superAdmins';

interface AuthActionPageProps {
  mode: string;
  oobCode: string;
  onDone: () => void;
}

export function AuthActionPage({ mode, oobCode, onDone }: AuthActionPageProps) {
  if (mode === 'resetPassword') {
    return <ResetPasswordAction oobCode={oobCode} onDone={onDone} />;
  }
  if (mode === 'verifyEmail') {
    return <VerifyEmailAction oobCode={oobCode} onDone={onDone} />;
  }
  return (
    <ActionWrapper>
      <StatusMessage
        type="error"
        title="Μη έγκυρη ενέργεια"
        message="Ο σύνδεσμος δεν είναι έγκυρος ή έχει λήξει."
        onDone={onDone}
      />
    </ActionWrapper>
  );
}

function ResetPasswordAction({ oobCode, onDone }: { oobCode: string; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [status, setStatus] = useState<'verifying' | 'form' | 'success' | 'error'>('verifying');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    verifyPasswordResetCode(auth, oobCode)
      .then((email) => { setEmail(email); setStatus('form'); })
      .catch(() => setStatus('error'));
  }, [oobCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError('Ο κωδικός πρέπει να έχει τουλάχιστον 6 χαρακτήρες'); return; }
    if (password !== confirmPw) { setError('Οι κωδικοί δεν ταιριάζουν'); return; }
    setSubmitting(true);
    try {
      await confirmPasswordReset(auth, oobCode, password);
      setStatus('success');
    } catch {
      setError('Αποτυχία αλλαγής κωδικού. Ο σύνδεσμος μπορεί να έχει λήξει.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ActionWrapper>
      {status === 'verifying' && (
        <div className="text-center py-8">
          <div className="w-8 h-8 border-2 border-[var(--nts-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[var(--nts-medium-gray)] mt-4">Επαλήθευση συνδέσμου...</p>
        </div>
      )}

      {status === 'error' && (
        <StatusMessage
          type="error"
          title="Μη έγκυρος σύνδεσμος"
          message="Ο σύνδεσμος επαναφοράς κωδικού έχει λήξει ή έχει ήδη χρησιμοποιηθεί."
          onDone={onDone}
        />
      )}

      {status === 'success' && (
        <StatusMessage
          type="success"
          title="Ο κωδικός άλλαξε!"
          message="Μπορείτε τώρα να συνδεθείτε με τον νέο σας κωδικό."
          onDone={onDone}
        />
      )}

      {status === 'form' && (
        <>
          <div className="text-center mb-6">
            <h2 className="text-xl font-bold text-[var(--nts-charcoal)]">Νέος κωδικός</h2>
            <p className="text-sm text-[var(--nts-medium-gray)] mt-1">
              για <strong>{email}</strong>
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--nts-charcoal)] mb-1.5">Νέος κωδικός</label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)]" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-[var(--nts-accent)] focus:bg-white"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--nts-charcoal)] mb-1.5">Επιβεβαίωση κωδικού</label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)]" />
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-[var(--nts-accent)] focus:bg-white"
                  autoComplete="new-password"
                />
              </div>
            </div>
            {error && (
              <p className="text-sm text-[#EF4444] bg-[#FEE2E2] rounded-lg px-3 py-2">{error}</p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={submitting}
            >
              {submitting ? 'Αλλαγή...' : 'Αλλαγή κωδικού'}
            </Button>
          </form>
        </>
      )}
    </ActionWrapper>
  );
}

function VerifyEmailAction({ oobCode, onDone }: { oobCode: string; onDone: () => void }) {
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');

  useEffect(() => {
    applyActionCode(auth, oobCode)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [oobCode]);

  return (
    <ActionWrapper>
      {status === 'verifying' && (
        <div className="text-center py-8">
          <div className="w-8 h-8 border-2 border-[var(--nts-accent)] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[var(--nts-medium-gray)] mt-4">Επαλήθευση email...</p>
        </div>
      )}
      {status === 'success' && (
        <StatusMessage type="success" title="Email επαληθεύτηκε!" message="Η διεύθυνση email σας επιβεβαιώθηκε επιτυχώς." onDone={onDone} />
      )}
      {status === 'error' && (
        <StatusMessage type="error" title="Αποτυχία επαλήθευσης" message="Ο σύνδεσμος έχει λήξει ή έχει ήδη χρησιμοποιηθεί." onDone={onDone} />
      )}
    </ActionWrapper>
  );
}

function ActionWrapper({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #f6f8fa 0%, #e9ecef 100%)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-2xl shadow-lg border border-[var(--nts-border-gray)] p-8">
          <div className="text-center mb-6">
            <div className="w-14 h-14 bg-white rounded-xl border-2 border-[var(--nts-accent)] flex items-center justify-center mx-auto mb-4">
              <span className="font-bold text-[var(--nts-accent)] text-xl">P+</span>
            </div>
            <p className="text-xs text-[var(--nts-medium-gray)]">by notthesame.ai</p>
          </div>
          {children}
          <div className="mt-6 pt-4 border-t border-[var(--nts-border-gray)] text-center">
            <p className="text-xs text-[var(--nts-medium-gray)]">
              Υποστήριξη: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[var(--nts-accent)] hover:underline">{SUPPORT_EMAIL}</a>
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function StatusMessage({ type, title, message, onDone }: { type: 'success' | 'error'; title: string; message: string; onDone: () => void }) {
  return (
    <div className="text-center space-y-4">
      <div className={`w-14 h-14 rounded-xl flex items-center justify-center mx-auto ${type === 'success' ? 'bg-[#ECFDF5]' : 'bg-[#FEE2E2]'}`}>
        {type === 'success'
          ? <CheckCircle size={28} className="text-[#10B981]" />
          : <AlertCircle size={28} className="text-[#EF4444]" />}
      </div>
      <div>
        <p className="font-semibold text-[var(--nts-charcoal)]">{title}</p>
        <p className="text-sm text-[var(--nts-medium-gray)] mt-1">{message}</p>
      </div>
      <button
        onClick={onDone}
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--nts-accent)] hover:underline"
      >
        <ArrowLeft size={14} />
        Μετάβαση στην εφαρμογή
      </button>
    </div>
  );
}
