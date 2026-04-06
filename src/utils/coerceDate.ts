/**
 * Firestore Timestamp, ISO string (e.g. from React Query persist), seconds object, or Date → valid Date.
 */
export function coerceToDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const v = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
  if (typeof v.toDate === 'function') {
    try {
      const d = v.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d;
    } catch {
      /* ignore */
    }
  }
  if (typeof v === 'object' && v !== null && typeof v.seconds === 'number') {
    const ms = v.seconds * 1000 + (typeof v.nanoseconds === 'number' ? v.nanoseconds / 1e6 : 0);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
