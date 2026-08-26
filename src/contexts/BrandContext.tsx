import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode
} from 'react';
import { useAuth } from '../hooks';
import { FirestoreService, withFirestoreRetry } from '../services/firestore';
import { logger } from '../utils/logger';
import { CLIENT_ALERT } from '../utils/alertKeys';
import type { Brand } from '../types';

interface BrandContextValue {
  currentBrand: Brand | null;
  brands: Brand[];
  loading: boolean;
  /** Last brand load died on a transient error — connection problem, not "no brands". */
  loadFailed: boolean;
  setCurrentBrand: (brand: Brand | null) => void;
  refreshBrands: () => Promise<void>;
}

const BrandContext = createContext<BrandContextValue | null>(null);

const STORAGE_KEY_PREFIX = 'perf-plus-last-brand';
const STORAGE_BRAND_SNAPSHOT_PREFIX = 'perf-plus-last-brand-snapshot';

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(b);
  return a.every((x) => s.has(x));
}

function getStoredBrandSnapshot(userId: string): Brand | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${STORAGE_BRAND_SNAPSHOT_PREFIX}-${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Brand;
    return parsed?.id && parsed?.name ? parsed : null;
  } catch {
    return null;
  }
}

export function BrandProvider({ children }: { children: ReactNode }) {
  const { user, isSuperAdmin, isSuperAdminResolved, superAdminResolveFailed } = useAuth();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [currentBrand, setCurrentBrandState] = useState<Brand | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // Generation guard: a fast user/brand switch can fire refreshBrands again mid-await; only the
  // latest run may commit its setState, so a stale resolve can't clobber a newer brand list.
  const reqIdRef = useRef(0);

  const refreshBrands = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    const isStale = () => reqId !== reqIdRef.current;
    if (!user?.uid) {
      setBrands([]);
      setCurrentBrandState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    const cachedBrand = getStoredBrandSnapshot(user.uid);
    if (cachedBrand) {
      setBrands((prev) => (prev.some((b) => b.id === cachedBrand.id) ? prev : [cachedBrand, ...prev]));
      setCurrentBrandState((prev) => prev ?? cachedBrand);
      setLoading(false);
    }
    // Wait for resolved super-admin status before loading the authoritative list; branching on an
    // unresolved `isSuperAdmin` would load one set then re-load the other, flickering the dropdown.
    if (!isSuperAdminResolved) return;
    try {
      if (isSuperAdmin) {
        const allBrands = await withFirestoreRetry(() =>
          FirestoreService.getDocuments<Brand>('brands', [], null, { forceServer: true }));
        if (isStale()) return;
        const brandList = allBrands.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'el'));
        setBrands(brandList);

        const storageKey = `${STORAGE_KEY_PREFIX}-${user.uid}`;
        const lastBrandId = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
        const lastBrand = lastBrandId
          ? brandList.find((b) => b.id === lastBrandId) ?? null
          : null;
        const nextBrand = lastBrand ?? brandList[0] ?? null;
        setCurrentBrandState((prev) => prev ? brandList.find((b) => b.id === prev.id) ?? nextBrand : nextBrand);
        setLoading(false);
        return;
      }

      let profile: { brandIds?: string[]; defaultBrandId?: string } | null = null;
      let profileFetchFailed = false;
      try {
        profile = await withFirestoreRetry(() =>
          FirestoreService.getDocumentWithTimeout<{ brandIds?: string[]; defaultBrandId?: string }>(
            'users',
            user.uid,
            15000
          ));
      } catch (e) {
        logger.error('refreshBrands: user profile fetch failed or timed out', { err: e });
        profile = null;
        profileFetchFailed = true;
      }
      const fromProfile = profile?.brandIds ?? [];
      const fromMembers = await FirestoreService.getBrandIdsFromMembershipDocuments(user.uid);
      const brandIds = [...new Set([...fromProfile, ...fromMembers])];

      if (isStale()) return;
      if (brandIds.length === 0) {
        // Failed profile/super-admin fetch + empty membership ≠ proven brand-less user — surface a connection problem.
        if (profileFetchFailed || superAdminResolveFailed) setLoadFailed(true);
        setBrands([]);
        setCurrentBrandState(null);
        setLoading(false);
        return;
      }
      // Resolve each brand independently. A single unreadable id (removed-from or orphaned/deleted
      // but still in brandIds) must NOT throw and hide every other brand.
      const brandList: Brand[] = [];
      const resolvedIds: string[] = [];
      for (const bid of brandIds) {
        try {
          const b = await FirestoreService.getDocument<Brand>('brands', bid);
          if (b) {
            brandList.push(b);
            resolvedIds.push(bid);
          }
          // b === null => brand doc no longer exists; drop the orphan id.
        } catch (err) {
          // permission-denied / unreadable brand — skip it, don't abort the list.
          logger.warn('refreshBrands: skipping inaccessible brand', { bid, err });
        }
      }

      // Self-heal the profile: persist only ids that resolved to a readable brand,
      // pruning orphans so they stop poisoning future loads.
      if (resolvedIds.length > 0 && !sameStringSet(fromProfile, resolvedIds)) {
        FirestoreService.setDocument('users', user.uid, { brandIds: resolvedIds } as Record<string, unknown>).catch((err) =>
          logger.warn('refreshBrands: could not sync brandIds on user profile', { err })
        );
      }

      if (isStale()) return;
      setBrands(brandList);
      const defaultId = profile?.defaultBrandId ?? brandIds[0];
      const defaultBrand = brandList.find((b) => b.id === defaultId) ?? brandList[0] ?? null;
      // On refresh: prefer last selected brand (localStorage) if still in user's brands
      const storageKey = `${STORAGE_KEY_PREFIX}-${user.uid}`;
      const lastBrandId = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
      const lastBrand = lastBrandId && brandIds.includes(lastBrandId)
        ? brandList.find((b) => b.id === lastBrandId) ?? defaultBrand
        : defaultBrand;
      setCurrentBrandState((prev) => prev ? brandList.find((b) => b.id === prev.id) ?? lastBrand : lastBrand);
    } catch (err) {
      logger.error('refreshBrands:', { alertKey: CLIENT_ALERT.brandLoadFailed, err });
      if (!isStale() && !cachedBrand) {
        setLoadFailed(true);
        setBrands([]);
        setCurrentBrandState(null);
      }
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [user?.uid, isSuperAdmin, isSuperAdminResolved, superAdminResolveFailed]);

  const setCurrentBrand = useCallback((brand: Brand | null) => {
    setCurrentBrandState(brand);
    if (typeof localStorage !== 'undefined' && user?.uid) {
      const storageKey = `${STORAGE_KEY_PREFIX}-${user.uid}`;
      const snapshotKey = `${STORAGE_BRAND_SNAPSHOT_PREFIX}-${user.uid}`;
      if (brand) {
        localStorage.setItem(storageKey, brand.id);
        localStorage.setItem(snapshotKey, JSON.stringify(brand));
      } else {
        localStorage.removeItem(storageKey);
        localStorage.removeItem(snapshotKey);
      }
    }
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || !currentBrand || typeof localStorage === 'undefined') return;
    localStorage.setItem(`${STORAGE_KEY_PREFIX}-${user.uid}`, currentBrand.id);
    localStorage.setItem(`${STORAGE_BRAND_SNAPSHOT_PREFIX}-${user.uid}`, JSON.stringify(currentBrand));
  }, [user?.uid, currentBrand]);

  useEffect(() => {
    refreshBrands();
  }, [refreshBrands]);

  const value: BrandContextValue = {
    currentBrand,
    brands,
    loading,
    loadFailed,
    setCurrentBrand,
    refreshBrands,
  };

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBrandContext() {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error('useBrandContext must be used within BrandProvider');
  return ctx;
}
