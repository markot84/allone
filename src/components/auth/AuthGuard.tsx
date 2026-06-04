import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { useAuth } from '../../hooks';
import { getPublicSignupMode, isInviteReturnUrl } from '../../config/authAccess';
import { BrandProvider } from '../../contexts/BrandContext';
import { GlobalDateProvider } from '../../contexts/GlobalDateContext';
import { BrandOnboarding } from './BrandOnboarding';
import { LoginPage } from './LoginPage';
import { MarketingIndexPage } from './MarketingIndexPage';
import { Spinner } from '../common';

interface AuthGuardProps {
  children: ReactNode;
}

export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading, signIn, signUp, signInWithGoogle, resetPassword } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const showAuth = params.get('auth') === '1' || params.get('auth') === 'true';
  const forceLandingPreview = params.get('landing') === '1' || params.get('landing') === 'true';
  const landingVariant = params.get('lp') === 'ops' ? 'ops' : 'ceo';
  const returnUrlParam = params.get('returnUrl');
  const signupOpen = getPublicSignupMode() === 'open';
  const fromInvite = isInviteReturnUrl(returnUrlParam);
  const allowEmailRegister = signupOpen || fromInvite;
  const allowGoogleNewUsers = signupOpen || fromInvite;

  // Redirect to returnUrl after login (e.g. /invite/:token).
  // SECURITY (CWE-601 open redirect): only same-origin RELATIVE paths are honored.
  // Reject protocol-relative (//host), backslash (/\host), absolute, and
  // javascript: targets lexically, then re-verify by resolving against our origin
  // and navigate to the reconstructed same-origin path — so a crafted returnUrl
  // can never bounce the user off-site or execute a javascript: URI.
  useEffect(() => {
    if (!user || loading) return;
    const returnUrl = new URLSearchParams(window.location.search).get('returnUrl');
    if (!returnUrl || !returnUrl.startsWith('/') || returnUrl.startsWith('//') || returnUrl.startsWith('/\\')) return;
    try {
      const resolved = new URL(returnUrl, window.location.origin);
      if (resolved.origin === window.location.origin) {
        window.location.href = resolved.pathname + resolved.search + resolved.hash;
      }
    } catch {
      /* malformed returnUrl — ignore */
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
    if (!showAuth) {
      return (
        <MarketingIndexPage
          variant={landingVariant}
          onVariantChange={(variant) => {
            const next = new URLSearchParams(window.location.search);
            next.set('lp', variant);
            const query = next.toString();
            window.location.href = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
          }}
          onOpenAuth={() => {
            const next = new URLSearchParams(window.location.search);
            next.set('auth', '1');
            const query = next.toString();
            window.location.href = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
          }}
        />
      );
    }

    return (
      <LoginPage
        onSignIn={signIn}
        onSignUp={signUp}
        onSignInWithGoogle={signInWithGoogle}
        allowEmailRegister={allowEmailRegister}
        allowGoogleNewUsers={allowGoogleNewUsers}
        onResetPassword={resetPassword}
        onBackToLanding={() => {
          const next = new URLSearchParams(window.location.search);
          next.delete('auth');
          const query = next.toString();
          window.location.href = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
        }}
      />
    );
  }

  if (forceLandingPreview) {
    return (
      <MarketingIndexPage
        variant={landingVariant}
        onVariantChange={(variant) => {
          const next = new URLSearchParams(window.location.search);
          next.set('lp', variant);
          next.set('landing', '1');
          const query = next.toString();
          window.location.href = `${window.location.pathname}${query ? `?${query}` : ''}`;
        }}
        onReturnToApp={() => {
          const next = new URLSearchParams(window.location.search);
          next.delete('landing');
          next.delete('auth');
          const query = next.toString();
          window.location.href = `${window.location.pathname}${query ? `?${query}` : ''}#dashboard`;
        }}
      />
    );
  }

  return (
    <BrandProvider>
      <GlobalDateProvider>
        <BrandOnboarding>{children}</BrandOnboarding>
      </GlobalDateProvider>
    </BrandProvider>
  );
}
