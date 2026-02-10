import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SegmentsService } from '../services/firestore';
import { rfmSegments as mockSegments } from '../data';
import { getSegmentColor } from '../utils/segmentColors';
import type { RFMSegment } from '../types';

export function useSegments() {
  const { data: firestoreSegments = [], isPending } = useQuery({
    queryKey: ['segments'],
    queryFn: () => SegmentsService.getAll() as Promise<RFMSegment[]>,
  });

  const segments = useMemo(() => {
    const raw = (firestoreSegments?.length > 0 ? firestoreSegments : mockSegments) as RFMSegment[];
    return raw.map((s) => ({ ...s, color: getSegmentColor(s) }));
  }, [firestoreSegments]);

  const totalCustomers = useMemo(
    () => segments.reduce((sum, s) => sum + (s.count ?? 0), 0) || 0,
    [segments]
  );

  return { segments, totalCustomers, isLoading: isPending, hasImported: firestoreSegments?.length > 0 };
}
