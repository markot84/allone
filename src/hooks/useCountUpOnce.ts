import { useEffect, useRef, useState } from 'react';

/** Session-scoped, so a re-render or a return to the dashboard does not replay the count. */
const counted = new Set<string>();

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Counts a number up to its value, once.
 *
 * The point is not decoration — it is that a figure which arrives by moving is read as a
 * measurement of something live, while the same figure printed instantly is read as a label. It
 * earns that only if it is rare: a ticker that replays on every render is a distraction, and one
 * that replays every time you navigate back to the dashboard is an irritation. Hence `key`, which
 * should identify the FIGURE (metric plus brand plus period), not the component instance.
 *
 * Returns the target value untouched when the animation has already run, when the user has asked
 * for reduced motion, or when the value is not finite — callers can render the result
 * unconditionally.
 */
export function useCountUpOnce(value: number, key: string, durationMs = 900): number {
  const shouldAnimate = Number.isFinite(value) && !counted.has(key) && !prefersReducedMotion();
  const [display, setDisplay] = useState(() => (shouldAnimate ? 0 : value));
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (!shouldAnimate) {
      setDisplay(value);
      return;
    }
    counted.add(key);

    const start = performance.now();
    // Ease-out cubic: fast enough at the start to feel like a reading settling rather than a
    // progress bar, and it lands softly instead of stopping dead on the final digit.
    const ease = (t: number) => 1 - (1 - t) ** 3;

    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setDisplay(value * ease(progress));
      if (progress < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
    // `shouldAnimate` is derived from the other two and would only re-run this on the same inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, key, durationMs]);

  return display;
}
