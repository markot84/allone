import { useQuery } from '@tanstack/react-query';
import { ProductsService } from '../services/firestore';
import { products as mockProducts } from '../data/mockProducts';
import { useBrand } from './useBrand';
import type { Product } from '../types';

export function useProducts() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: firestoreProducts = [], isPending } = useQuery({
    queryKey: ['products', brandId],
    queryFn: () => (brandId ? ProductsService.getAll(brandId) : Promise.resolve([])) as Promise<Product[]>,
  });

  const products = (firestoreProducts?.length > 0 ? firestoreProducts : mockProducts) as Product[];

  return {
    products,
    count: products.length,
    isLoading: isPending,
    hasImported: firestoreProducts?.length > 0,
  };
}
