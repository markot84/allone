import type { RFMSegment } from '../types';

export const SEGMENT_COLORS: Record<string, string> = {
  champions: '#16A34A',
  loyal_customers: '#2563EB',
  promising: '#7C3AED',
  at_risk: '#EA580C',
  hibernating: '#14B8A6',
  lost: '#DC2626',
  recent_customers: '#10B981',
  cant_lose_them: '#F59E0B',
  "can't_lose_them": '#F59E0B',
  customers_needing_attention: '#EC4899',
};

export function getSegmentColor(segment: RFMSegment): string {
  const idKey = segment.id.toLowerCase().replace(/\s+/g, '_');
  const idKeyNoApostrophe = idKey.replace(/'/g, '');
  const nameKey = (segment.name ?? '').toLowerCase().replace(/\s+/g, '_');
  const nameKeyNoApostrophe = nameKey.replace(/'/g, '');
  return (
    SEGMENT_COLORS[segment.id] ??
    SEGMENT_COLORS[idKey] ??
    SEGMENT_COLORS[idKeyNoApostrophe] ??
    SEGMENT_COLORS[nameKey] ??
    SEGMENT_COLORS[nameKeyNoApostrophe] ??
    segment.color ??
    '#6B7280'
  );
}
