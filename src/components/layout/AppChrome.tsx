import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Slots a page can fill in the app's top bar.
 *
 * The Signal Board top bar is one navy strip that mixes app chrome (section title, brand switcher)
 * with things only the current page knows about — its tab row, its period switch, its primary
 * action. Rather than teach `AppShell` about every section, it renders two empty nodes and hands
 * them out here; a page renders `<ChromeTabs>` / `<ChromeActions>` and React portals the content
 * into the bar.
 *
 * Portals rather than "pass a ReactNode up through context": a node stored in state has to be
 * re-set on every render that changes it, which is a render loop waiting to happen. A portal
 * updates through the ordinary reconciler and needs no dependency array.
 */
interface AppChromeValue {
  tabsNode: HTMLElement | null;
  actionsNode: HTMLElement | null;
  /** How many pages are currently filling the actions slot — the bar shows its own defaults at 0. */
  actionsClaimed: number;
  claimActions: (claimed: boolean) => void;
  /** True while a page draws its own gutters, so the shell drops its padded max-width wrapper. */
  bleed: boolean;
  setBleed: (bleed: boolean) => void;
}

const AppChromeContext = createContext<AppChromeValue | null>(null);

export function AppChromeProvider({
  tabsNode,
  actionsNode,
  children,
}: {
  tabsNode: HTMLElement | null;
  actionsNode: HTMLElement | null;
  children: ReactNode;
}) {
  const [actionsClaimed, setActionsClaimed] = useState(0);
  const [bleed, setBleed] = useState(false);

  const claimActions = useCallback((claimed: boolean) => {
    setActionsClaimed((n) => Math.max(0, n + (claimed ? 1 : -1)));
  }, []);

  const value = useMemo<AppChromeValue>(
    () => ({ tabsNode, actionsNode, actionsClaimed, claimActions, bleed, setBleed }),
    [tabsNode, actionsNode, actionsClaimed, claimActions, bleed]
  );

  return <AppChromeContext.Provider value={value}>{children}</AppChromeContext.Provider>;
}

export function useAppChrome(): AppChromeValue | null {
  return useContext(AppChromeContext);
}

/** The page's tab row, rendered next to the section title in the top bar. */
export function ChromeTabs({ children }: { children: ReactNode }) {
  const chrome = useAppChrome();
  if (!chrome?.tabsNode) return null;
  return createPortal(children, chrome.tabsNode);
}

/**
 * The right-hand side of the top bar. While a page fills this, the bar's own default controls step
 * aside — the page is expected to include whichever of them it still wants, in its own order.
 */
export function ChromeActions({ children }: { children: ReactNode }) {
  const chrome = useAppChrome();
  const claimActions = chrome?.claimActions;

  useEffect(() => {
    if (!claimActions) return;
    claimActions(true);
    return () => claimActions(false);
  }, [claimActions]);

  if (!chrome?.actionsNode) return null;
  return createPortal(children, chrome.actionsNode);
}

/**
 * Opt out of the shell's centred, padded content wrapper for as long as this page is mounted.
 * For pages that set their own gutters edge to edge.
 */
export function useFullBleedCanvas(): void {
  const setBleed = useAppChrome()?.setBleed;
  useEffect(() => {
    if (!setBleed) return;
    setBleed(true);
    return () => setBleed(false);
  }, [setBleed]);
}
