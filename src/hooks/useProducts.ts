import { useQuery } from '@tanstack/react-query';
import { ProductsService } from '../services/firestore';
import { products as mockProducts } from '../data/mockProducts';
import type { Product } from '../types';

export function useProducts() {
  const { data: firestoreProducts = [], isPending } = useQuery({
    queryKey: ['products'],
    queryFn: () => ProductsService.getAll() as Promise<Product[]>,
  });

  const products = (firestoreProducts?.length > 0 ? firestoreProducts : mockProducts) as Product[];

  return {
    products,
    count: products.length,
    isLoading: isPending,
    hasImported: firestoreProducts?.length > 0,
  };
}
