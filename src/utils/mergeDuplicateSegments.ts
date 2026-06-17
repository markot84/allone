import type { RFMSegment } from '../types';

/** Merges segments by normalized name so a botched "one row = one segment" import
 * collapses into sensible aggregates. */
export function mergeDuplicateSegmentRowsByName(segments: RFMSegment[]): RFMSegment[] {
  if (segments.length < 25) return segments;

  const byName = new Map<string, RFMSegment[]>();
  for (const s of segments) {
    const key = (s.name || '').trim().toLowerCase();
    if (!key) continue;
    const arr = byName.get(key) || [];
    arr.push(s);
    byName.set(key, arr);
  }
  if (byName.size >= segments.length) return segments;

  const merged: RFMSegment[] = [];
  for (const [, group] of byName) {
    if (group.length === 1) {
      // Copy — the percentage loop below mutates each `merged` entry in place,
      // and pushing the input ref would mutate the caller's (React Query cache) object.
      merged.push({ ...group[0] });
      continue;
    }
    const totalCount = group.reduce((a, s) => a + (s.count ?? 0), 0);
    const weightedRev = group.reduce((a, s) => a + (s.revenue_share ?? 0) * (s.count ?? 0), 0);
    const avgRev = totalCount > 0 ? weightedRev / totalCount : 0;
    const base = group[0];
    merged.push({
      ...base,
      id: base.id,
      name: base.name,
      count: totalCount,
      percentage: 0,
      revenue_share: Math.round(avgRev * 100) / 100,
      rfm_score: base.rfm_score || group.find((g) => g.rfm_score)?.rfm_score || '',
    });
  }

  const totalCustomers = merged.reduce((a, s) => a + (s.count ?? 0), 0);
  for (const s of merged) {
    s.percentage =
      totalCustomers > 0
        ? Math.round(((s.count ?? 0) / totalCustomers) * 10000) / 100
        : 0;
  }

  merged.sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  return merged;
}
