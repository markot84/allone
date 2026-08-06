import type { RFMSegment } from '../types';

/** Distinct categorical hues — avoid clustering greens/teals for adjacent segments. */
export const SEGMENT_COLORS: Record<string, string> = {
  champions: '#F59E0B',
  loyal: '#1D4ED8',
  potential: '#6366F1',
  loyal_customers: '#1D4ED8',
  promising: '#6366F1',
  at_risk: '#EF4444',
  hibernating: '#64748B',
  lost: '#991B1B',
  recent_customers: '#06B6D4',
  cant_lose_them: '#C026D3',
  "can't_lose_them": '#C026D3',
  customers_needing_attention: '#EC4899',
  new_customers: '#84CC16',
};

export function getSegmentColor(segment: RFMSegment | null | undefined): string {
  if (!segment) return 'var(--text-muted)';
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
    'var(--text-muted)'
  );
}
