import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Lock, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { verifyPasswordResetCode, confirmPasswordReset, applyActionCode } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { Button, AllOneLogo } from '../common';
import { SUPPORT_EMAIL } from '../../config/superAdmins';
import { validatePassword } from '../../utils/passwordPolicy';

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
    const pwError = validatePassword(password);
    if (pwError) { setError(pwError); return; }
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
              <p className="text-sm text-[var(--danger-600)] bg-[var(--danger-light)] rounded-lg px-3 py-2">{error}</p>
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
      style={{ background: 'var(--surface-2)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="bg-white rounded-2xl shadow-lg border border-[var(--nts-border-gray)] p-8">
          <div className="flex justify-center mb-6">
            <AllOneLogo height={44} className="mx-auto" />
          </div>
          {children}
          <div className="mt-6 pt-4 border-t border-[var(--nts-border-gray)] text-center">
            <p className="text-xs text-[var(--nts-medium-gray)]">
              Υποστήριξη: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[var(--nts-accent-text)] hover:underline">{SUPPORT_EMAIL}</a>
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
      <div className={`w-14 h-14 rounded-xl flex items-center justify-center mx-auto ${type === 'success' ? 'bg-[var(--success-light)]' : 'bg-[var(--danger-light)]'}`}>
        {type === 'success'
          ? <CheckCircle size={28} className="text-[var(--success-700)]" />
          : <AlertCircle size={28} className="text-[var(--danger-600)]" />}
      </div>
      <div>
        <p className="font-semibold text-[var(--nts-charcoal)]">{title}</p>
        <p className="text-sm text-[var(--nts-medium-gray)] mt-1">{message}</p>
      </div>
      <button
        onClick={onDone}
        className="inline-flex items-center gap-2 text-sm font-medium text-[var(--nts-accent-text)] hover:underline"
      >
        <ArrowLeft size={14} />
        Μετάβαση στην εφαρμογή
      </button>
    </div>
  );
}
