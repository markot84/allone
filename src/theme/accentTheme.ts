/** Per-user accent theming (localStorage) via `data-accent` on <html>; semantic
 *  colors stay readable. Overrides live in index.css (`:root[data-accent="..."]`). */

/**
 * Off for the v2 brand identity: colors.md fixes four logo-sampled colours and states they are not
 * to be modified, so letting each user repaint the accent would defeat it. The CSS overrides these
 * presets depend on are preserved but not imported (see src/styles/legacy-accent-themes.css), which
 * means the pickers would appear to do nothing while this is false.
 *
 * Nothing here is deleted. To bring the feature back: set this to true and re-import
 * legacy-accent-themes.css from index.css.
 */
export const ACCENT_PICKER_ENABLED = false;
export type AccentId =
  | 'classic'
  | 'orange'
  | 'blue'
  | 'violet'
  | 'emerald'
  | 'teal'
  | 'rose'
  // Combos: accent + distinct/contrasting chrome (like classic) with their own personality.
  | 'midnight'
  | 'royal'
  | 'forest'
  | 'crimson'
  | 'ocean'
  // Tricolor: accent + secondary (chart) + chrome — three-tone swatch with full character.
  | 'sunset'
  | 'tropic'
  | 'aurora'
  | 'berry'
  | 'patriot';

export interface AccentPreset {
  id: AccentId;
  label: string;
  /** Swatch for the picker UI (the main accent color). */
  swatch: string;
  /** Second color for a dual swatch (e.g. classic = orange accent + neutral dark chrome). */
  swatch2?: string;
  /** Third color for a tricolor swatch (also drives chart-secondary for a visible result). */
  swatch3?: string;
  /** Cosmetic override ONLY for the picker swatch (2-3 colors) for a clear tricolor
   *  preview; if absent, derived from swatch/swatch2/swatch3. */
  swatchColors?: string[];
}

export const ACCENT_PRESETS: AccentPreset[] = [
  // Monochrome (accent + same-tone chrome)
  { id: 'classic', label: 'Κλασικό', swatch: '#111111' },
  { id: 'orange', label: 'Πορτοκαλί', swatch: '#F97316' },
  { id: 'blue', label: 'Μπλε', swatch: '#2563EB' },
  { id: 'violet', label: 'Μωβ', swatch: '#7C3AED' },
  { id: 'emerald', label: 'Πράσινο', swatch: '#059669' },
  { id: 'teal', label: 'Teal', swatch: '#0D9488' },
  { id: 'rose', label: 'Ροζ', swatch: '#E11D48' },
  // Combos (accent + contrasting chrome — duo-tone with personality)
  { id: 'midnight', label: 'Μεσάνυχτα', swatch: '#38BDF8', swatch2: '#0B1220' },
  { id: 'royal', label: 'Βασιλικό', swatch: '#F59E0B', swatch2: '#312E81' },
  { id: 'forest', label: 'Δάσος', swatch: '#84CC16', swatch2: '#14271C' },
  { id: 'crimson', label: 'Κρεμεζί', swatch: '#EC4899', swatch2: '#18181B' },
  { id: 'ocean', label: 'Ωκεανός', swatch: '#14B8A6', swatch2: '#0C4A6E' },
  // Tricolor (accent + secondary + chrome): swatch3 drives chart-secondary;
  // swatchColors gives a clear 3-color preview (functional chrome is dark).
  { id: 'sunset', label: 'Ηλιοβασίλεμα', swatch: '#F97316', swatch2: '#4C1D95', swatch3: '#E11D48', swatchColors: ['#F97316', '#7C3AED', '#E11D48'] },
  { id: 'tropic', label: 'Τροπικό', swatch: '#14B8A6', swatch2: '#0C4A6E', swatch3: '#84CC16', swatchColors: ['#14B8A6', '#2563EB', '#84CC16'] },
  { id: 'aurora', label: 'Σέλας', swatch: '#38BDF8', swatch2: '#0B1220', swatch3: '#A855F7', swatchColors: ['#38BDF8', '#7C3AED', '#F472B6'] },
  { id: 'berry', label: 'Μούρο', swatch: '#EC4899', swatch2: '#18181B', swatch3: '#8B5CF6', swatchColors: ['#EC4899', '#8B5CF6', '#F59E0B'] },
  { id: 'patriot', label: 'Μπλε-Λευκό-Κόκκινο', swatch: '#2563EB', swatch2: '#1E3A8A', swatch3: '#DC2626', swatchColors: ['#2563EB', '#FFFFFF', '#DC2626'] },
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

/** Custom event fired when the accent changes — lets components (e.g. charts/sparklines
 *  with literal hex in SVG) re-read the active profile's color. */
export const ACCENT_CHANGE_EVENT = 'pp-accent-change';

/** Apply to <html> (default → clears the attribute so :root applies). */
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
    /* private mode: applies for the current session anyway */
  }
  applyAccent(accent);
}

/** Called at boot (before render) to avoid a flash of the wrong color. */
export function bootstrapAccent(): void {
  applyAccent(readStoredAccent());
}
