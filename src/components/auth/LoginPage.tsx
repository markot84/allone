import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, ArrowLeft, Send } from 'lucide-react';

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

  const isLoading = loading || submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Εισάγετε email'); return; }
    if (!password) { setError('Εισάγετε κωδικό'); return; }
    if (mode === 'register') {
      if (password.length < 6) { setError('Κωδικός min 6 χαρακτήρες'); return; }
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
      await onSignInWithGoogle();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Σφάλμα Google';
      setError(msg.includes('auth/') ? translateAuthError(msg) : msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#f5f5f7] px-4 py-10">
      {/* Back link */}
      {onBackToLanding && (
        <button
          type="button"
          onClick={onBackToLanding}
          className="mb-6 flex items-center gap-1.5 text-sm text-[#6B7280] hover:text-[#1A1A1A] transition-colors"
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
        <div className="text-center mb-7">
          <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-[var(--nts-accent)] mb-3">
            <span className="font-bold text-white text-base tracking-tight">P+</span>
          </div>
          <h1 className="text-xl font-bold text-[#1A1A1A] tracking-tight">Performance+</h1>
          <p className="text-xs text-[#9CA3AF] mt-0.5">by notthesame.ai</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm p-7">

          {mode === 'forgot' ? (
            resetSent ? (
              /* ── Reset sent ── */
              <div className="text-center space-y-4">
                <div className="w-11 h-11 bg-[#ECFDF5] rounded-xl flex items-center justify-center mx-auto">
                  <Send size={20} className="text-[#10B981]" />
                </div>
                <div>
                  <p className="font-semibold text-[#1A1A1A] text-sm">Email εστάλη!</p>
                  <p className="text-xs text-[#6B7280] mt-1">
                    Ελέγξτε το <strong>{email}</strong> για τον σύνδεσμο.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => { setMode('login'); setResetSent(false); setError(''); }}
                  className="text-xs text-[var(--nts-accent)] hover:underline"
                >
                  ← Επιστροφή στη σύνδεση
                </button>
              </div>
            ) : (
              /* ── Forgot password ── */
              <>
                <p className="text-xs text-[#6B7280] text-center mb-5">
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
                  className="w-full mt-4 text-xs text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
                >
                  ← Επιστροφή
                </button>
              </>
            )
          ) : (
            /* ── Login / Register ── */
            <>
              {/* Tab switcher */}
              <div className="flex gap-1 mb-6 bg-[#F3F4F6] rounded-lg p-1">
                {(['login', 'register'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => { setMode(m); setError(''); }}
                    className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
                      mode === m
                        ? 'bg-white text-[#1A1A1A] shadow-sm'
                        : 'text-[#6B7280] hover:text-[#1A1A1A]'
                    }`}
                  >
                    {m === 'login' ? 'Σύνδεση' : 'Εγγραφή'}
                  </button>
                ))}
              </div>

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
                      className="mt-1.5 text-[10px] text-[var(--nts-accent)] hover:underline float-right"
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
                <div className="flex-1 h-px bg-[#E5E7EB]" />
                <span className="text-[10px] text-[#9CA3AF]">ή</span>
                <div className="flex-1 h-px bg-[#E5E7EB]" />
              </div>

              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl border border-[#E5E7EB] bg-white text-[#1A1A1A] hover:bg-[#F9FAFB] transition-colors disabled:opacity-50 text-sm font-medium"
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
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]">{icon}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full pl-9 pr-4 py-2.5 text-sm bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--nts-accent)]/30 focus:border-[var(--nts-accent)] focus:bg-white transition-all placeholder:text-[#9CA3AF]"
      />
    </div>
  );
}

function SubmitButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="w-full clear-both py-2.5 rounded-xl bg-[var(--nts-accent)] text-white text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}

function ErrorMsg({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-[#EF4444] bg-[#FEF2F2] border border-[#FECACA] rounded-lg px-3 py-2">
      {children}
    </p>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
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
  return msg;
}
