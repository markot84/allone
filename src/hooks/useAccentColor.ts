import { useEffect, useState } from 'react';
import { ACCENT_CHANGE_EVENT } from '../theme/accentTheme';

export interface AccentColors {
  /** Κύριο χρώμα του ενεργού profile (--nts-accent). */
  accent: string;
  /** Ανοιχτή απόχρωση (--nts-accent-light) — για gradients/fills. */
  accentLight: string;
  /** Δευτερεύον χρώμα γραφημάτων (--nts-chart-secondary) — οδηγείται από τριχρωμίες. */
  chartSecondary: string;
}

const FALLBACK: AccentColors = {
  accent: '#F97316',
  accentLight: '#FFEDD5',
  chartSecondary: '#78716C',
};

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function readAccentColors(): AccentColors {
  return {
    accent: readVar('--nts-accent', FALLBACK.accent),
    accentLight: readVar('--nts-accent-light', FALLBACK.accentLight),
    chartSecondary: readVar('--nts-chart-secondary', FALLBACK.chartSecondary),
  };
}

/**
 * Επιστρέφει το χρώμα του ενεργού accent profile ως literal hex, ώστε components με SVG
 * (sparklines/charts) — όπου το `var(--nts-accent)` δεν resolve-άρει αξιόπιστα μέσα σε `url(#id)`
 * ή σε gradient stops — να ακολουθούν το ίδιο βασικό χρώμα. Ενημερώνεται όταν αλλάζει το profile.
 */
export function useAccentColor(): AccentColors {
  const [colors, setColors] = useState<AccentColors>(() => readAccentColors());

  useEffect(() => {
    const update = () => setColors(readAccentColors());
    update();
    window.addEventListener(ACCENT_CHANGE_EVENT, update);
    return () => window.removeEventListener(ACCENT_CHANGE_EVENT, update);
  }, []);

  return colors;
}
