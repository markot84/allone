import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Reveal a chart when it scrolls into view — and only draw it the first time in the session.
 *
 * The brief's reveal category is "450ms, once". Once is the hard part: a component that animates on
 * every mount re-draws itself each time the user switches tabs, which stops reading as an entrance
 * and starts reading as a stutter. The set below survives unmounts, so the second visit gets the
 * finished chart with no animation at all.
 *
 * Returns `mounted` (has it been seen yet — gate expensive chart trees on this) and `animate`
 * (should it draw itself, or appear already drawn).
 */
const revealed = new Set<string>();

export function useRevealOnce(key: string): {
  ref: (node: HTMLElement | null) => void;
  mounted: boolean;
  animate: boolean;
} {
  // No IntersectionObserver (old browser, jsdom) is not a reason to hide a chart — it just shows
  // immediately. Deciding that here rather than in the effect keeps the effect free of a
  // synchronous setState, which would cost a second render pass on every mount.
  const observable = typeof IntersectionObserver !== 'undefined';
  const [mounted, setMounted] = useState(() => revealed.has(key) || !observable);
  // Captured at mount: flipping `mounted` must not also flip `animate` out from under the chart,
  // and this component's own reveal must not count as "already seen" for itself.
  const [animate] = useState(() => !revealed.has(key));
  const nodeRef = useRef<HTMLElement | null>(null);

  const ref = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  useEffect(() => {
    if (mounted) {
      revealed.add(key);
      return;
    }
    const node = nodeRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          revealed.add(key);
          setMounted(true);
          observer.disconnect();
        }
      },
      // A sliver is enough: the chart should be ready by the time it is fully on screen.
      { rootMargin: '0px 0px -10% 0px', threshold: 0.01 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [key, mounted]);

  return { ref, mounted, animate };
}
