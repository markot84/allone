import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SegmentsService } from '../services/firestore';
import { getSegmentColor } from '../utils/segmentColors';
import { useBrand } from './useBrand';
import type { RFMSegment } from '../types';

export function useSegments() {
  const { currentBrand } = useBrand();
  const brandId = currentBrand?.id ?? null;

  const { data: firestoreSegments = [], isPending } = useQuery({
    queryKey: ['segments', brandId],
    queryFn: () => (brandId ? SegmentsService.getAll(brandId) : Promise.resolve([])) as Promise<RFMSegment[]>,
  });

  // When brandId is set: show real data only. When no brand: empty (no mock).
  const segments = useMemo(() => {
    const raw = (brandId ? (firestoreSegments ?? []) : []) as RFMSegment[];
    return raw.filter((s): s is RFMSegment => s != null && typeof s.id === 'string').map((s) => ({ ...s, color: getSegmentColor(s) }));
  }, [brandId, firestoreSegments]);

  const totalCustomers = useMemo(
    () => segments.reduce((sum, s) => sum + (s.count ?? 0), 0) || 0,
    [segments]
  );

  return { segments, totalCustomers, isLoading: isPending, hasImported: firestoreSegments?.length > 0 };
}
