/**
 * Read a design token's resolved value.
 *
 * Needed where a colour has to be handed to something that cannot resolve `var(...)` itself —
 * canvas, and chart libraries that write paint values straight into SVG attributes. Everywhere
 * else, reference the token directly in CSS instead of calling this.
 */
export function readTokenColor(token: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return value || fallback;
}
