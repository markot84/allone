import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, LogIn, ArrowLeft, Send } from 'lucide-react';
import { Button } from '../common';

interface LoginPageProps {
  onSignIn: (email: string, password: string) => Promise<void>;
  onSignUp: (email: string, password: string) => Promise<void>;
  onSignInWithGoogle: () => Promise<void>;
  onResetPassword?: (email: string) => Promise<void>;
  loading?: boolean;
  onBackToLanding?: () => void;
}

export function LoginPage({
  onSignIn,
  onSignUp,
  onSignInWithGoogle,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Εισάγετε email');
      return;
    }
    if (!password) {
      setError('Εισάγετε κωδικό');
      return;
    }
    if (mode === 'register') {
      if (password.length < 6) {
        setError('Κωδικός min 6 χαρακτήρες');
        return;
      }
      if (password !== confirmPassword) {
        setError('Οι κωδικοί δεν ταιριάζουν');
        return;
      }
    }
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await onSignIn(email.trim(), password);
      } else {
        await onSignUp(email.trim(), password);
      }
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
    if (!email.trim()) {
      setError('Εισάγετε email');
      return;
    }
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
      await onSignInWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Σφάλμα Google';
      setError(msg.includes('auth/') ? translateAuthError(msg) : msg);
    } finally {
      setSubmitting(false);
    }
  };

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
        {onBackToLanding && (
          <button
            type="button"
            onClick={onBackToLanding}
            className="mb-3 text-sm text-[var(--nts-medium-gray)] transition-colors hover:text-[var(--nts-charcoal)]"
          >
            ← Επιστροφή στην αρχική
          </button>
        )}
        <div className="bg-white rounded-2xl shadow-lg border border-[var(--nts-border-gray)] p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 bg-white rounded-xl border-2 border-[var(--nts-accent)] flex items-center justify-center mx-auto mb-4">
              <span className="font-bold text-[var(--nts-accent)] text-xl">P+</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--nts-charcoal)]">Performance+</h1>
            <p className="text-[var(--nts-medium-gray)] mt-1">by notthesame.ai</p>
          </div>

          {mode === 'forgot' ? (
            /* ── Forgot Password View ── */
            <>
              {resetSent ? (
                <div className="text-center space-y-4">
                  <div className="w-14 h-14 bg-[#ECFDF5] rounded-xl flex items-center justify-center mx-auto">
                    <Send size={24} className="text-[#10B981]" />
                  </div>
                  <div>
                    <p className="text-[var(--nts-charcoal)] font-semibold">Email εστάλη!</p>
                    <p className="text-sm text-[var(--nts-medium-gray)] mt-1">
                      Ελέγξτε το <strong>{email}</strong> για τον σύνδεσμο επαναφοράς κωδικού.
                    </p>
                    <p className="text-xs text-[var(--nts-medium-gray)] mt-2">
                      Αν δεν βρείτε το email, ελέγξτε τον φάκελο spam.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setResetSent(false); setError(''); }}
                    className="flex items-center justify-center gap-2 mx-auto text-sm font-medium text-[var(--nts-accent)] hover:underline"
                  >
                    <ArrowLeft size={14} />
                    Επιστροφή στη σύνδεση
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-[var(--nts-medium-gray)] mb-5 text-center">
                    Εισάγετε το email σας και θα λάβετε σύνδεσμο για επαναφορά κωδικού.
                  </p>
                  <form onSubmit={handleResetPassword} className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-[var(--nts-charcoal)] mb-1.5">Email</label>
                      <div className="relative">
                        <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)]" />
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="email@example.com"
                          className="w-full min-w-0 pl-10 pr-4 py-2.5 bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-[var(--nts-accent)] focus:bg-white"
                          autoComplete="email"
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
                      icon={<Send size={16} />}
                      disabled={submitting}
                    >
                      {submitting ? 'Αποστολή...' : 'Αποστολή συνδέσμου'}
                    </Button>
                  </form>
                  <button
                    type="button"
                    onClick={() => { setMode('login'); setError(''); }}
                    className="w-full mt-4 flex items-center justify-center gap-2 text-sm text-[var(--nts-medium-gray)] hover:text-[var(--nts-charcoal)] transition-colors"
                  >
                    <ArrowLeft size={14} />
                    Επιστροφή στη σύνδεση
                  </button>
                </>
              )}
            </>
          ) : (
            /* ── Login / Register View ── */
            <>
          <div className="flex gap-2 mb-6">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === 'login'
                  ? 'bg-[var(--nts-accent)] text-white'
                  : 'bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)] hover:bg-[#E5E5E5]'
              }`}
            >
              Σύνδεση
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(''); }}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${
                mode === 'register'
                  ? 'bg-[var(--nts-accent)] text-white'
                  : 'bg-[var(--nts-light-gray)] text-[var(--nts-medium-gray)] hover:bg-[#E5E5E5]'
              }`}
            >
              Εγγραφή
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[var(--nts-charcoal)] mb-1.5">Email</label>
              <div className="relative">
                <Mail size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)]" />
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="email@example.com"
                  className="w-full min-w-0 pl-10 pr-4 py-2.5 bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-[var(--nts-accent)] focus:bg-white"
                  autoComplete="email"
                />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-[var(--nts-charcoal)]">Κωδικός</label>
                {mode === 'login' && onResetPassword && (
                  <button
                    type="button"
                    onClick={() => { setMode('forgot'); setError(''); setResetSent(false); }}
                    className="text-xs text-[var(--nts-accent)] hover:underline"
                  >
                    Ξεχάσατε τον κωδικό;
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)]" />
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-w-0 pl-10 pr-4 py-2.5 bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-[var(--nts-accent)] focus:bg-white"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
              </div>
            </div>
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-[var(--nts-charcoal)] mb-1.5">Επιβεβαίωση κωδικού</label>
                <div className="relative">
                  <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--nts-medium-gray)]" />
                  <input
                    id="login-confirm-password"
                    name="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-w-0 pl-10 pr-4 py-2.5 bg-[var(--nts-light-gray)] border border-[var(--nts-border-gray)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)] focus:border-[var(--nts-accent)] focus:bg-white"
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}
            {error && (
              <p className="text-sm text-[#EF4444] bg-[#FEE2E2] rounded-lg px-3 py-2">{error}</p>
            )}
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              icon={<LogIn size={16} />}
              disabled={loading || submitting}
            >
              {mode === 'login' ? 'Σύνδεση' : 'Εγγραφή'}
            </Button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--nts-border-gray)]" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-white text-[var(--nts-medium-gray)]">ή</span>
              </div>
            </div>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading || submitting}
              className="w-full mt-4 flex items-center justify-center gap-3 py-2.5 px-4 rounded-lg border border-[var(--nts-border-gray)] bg-white text-[var(--nts-charcoal)] hover:bg-[var(--nts-light-gray)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm"
            >
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Σύνδεση με Google</span>
            </button>
          </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
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
  return msg;
}
