import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useAuth } from '../../hooks';
import { BrandProvider } from '../../contexts/BrandContext';
import { BrandOnboarding } from './BrandOnboarding';
import { LoginPage } from './LoginPage';
import { Spinner } from '../common';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading, signIn, signUp, signInWithGoogle } = useAuth();

  // Redirect to returnUrl after login (e.g. /invite/:token)
  useEffect(() => {
    if (!user || loading) return;
    const params = new URLSearchParams(window.location.search);
    const returnUrl = params.get('returnUrl');
    if (returnUrl && returnUrl.startsWith('/')) {
      window.location.href = returnUrl;
    }
  }, [user, loading]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--nts-light-gray)]">
        <Spinner size="lg" label="Φόρτωση…" />
      </div>
    );
  }

  if (!user) {
    return (
      <LoginPage
        onSignIn={signIn}
        onSignUp={signUp}
        onSignInWithGoogle={signInWithGoogle}
      />
    );
  }

  return (
    <BrandProvider>
      <BrandOnboarding>{children}</BrandOnboarding>
    </BrandProvider>
  );
}
