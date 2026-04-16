import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import {
  META_ATTRIBUTION_WINDOWS,
  type MetaAttributionWindow,
} from '../types';

interface AttributionContextValue {
  /** Επιλεγμένο Meta attribution window. 'default' = ό,τι επιστρέφει το Meta (account-level). */
  metaWindow: MetaAttributionWindow;
  setMetaWindow: (w: MetaAttributionWindow) => void;
}

const AttributionContext = createContext<AttributionContextValue | null>(null);

const STORAGE_KEY = 'perf-plus-meta-attribution-window';

function isValidWindow(v: unknown): v is MetaAttributionWindow {
  if (v === 'default') return true;
  return typeof v === 'string' && (META_ATTRIBUTION_WINDOWS as readonly string[]).includes(v);
}

export function AttributionProvider({ children }: { children: ReactNode }) {
  const [metaWindow, setMetaWindowState] = useState<MetaAttributionWindow>('default');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw && isValidWindow(raw)) setMetaWindowState(raw);
    } catch { /* noop */ }
  }, []);

  const setMetaWindow = useCallback((w: MetaAttributionWindow) => {
    setMetaWindowState(w);
    try { localStorage.setItem(STORAGE_KEY, w); } catch { /* noop */ }
  }, []);

  return (
    <AttributionContext.Provider value={{ metaWindow, setMetaWindow }}>
      {children}
    </AttributionContext.Provider>
  );
}

export function useAttribution(): AttributionContextValue {
  const ctx = useContext(AttributionContext);
  if (!ctx) {
    // Fail-soft: αν δεν υπάρχει provider, χρησιμοποίησε default χωρίς να πετάμε.
    return { metaWindow: 'default', setMetaWindow: () => {} };
  }
  return ctx;
}
