/**
 * Accent theming ανά χρήστη (localStorage). Αλλάζει μόνο το accent family μέσω `data-accent`
 * στο <html> — τα semantic χρώματα (success/danger/warning) μένουν ώστε να μη χαλάει η ανάγνωση
 * των δεδομένων. Τα overrides ζουν στο index.css (`:root[data-accent="..."]`).
 */
export type AccentId = 'classic' | 'orange' | 'blue' | 'violet' | 'emerald' | 'teal' | 'rose';

export interface AccentPreset {
  id: AccentId;
  label: string;
  /** Swatch για το UI επιλογής (το κύριο accent χρώμα). */
  swatch: string;
  /** Δεύτερο χρώμα για διπλό swatch (π.χ. classic = πορτοκαλί accent + ουδέτερο σκούρο chrome). */
  swatch2?: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'classic', label: 'Κλασικό', swatch: '#F97316', swatch2: '#111111' },
  { id: 'orange', label: 'Πορτοκαλί', swatch: '#F97316' },
  { id: 'blue', label: 'Μπλε', swatch: '#2563EB' },
  { id: 'violet', label: 'Μωβ', swatch: '#7C3AED' },
  { id: 'emerald', label: 'Πράσινο', swatch: '#059669' },
  { id: 'teal', label: 'Teal', swatch: '#0D9488' },
  { id: 'rose', label: 'Ροζ', swatch: '#E11D48' },
];

export const DEFAULT_ACCENT: AccentId = 'classic';
const STORAGE_KEY = 'pp-accent-v1';

export function isAccentId(value: unknown): value is AccentId {
  return typeof value === 'string' && ACCENT_PRESETS.some((p) => p.id === value);
}

export function readStoredAccent(): AccentId {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isAccentId(v) ? v : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/** Εφαρμογή στο <html> (default → καθαρίζει το attribute ώστε να ισχύει το :root). */
export function applyAccent(accent: AccentId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (accent === DEFAULT_ACCENT) {
    delete root.dataset.accent;
  } else {
    root.dataset.accent = accent;
  }
}

export function setStoredAccent(accent: AccentId): void {
  try {
    localStorage.setItem(STORAGE_KEY, accent);
  } catch {
    /* private mode: εφαρμόζεται ούτως ή άλλως για το τρέχον session */
  }
  applyAccent(accent);
}

/** Καλείται στο boot (πριν το render) ώστε να μην υπάρχει flash λάθος χρώματος. */
export function bootstrapAccent(): void {
  applyAccent(readStoredAccent());
}
