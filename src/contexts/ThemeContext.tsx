import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyTheme,
  readStoredTheme,
  resolveInitialTheme,
  storeTheme,
  systemTheme,
  type ThemeMode,
} from '../theme/cockpitTheme';

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  /** True while the app is following the OS rather than an explicit choice. */
  followsSystem: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components -- the hook lives in ../hooks/useTheme
export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // `bootstrapTheme()` has already written the attribute before first paint; this reads the same
  // decision rather than making a second one, so state and DOM cannot disagree on mount.
  const [theme, setThemeState] = useState<ThemeMode>(resolveInitialTheme);
  const [followsSystem, setFollowsSystem] = useState(() => readStoredTheme() === null);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
    setFollowsSystem(false);
    storeTheme(mode);
    applyTheme(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => {
      const next: ThemeMode = current === 'dark' ? 'light' : 'dark';
      setFollowsSystem(false);
      storeTheme(next);
      applyTheme(next);
      return next;
    });
  }, []);

  // Follow the OS only until the user expresses a preference of their own. After that an OS change
  // must not yank the app out from under them.
  useEffect(() => {
    if (!followsSystem || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const next = systemTheme();
      setThemeState(next);
      applyTheme(next);
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [followsSystem]);

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme, followsSystem }),
    [theme, setTheme, toggleTheme, followsSystem]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
