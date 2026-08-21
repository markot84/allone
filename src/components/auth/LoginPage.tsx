import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowLeft, Send } from 'lucide-react';
import { AllOneLogo } from '../common';
import { validatePassword } from '../../utils/passwordPolicy';

interface LoginPageProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
  onSignInWithGoogle: (options?: { allowNewUsers?: boolean }) => Promise<void>;
  /** Email/password registration: only in open mode or invite flow */
  allowEmailRegister: boolean;
  /** New Google accounts: same policy as email registration */
  allowGoogleNewUsers: boolean;
  onResetPassword?: (email: string) => Promise<void>;
  loading?: boolean;
  onBackToLanding?: () => void;
}

export function LoginPage({
  onSignIn,
  onSignUp,
  onSignInWithGoogle,
  allowEmailRegister,
  allowGoogleNewUsers,
  onResetPassword,
  loading = false,
  onBackToLanding,
}: LoginPageProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!allowEmailRegister && mode === 'register') setMode('login');
  }, [allowEmailRegister, mode]);

  const isLoading = loading || submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Εισάγετε email'); return; }
    if (!password) { setError('Εισάγετε κωδικό'); return; }
    if (mode === 'register') {
      if (!allowEmailRegister) { setError('Η εγγραφή με email δεν είναι διαθέσιμη.'); return; }
      const pwError = validatePassword(password);
      if (pwError) { setError(pwError); return; }
      if (password !== confirmPassword) { setError('Οι κωδικοί δεν ταιριάζουν'); return; }
    }
    setSubmitting(true);
    try {
      if (mode === 'login') await onSignIn(email.trim(), password);
      else await onSignUp(email.trim(), password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Σφάλμα σύνδεσης';
      setError(msg.includes('auth/') ? translateAuthError(msg) : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Εισάγετε email'); return; }
    setSubmitting(true);
    try {
      await onResetPassword?.(email.trim());
      setResetSent(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Σφάλμα αποστολής';
      setError(msg.includes('auth/') ? translateAuthError(msg) : msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setSubmitting(true);
    try {
      await onSignInWithGoogle({ allowNewUsers: allowGoogleNewUsers });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Σφάλμα Google';
      setError(msg.includes('auth/') ? translateAuthError(msg) : msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--surface-2)] px-4 py-10">
      {/* Back link */}
      {onBackToLanding && (
        <button
          type="button"
          onClick={onBackToLanding}
          className="mb-6 flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <ArrowLeft size={14} />
          Επιστροφή
        </button>
      )}

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-[360px]"
      >
        {/* Logo */}
        <div className="flex justify-center mb-7">
          <AllOneLogo height={48} className="mx-auto" />
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-[var(--border)] shadow-sm p-7">

          {mode === 'forgot' ? (
            resetSent ? (
              /* ── Reset sent ── */
              <div className="text-center space-y-4">
                <div className="w-11 h-11 bg-[var(--success-light)] rounded-xl flex items-center justify-center mx-auto">
                  <Send size={20} className="text-[var(--success-700)]" />
                </div>
                <div>
                  <p className="font-semibold text-[var(--text-primary)] text-sm">Email εστάλη!</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    Ελέγξτε το <strong>{email}</strong> για τον σύνδεσμο.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setMode('login'); setResetSent(false); setError(''); }}
                  className="text-xs text-[var(--nts-accent-text)] hover:underline"
                >
                  ← Επιστροφή στη σύνδεση
                </button>
              </div>
            ) : (
              /* ── Forgot password ── */
              <>
                <p className="text-xs text-[var(--text-muted)] text-center mb-5">
                  Εισάγετε το email σας για να λάβετε σύνδεσμο επαναφοράς.
                </p>
                <form onSubmit={handleResetPassword} className="space-y-3">
                  <InputField
                    icon={<Mail size={15} />}
                    type="email"
                    placeholder="email@example.com"
                    value={email}
                    onChange={setEmail}
                    autoComplete="email"
                  />
                  {error && <ErrorMsg>{error}</ErrorMsg>}
                  <SubmitButton disabled={isLoading}>
                    {isLoading ? 'Αποστολή…' : 'Αποστολή συνδέσμου'}
                  </SubmitButton>
                </form>
                <button
                  type="button"
                  onClick={() => { setMode('login'); setError(''); }}
                  className="w-full mt-4 text-xs text-[var(--text-muted)] hover:text-[var(--text-muted)] transition-colors"
                >
                  ← Επιστροφή
                </button>
              </>
            )
          ) : (
            /* ── Login / Register ── */
            <>
              {allowEmailRegister ? (
                <div className="flex gap-1 mb-6 bg-[var(--surface-2)] rounded-lg p-1">
                  {(['login', 'register'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => { setMode(m); setError(''); }}
                      className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                        mode === m
                          ? 'bg-white text-[var(--text-primary)] shadow-sm'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {m === 'login' ? 'Σύνδεση' : 'Εγγραφή'}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-[var(--text-muted)] text-center mb-5 leading-relaxed">
                  Πρόσβαση έχουν μόνο <strong className="text-[var(--text-secondary)]">ενεργοί λογαριασμοί</strong> (εγκεκριμένοι χρήστες).
                  Νέα μέλη ενεργοποιούνται μόνο αφού λάβουν <strong className="text-[var(--text-secondary)]">πρόσκληση</strong>, αποδεχτούν τον σύνδεσμο και ολοκληρώσουν την εγγραφή.
                  Σύνδεση με email ή Google για λογαριασμό που έχει ήδη δημιουργηθεί.
                </p>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                <InputField
                  icon={<Mail size={15} />}
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={setEmail}
                  autoComplete="email"
                />
                <div>
                  <InputField
                    icon={<Lock size={15} />}
                    type="password"
                    placeholder="Κωδικός"
                    value={password}
                    onChange={setPassword}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                  {mode === 'login' && onResetPassword && (
                    <button
                      type="button"
                      onClick={() => { setMode('forgot'); setError(''); setResetSent(false); }}
                      className="mt-1.5 text-[10px] text-[var(--nts-accent-text)] hover:underline float-right"
                    >
                      Ξεχάσατε τον κωδικό;
                    </button>
                  )}
                </div>
                {mode === 'register' && (
                  <InputField
                    icon={<Lock size={15} />}
                    type="password"
                    placeholder="Επιβεβαίωση κωδικού"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    autoComplete="new-password"
                  />
                )}
                {error && <ErrorMsg>{error}</ErrorMsg>}
                <SubmitButton disabled={isLoading}>
                  {isLoading
                    ? 'Παρακαλώ περιμένετε…'
                    : mode === 'login' ? 'Σύνδεση' : 'Δημιουργία λογαριασμού'}
                </SubmitButton>
              </form>

              <div className="my-5 flex items-center gap-3">
                <div className="flex-1 h-px bg-[var(--border)]" />
                <span className="text-[10px] text-[var(--text-muted)]">ή</span>
                <div className="flex-1 h-px bg-[var(--border)]" />
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl border border-[var(--border)] bg-white text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors disabled:opacity-50 text-sm font-medium"
              >
                <GoogleIcon />
                Σύνδεση με Google
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

/* ── Shared sub-components ── */

function InputField({
  icon, type, placeholder, value, onChange, autoComplete,
}: {
  icon: React.ReactNode;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">{icon}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full pl-9 pr-4 py-2.5 text-sm bg-[var(--surface-2)] border border-[var(--border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]/30 focus:border-[var(--nts-accent)] focus:bg-white transition-all placeholder:text-[var(--text-muted)]"
      />
    </div>
  );
}

function SubmitButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full clear-both py-2.5 rounded-xl btn-gold text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-[var(--danger-600)] bg-[var(--danger-light)] border border-[var(--danger-light)] rounded-lg px-3 py-2">
      {children}
    </p>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
      {/* Google's own mark — its four colours are the logo, not a palette choice. */}
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function translateAuthError(msg: string): string {
  if (msg.includes('auth/user-not-found') || msg.includes('auth/invalid-credential')) return 'Λάθος email ή κωδικός';
  if (msg.includes('auth/email-already-in-use')) return 'Υπάρχει ήδη λογαριασμός με αυτό το email';
  if (msg.includes('auth/weak-password')) return 'Ο κωδικός είναι πολύ αδύναμος';
  if (msg.includes('auth/invalid-email')) return 'Μη έγκυρο email';
  if (msg.includes('auth/popup-closed-by-user')) return 'Άκυρη η σύνδεση με Google';
  if (msg.includes('auth/too-many-requests')) return 'Πολλές προσπάθειες. Δοκιμάστε αργότερα.';
  if (msg.includes('auth/missing-email')) return 'Εισάγετε email';
  if (msg.includes('auth/signup-disabled')) return 'Δεν επιτρέπεται νέος λογαριασμός. Χρησιμοποιήστε πρόσκληση ή συνδεθείτε με υπάρχον email.';
  return msg;
}
