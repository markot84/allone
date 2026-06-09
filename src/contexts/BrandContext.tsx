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
import { FirestoreService } from '../services/firestore';
import type { Brand } from '../types';

interface BrandContextValue {
  currentBrand: Brand | null;
  brands: Brand[];
  loading: boolean;
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
  const { user, isSuperAdmin, isSuperAdminResolved } = useAuth();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [currentBrand, setCurrentBrandState] = useState<Brand | null>(null);
  const [loading, setLoading] = useState(true);
  // CODE-6: generation guard — a fast user/brand switch can fire refreshBrands again while an
  // earlier run is still awaiting; only the latest run is allowed to commit its setState, so a
  // stale resolve can't clobber a newer one with the wrong brand list/context.
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
    const cachedBrand = getStoredBrandSnapshot(user.uid);
    if (cachedBrand) {
      setBrands((prev) => (prev.some((b) => b.id === cachedBrand.id) ? prev : [cachedBrand, ...prev]));
      setCurrentBrandState((prev) => prev ?? cachedBrand);
      setLoading(false);
    }
    // Wait until the super-admin status is known before loading the authoritative list:
    // branching on a not-yet-resolved `isSuperAdmin` would load the member-only set first
    // and then re-load the all-brands set (or vice-versa), flickering the dropdown. The
    // cached brand above keeps the UI responsive meanwhile; this effect re-runs once
    // `isSuperAdminResolved` flips true.
    if (!isSuperAdminResolved) return;
    try {
      if (isSuperAdmin) {
        const allBrands = await FirestoreService.getDocuments<Brand>('brands', [], null, { forceServer: true });
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
      try {
        profile = await FirestoreService.getDocumentWithTimeout<{ brandIds?: string[]; defaultBrandId?: string }>(
          'users',
          user.uid,
          15000
        );
      } catch (e) {
        console.error('refreshBrands: user profile fetch failed or timed out', e);
        profile = null;
      }
      const fromProfile = profile?.brandIds ?? [];
      const fromMembers = await FirestoreService.getBrandIdsFromMembershipDocuments(user.uid);
      const brandIds = [...new Set([...fromProfile, ...fromMembers])];

      if (isStale()) return;
      if (brandIds.length === 0) {
        setBrands([]);
        setCurrentBrandState(null);
        setLoading(false);
        return;
      }
      // Resolve each brand independently. A single unreadable id (a brand the
      // user was removed from, or an orphaned/deleted id still lingering in the
      // profile's brandIds) must NOT throw and hide every other brand — that was
      // the bug where the whole list collapsed to the cached last-selected brand.
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
          console.warn('refreshBrands: skipping inaccessible brand', bid, err);
        }
      }

      // Self-heal the profile: persist only the ids that resolved to a readable
      // brand, pruning orphans so they stop poisoning future loads.
      if (resolvedIds.length > 0 && !sameStringSet(fromProfile, resolvedIds)) {
        FirestoreService.setDocument('users', user.uid, { brandIds: resolvedIds } as Record<string, unknown>).catch((err) =>
          console.warn('refreshBrands: could not sync brandIds on user profile', err)
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
      console.error('refreshBrands:', err);
      if (!isStale() && !cachedBrand) {
        setBrands([]);
        setCurrentBrandState(null);
      }
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [user?.uid, isSuperAdmin, isSuperAdminResolved]);

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
