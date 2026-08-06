/**
 * Cockpit theme — light / dark, selected by `data-theme` on <html>.
 *
 * The values live in `src/styles/tokens.css`; this module only decides which of the two blocks is
 * active. It is deliberately separate from `accentTheme.ts`: that one repaints the brand accent and
 * is switched OFF for the v2 identity, whereas this changes the canvas the fixed brand colours sit
 * on and leaves all four of them untouched.
 */

export type ThemeMode = 'light' | 'dark';

/**
 * A NEW key. The existing `perf-plus-*` / `performance-plus_*` keys are load-bearing — renaming one
 * silently discards a user's cached briefings or preferences — so this does not join that family
 * and does not touch it.
 */
export const THEME_STORAGE_KEY = 'allone_theme';

const isMode = (value: unknown): value is ThemeMode => value === 'light' || value === 'dark';

export function readStoredTheme(): ThemeMode | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isMode(raw) ? raw : null;
  } catch {
    // Safari in private mode throws on localStorage access. A missing preference is not an error.
    return null;
  }
}

export function storeTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Preference simply will not persist; the session still works.
  }
}

/** The OS preference, used only when the user has never chosen. */
export function systemTheme(): ThemeMode {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveInitialTheme(): ThemeMode {
  return readStoredTheme() ?? systemTheme();
}

/**
 * Writes the mode to <html>.
 *
 * `color-scheme` is set alongside the attribute so the browser's own chrome follows — scrollbars,
 * form controls and the spellcheck underline are drawn by the UA and do not read our tokens.
 */
export function applyTheme(mode: ThemeMode): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', mode);
  root.style.colorScheme = mode;
}

/**
 * Called from `main.tsx` before `createRoot`, so the first paint is already in the right theme.
 * Doing this in an effect instead produces a white flash on every load for dark-theme users.
 */
export function bootstrapTheme(): void {
  applyTheme(resolveInitialTheme());
}
