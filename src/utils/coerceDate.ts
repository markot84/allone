/**
 * Firestore Timestamp, ISO string (e.g. from React Query persist), seconds object, or Date → valid Date.
 */
export function coerceToDate(value: unknown): Date | null {
  const fromExcelSerial = (serial: number): Date | null => {
    if (!Number.isFinite(serial)) return null;
    if (serial <= 0) return null;
    const d = new Date((serial - 25569) * 86400 * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const fromDdMmYyyy = (raw: string): Date | null => {
    const m = raw.trim().match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+.*)?$/);
    if (!m) return null;
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const yearRaw = parseInt(m[3], 10);
    const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
    const d = new Date(year, month - 1, day);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d;
  };

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
  if (typeof value === 'number') {
    if (value > 20000 && value < 80000) {
      return fromExcelSerial(value);
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const asNumber = Number(trimmed.replace(',', '.'));
    if (Number.isFinite(asNumber) && trimmed.match(/^\d+(?:[.,]\d+)?$/) && asNumber > 20000 && asNumber < 80000) {
      return fromExcelSerial(asNumber);
    }
    const localDate = fromDdMmYyyy(trimmed);
    if (localDate) return localDate;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
