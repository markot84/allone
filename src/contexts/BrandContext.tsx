import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
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
  const { user, isSuperAdmin } = useAuth();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [currentBrand, setCurrentBrandState] = useState<Brand | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshBrands = useCallback(async () => {
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
    try {
      if (isSuperAdmin) {
        const allBrands = await FirestoreService.getDocuments<Brand>('brands', [], null, { forceServer: true });
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

      if (!sameStringSet(fromProfile, brandIds) && brandIds.length > 0) {
        FirestoreService.setDocument('users', user.uid, { brandIds } as Record<string, unknown>).catch((err) =>
          console.warn('refreshBrands: could not sync brandIds on user profile', err)
        );
      }

      if (brandIds.length === 0) {
        setBrands([]);
        setCurrentBrandState(null);
        setLoading(false);
        return;
      }
      const brandList: Brand[] = [];
      for (const bid of brandIds) {
        const b = await FirestoreService.getDocument<Brand>('brands', bid);
        if (b) brandList.push(b);
      }
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
      if (!cachedBrand) {
        setBrands([]);
        setCurrentBrandState(null);
      }
    } finally {
      setLoading(false);
    }
  }, [user?.uid, isSuperAdmin]);

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
