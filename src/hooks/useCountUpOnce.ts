import { useEffect, useState } from 'react';

/**
 * Counts a figure up to its value — once per session, per figure.
 *
 * The "once" is the entire point. A number that re-animates every time you navigate back to the
 * dashboard stops being an arrival and becomes a delay: you are waiting to read something you have
 * already read. Keyed by the FIGURE (metric + brand + period), not by the component, so remounting
 * the same card does not replay it while switching to a different brand does.
 *
 * The set is module-level rather than state because it has to outlive every mount in the session
 * and must not survive a reload — sessionStorage would make it stickier than intended.
 */
const counted = new Set<string>();

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function willAnimate(value: number, key: string): boolean {
  return Number.isFinite(value) && !counted.has(key) && !prefersReducedMotion();
}

export function useCountUpOnce(value: number, key: string, durationMs = 900): number {
  /*
   * State holds PROGRESS (0→1), not the displayed number, and the caller gets `value * progress`.
   *
   * Holding the number instead would mean writing `setDisplay(value)` synchronously inside the
   * effect for every case that must not animate — which is both a lint error
   * (react-hooks/set-state-in-effect) and a real bug source: a figure that updates while the count
   * is not running would need an extra render to catch up. Deriving it means the non-animating
   * path is `value * 1`, with no effect involved at all.
   */
  const [progress, setProgress] = useState(() => (willAnimate(value, key) ? 0 : 1));

  useEffect(() => {
    if (!willAnimate(value, key)) return;

    counted.add(key);
    const start = performance.now();
    // Cubic ease-out: fast enough to read as a result landing, not as a progress bar.
    const ease = (t: number) => 1 - (1 - t) ** 3;

    let frame = requestAnimationFrame(function step(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      setProgress(ease(t));
      if (t < 1) frame = requestAnimationFrame(step);
    });

    return () => cancelAnimationFrame(frame);
    /*
     * `value` is deliberately not a dependency. It is read here only to reject NaN before starting;
     * the animation itself is driven by progress and multiplied by whatever `value` currently is.
     * Including it would restart the effect whenever the figure refreshed mid-count, and since the
     * key is already in `counted` by then the guard would return early — cancelling the frame and
     * freezing the number partway up.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, durationMs]);

  return value * progress;
}
