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
import { auth } from '../config/firebase';
import { getPublicSignupMode, isInviteReturnUrl } from '../config/authAccess';
import { FirestoreService } from '../services/firestore';
import { isSuperAdminEmail, SUPER_ADMIN_EMAILS } from '../config/superAdmins';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  isSuperAdmin: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  /** allowNewUsers: αν false, νέοι λογαριασμοί Google απορρίπτονται (sign out + error). */
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Ensure user profile exists in Firestore on first sign-in
  useEffect(() => {
    if (!user?.uid) return;
    const ensureProfile = async () => {
      const existing = await FirestoreService.getDocument('users', user.uid);
      if (!existing) {
        // Don't set brandIds here - acceptInvite may have run first (invite flow).
        // Setting brandIds: [] would overwrite invite data. Leave brandIds for acceptInvite/BrandCreateForm.
        await FirestoreService.setDocument('users', user.uid, {
          id: user.uid,
          email: user.email ?? '',
          displayName: user.displayName ?? null,
          createdAt: Timestamp.now(),
        } as Record<string, unknown>);
      }
    };
    ensureProfile().catch(console.error);

    // Sync super admin UIDs to Firestore for security rules
    if (isSuperAdminEmail(user.email)) {
      (async () => {
        try {
          const doc = await FirestoreService.getDocument<{ uids: string[] }>('appConfig', 'superAdmins');
          const existing = doc?.uids || [];
          if (!existing.includes(user.uid)) {
            await FirestoreService.setDocument('appConfig', 'superAdmins', {
              uids: [...existing, user.uid],
              emails: SUPER_ADMIN_EMAILS,
            } as Record<string, unknown>);
          }
        } catch { /* non-critical */ }
      })();
    }
  }, [user?.uid]);

  /** Πάντα επιτρέπεται για υπάρχοντες λογαριασμούς — η πολιτική signup δεν εφαρμόζεται εδώ. */
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
    await createUserWithEmailAndPassword(auth, email, password);
  }, []);

  const signInWithGoogle = useCallback(async (options?: { allowNewUsers?: boolean }) => {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const allowNew = options?.allowNewUsers === true;
    const extra = getAdditionalUserInfo(result);
    if (extra?.isNewUser && !allowNew) {
      if (isSuperAdminEmail(result.user.email)) return;

      const uid = result.user.uid;
      let hasProfile = false;
      try {
        const existingProfile = await FirestoreService.getDocument('users', uid);
        hasProfile = existingProfile != null;
      } catch {
        /* Firestore απέτυχε — μην αποκλείουμε επιστρέφοντα χρήστη λόγω false negative */
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
    const appUrl = import.meta.env.VITE_APP_URL || 'https://performance-plus-4a5b2.web.app';
    await sendPasswordResetEmail(auth, email, {
      url: `${appUrl}/?auth=1`,
      handleCodeInApp: false,
    });
  }, []);

  const linkPassword = useCallback(async (password: string) => {
    if (!auth.currentUser?.email) throw new Error('No email found');
    const credential = EmailAuthProvider.credential(auth.currentUser.email, password);
    await linkWithCredential(auth.currentUser, credential);
  }, []);

  const linkGoogle = useCallback(async () => {
    if (!auth.currentUser) throw new Error('Not signed in');
    const provider = new GoogleAuthProvider();
    await linkWithPopup(auth.currentUser, provider);
  }, []);

  const superAdmin = useMemo(() => isSuperAdminEmail(user?.email), [user?.email]);
  const hasPasswordProvider = useMemo(() => user?.providerData.some((p) => p.providerId === 'password') ?? false, [user]);
  const hasGoogleProvider = useMemo(() => user?.providerData.some((p) => p.providerId === 'google.com') ?? false, [user]);

  const value: AuthContextValue = {
    user,
    loading,
    isSuperAdmin: superAdmin,
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
