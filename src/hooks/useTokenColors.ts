import { useMemo } from 'react';
import { readTokenColor } from '../utils/cssToken';
import { useTheme } from './useTheme';

/**
 * Resolved token colours that follow the active theme.
 *
 * Chart libraries write paint values straight into SVG attributes and cannot resolve `var(...)`
 * themselves, so their colours have to be read out of the computed styles. Reading them in a
 * `useMemo` with an empty dependency array — which is what the chart components did while there was
 * one theme — pins them to whichever theme was active when the component first mounted. Switching
 * to the cockpit would then leave a chart drawing near-black axis labels on a navy canvas until
 * something unrelated happened to re-render it.
 *
 * Anything expressible in CSS should reference the token directly instead of calling this.
 *
 *     const palette = useTokenColors({
 *       shape: ['--brand-orange', '#FE630C'],
 *       grid:  ['--border', '#E4E7EC'],
 *     });
 */
export function useTokenColors<K extends string>(
  spec: Record<K, readonly [token: string, fallback: string]>
): Record<K, string> {
  const { theme } = useTheme();
  // Stable across renders as long as the caller passes a literal, which every call site does.
  const key = Object.entries(spec)
    .map(([name, pair]) => `${name}:${(pair as readonly [string, string]).join(',')}`)
    .join('|');

  return useMemo(() => {
    const resolved = {} as Record<K, string>;
    for (const entry of key.split('|')) {
      const [name, rest] = entry.split(':');
      const [token, fallback] = rest.split(',');
      resolved[name as K] = readTokenColor(token, fallback);
    }
    return resolved;
    // `theme` is the trigger, not an input: it is never read below, but it is exactly what makes
    // getComputedStyle return different values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, theme]);
}
