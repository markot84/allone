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

export function BrandProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
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
    try {
      const profile = await FirestoreService.getDocument<{ brandIds?: string[]; defaultBrandId?: string }>('users', user.uid);
      const brandIds = profile?.brandIds ?? [];
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
      setCurrentBrandState((prev) => prev ? brandList.find((b) => b.id === prev.id) ?? defaultBrand : defaultBrand);
    } catch (err) {
      console.error('refreshBrands:', err);
      setBrands([]);
      setCurrentBrandState(null);
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  const setCurrentBrand = useCallback((brand: Brand | null) => {
    setCurrentBrandState(brand);
  }, []);

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
