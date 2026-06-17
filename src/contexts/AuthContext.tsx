import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode
} from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendPasswordResetEmail,
  linkWithCredential,
  linkWithPopup,
  EmailAuthProvider,
  GoogleAuthProvider,
  getAdditionalUserInfo,
  type User
} from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { auth, getAppUrl } from '../config/firebase';
import { getPublicSignupMode, isInviteReturnUrl } from '../config/authAccess';
import { validatePassword } from '../utils/passwordPolicy';
import { setCurrentUid } from '../utils/authState';
import { logger } from '../utils/logger';
import { CLIENT_ALERT } from '../utils/alertKeys';
import { FirestoreService } from '../services/firestore';
import { loadSuperAdmins } from '../services/appConfig';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isSuperAdmin: boolean;
  /** false until the async super-admin lookup settles; consumers branching on
   *  `isSuperAdmin` should wait to avoid rendering the wrong branch first. */
  isSuperAdminResolved: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  /** allowNewUsers: if false, new Google accounts are rejected (sign out + error). */
  signInWithGoogle: (options?: { allowNewUsers?: boolean }) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  linkPassword: (password: string) => Promise<void>;
  linkGoogle: () => Promise<void>;
  hasPasswordProvider: boolean;
  hasGoogleProvider: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isSuperAdminResolved, setIsSuperAdminResolved] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      // Feed the client logger so every log line carries the current uid (src/utils/authState.ts).
      setCurrentUid(u?.uid ?? null);
    });
    return () => unsubscribe();
  }, []);

  // Ensure user profile exists in Firestore on first sign-in.
  useEffect(() => {
    if (!user?.uid) return;
    const ensureProfile = async () => {
      const existing = await FirestoreService.getDocument('users', user.uid);
      if (!existing) {
        // Don't set brandIds here — acceptInvite may have run first; setting []
        // would overwrite invite data. Leave brandIds for acceptInvite/BrandCreateForm.
        await FirestoreService.setDocument('users', user.uid, {
          id: user.uid,
          email: user.email ?? '',
          displayName: user.displayName ?? null,
          createdAt: Timestamp.now(),
        } as Record<string, unknown>);
      }
    };
    ensureProfile().catch((err) => logger.error('ensureProfile failed', { alertKey: CLIENT_ALERT.authActionFailed, err }));
  }, [user?.uid]);

  // Resolve super-admin flag from Firestore appConfig/superAdmins.uids
  // (same doc the Firestore rules read).
  useEffect(() => {
    if (!user?.uid) {
      setIsSuperAdmin(false);
      setIsSuperAdminResolved(true); // nothing to resolve when signed out
      return;
    }
    let cancelled = false;
    setIsSuperAdminResolved(false); // re-resolving for this user
    loadSuperAdmins()
      .then((sa) => {
        if (!cancelled) {
          setIsSuperAdmin(sa.uids.includes(user.uid));
          setIsSuperAdminResolved(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsSuperAdmin(false);
          setIsSuperAdminResolved(true);
        }
      });
    return () => { cancelled = true; };
  }, [user?.uid]);

  /** Always allowed for existing accounts — the signup policy does not apply here. */
  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const ret = qs?.get('returnUrl') || '';
    const allowed = getPublicSignupMode() === 'open' || isInviteReturnUrl(ret);
    if (!allowed) {
      throw new Error('auth/signup-disabled');
    }
    const pwError = validatePassword(password);
    if (pwError) throw new Error(pwError);
    await createUserWithEmailAndPassword(auth, email, password);
  }, []);

  const signInWithGoogle = useCallback(async (options?: { allowNewUsers?: boolean }) => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const allowNew = options?.allowNewUsers === true;
    const extra = getAdditionalUserInfo(result);
    if (extra?.isNewUser && !allowNew) {
      // Super-admins (allowlist in Firestore appConfig/superAdmins) skip the
      // new-user signup block.
      const superAdminEmail = result.user.email?.toLowerCase();
      if (superAdminEmail) {
        const { emails } = await loadSuperAdmins();
        if (emails.includes(superAdminEmail)) return;
      }

      const uid = result.user.uid;
      let hasProfile = false;
      try {
        const existingProfile = await FirestoreService.getDocument('users', uid);
        hasProfile = existingProfile != null;
      } catch {
        /* Firestore failed — don't block a returning user due to a false negative */
      }
      if (hasProfile) return;

      const createdAt = result.user.metadata.creationTime;
      const createdMs = createdAt ? new Date(createdAt).getTime() : NaN;
      const ageMs = Date.now() - createdMs;
      if (Number.isFinite(createdMs) && ageMs > 5 * 60 * 1000) {
        return;
      }

      await firebaseSignOut(auth);
      throw new Error('auth/signup-disabled');
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email, {
      url: `${getAppUrl()}/?auth=1`,
      handleCodeInApp: false,
    });
  }, []);

  const linkPassword = useCallback(async (password: string) => {
    if (!auth.currentUser?.email) throw new Error('No email found');
    const pwError = validatePassword(password);
    if (pwError) throw new Error(pwError);
    const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
    await linkWithCredential(auth.currentUser, credential);
  }, []);

  const linkGoogle = useCallback(async () => {
    if (!auth.currentUser) throw new Error('Not signed in');
    const provider = new GoogleAuthProvider();
    await linkWithPopup(auth.currentUser, provider);
  }, []);

  const hasPasswordProvider = useMemo(() => user?.providerData.some((p) => p.providerId === 'password') ?? false, [user]);
  const hasGoogleProvider = useMemo(() => user?.providerData.some((p) => p.providerId === 'google.com') ?? false, [user]);

  const value: AuthContextValue = {
    user,
    loading,
    isSuperAdmin,
    isSuperAdminResolved,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    resetPassword,
    linkPassword,
    linkGoogle,
    hasPasswordProvider,
    hasGoogleProvider,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}
