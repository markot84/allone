import { useEffect, useState } from 'react';
import { ACCENT_CHANGE_EVENT } from '../theme/accentTheme';

export interface AccentColors {
  /** Primary color of the active profile (--nts-accent). */
  accent: string;
  /** Light shade (--nts-accent-light) — for gradients/fills. */
  accentLight: string;
  /** Secondary chart color (--nts-chart-secondary) — derived from tri-color schemes. */
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

/** Active accent profile color as a literal hex for SVG (sparklines/charts) where
 * `var(--nts-accent)` doesn't resolve inside `url(#id)`/gradients. Updates on profile change. */
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
