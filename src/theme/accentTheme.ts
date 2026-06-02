/**
 * Accent theming ανά χρήστη (localStorage). Αλλάζει μόνο το accent family μέσω `data-accent`
 * στο <html> — τα semantic χρώματα (success/danger/warning) μένουν ώστε να μη χαλάει η ανάγνωση
 * των δεδομένων. Τα overrides ζουν στο index.css (`:root[data-accent="..."]`).
 */
export type AccentId =
  | 'classic'
  | 'orange'
  | 'blue'
  | 'violet'
  | 'emerald'
  | 'teal'
  | 'rose'
  // Combos: accent + ξεχωριστό/αντίθετο chrome (όπως το classic) με δική τους «προσωπικότητα».
  | 'midnight'
  | 'royal'
  | 'forest'
  | 'crimson'
  | 'ocean'
  // Τριχρωμίες: accent + secondary (chart) + chrome — τρι-τονικό swatch με πλήρη χαρακτήρα.
  | 'sunset'
  | 'tropic'
  | 'aurora'
  | 'berry';

export interface AccentPreset {
  id: AccentId;
  label: string;
  /** Swatch για το UI επιλογής (το κύριο accent χρώμα). */
  swatch: string;
  /** Δεύτερο χρώμα για διπλό swatch (π.χ. classic = πορτοκαλί accent + ουδέτερο σκούρο chrome). */
  swatch2?: string;
  /** Τρίτο χρώμα για τρίχρωμο swatch (οδηγεί και το chart-secondary για ορατό αποτέλεσμα). */
  swatch3?: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  // Μονόχρωμα (accent + ομόχρωμο chrome)
  { id: 'classic', label: 'Κλασικό', swatch: '#111111' },
  { id: 'orange', label: 'Πορτοκαλί', swatch: '#F97316' },
  { id: 'blue', label: 'Μπλε', swatch: '#2563EB' },
  { id: 'violet', label: 'Μωβ', swatch: '#7C3AED' },
  { id: 'emerald', label: 'Πράσινο', swatch: '#059669' },
  { id: 'teal', label: 'Teal', swatch: '#0D9488' },
  { id: 'rose', label: 'Ροζ', swatch: '#E11D48' },
  // Combos (accent + αντίθετο chrome — duo-tone με προσωπικότητα)
  { id: 'midnight', label: 'Μεσάνυχτα', swatch: '#38BDF8', swatch2: '#0B1220' },
  { id: 'royal', label: 'Βασιλικό', swatch: '#F59E0B', swatch2: '#312E81' },
  { id: 'forest', label: 'Δάσος', swatch: '#84CC16', swatch2: '#14271C' },
  { id: 'crimson', label: 'Κρεμεζί', swatch: '#EC4899', swatch2: '#18181B' },
  { id: 'ocean', label: 'Ωκεανός', swatch: '#14B8A6', swatch2: '#0C4A6E' },
  // Τριχρωμίες (accent + secondary + chrome) — το swatch3 οδηγεί το chart-secondary
  { id: 'sunset', label: 'Ηλιοβασίλεμα', swatch: '#F97316', swatch2: '#4C1D95', swatch3: '#E11D48' },
  { id: 'tropic', label: 'Τροπικό', swatch: '#14B8A6', swatch2: '#0C4A6E', swatch3: '#84CC16' },
  { id: 'aurora', label: 'Σέλας', swatch: '#38BDF8', swatch2: '#0B1220', swatch3: '#A855F7' },
  { id: 'berry', label: 'Μούρο', swatch: '#EC4899', swatch2: '#18181B', swatch3: '#8B5CF6' },
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

/** Custom event που σκάει όταν αλλάζει το accent — επιτρέπει σε components (π.χ. charts/sparklines
 *  με literal hex σε SVG) να ξαναδιαβάσουν το χρώμα του ενεργού profile. */
export const ACCENT_CHANGE_EVENT = 'pp-accent-change';

/** Εφαρμογή στο <html> (default → καθαρίζει το attribute ώστε να ισχύει το :root). */
export function applyAccent(accent: AccentId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (accent === DEFAULT_ACCENT) {
    delete root.dataset.accent;
  } else {
    root.dataset.accent = accent;
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACCENT_CHANGE_EVENT, { detail: accent }));
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
