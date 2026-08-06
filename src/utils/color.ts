/**
 * Colour maths shared by anything that has to reason about a colour rather than just name it.
 *
 * The WCAG relative-luminance formula lives here once. It backs both the `/styleguide` contrast
 * table (which proves colors.md's claims against the live tokens) and any component that picks a
 * label colour at runtime — two copies of this would eventually disagree, and the disagreement
 * would be invisible.
 */

export type Rgb = [number, number, number];

/** Accepts `#rrggbb`, `#rgb`, `rgb(...)` and `rgba(...)` — whatever getComputedStyle hands back. */
export function toRgb(value: string): Rgb | null {
  const input = value.trim();
  const long = /^#([0-9a-f]{6})$/i.exec(input);
  if (long) {
    const n = parseInt(long[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const short = /^#([0-9a-f]{3})$/i.exec(input);
  if (short) {
    const [r, g, b] = short[1].split('');
    return [parseInt(r + r, 16), parseInt(g + g, 16), parseInt(b + b, 16)];
  }
  const fn = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(input);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return null;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio against pure white. */
export function contrastOnWhite(value: string): number | null {
  const rgb = toRgb(value);
  if (!rgb) return null;
  return 1.05 / (relativeLuminance(rgb) + 0.05);
}

/**
 * Contrast ratio between any two colours.
 *
 * `contrastOnWhite` assumed the canvas, which held for exactly as long as there was one theme. A
 * ratio measured against white says nothing useful about text on the cockpit's navy — it is not a
 * stricter answer, it is an answer to a different question.
 */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = toRgb(foreground);
  const bg = toRgb(background);
  if (!fg || !bg) return null;
  const a = relativeLuminance(fg);
  const b = relativeLuminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * Mix a colour toward another. `amount` 0 = untouched, 1 = fully the target.
 *
 * "Toward white" was the right idea for the wrong reason: what a fade toward white actually
 * expressed was "less of this, more of the surface behind it". On a dark canvas the surface is not
 * white, so fading toward white makes a weak value the BRIGHTEST thing on screen — the exact
 * opposite of what the encoding means. Passing the surface in keeps the meaning in both themes.
 */
export function mixToward(value: string, target: string, amount: number): string {
  const rgb = toRgb(value);
  const to = toRgb(target);
  if (!rgb || !to) return value;
  const t = Math.min(1, Math.max(0, amount));
  const mixed = rgb.map((c, i) => Math.round(c + (to[i] - c) * t)) as Rgb;
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Mix a colour toward white. `amount` 0 = untouched, 1 = white. */
export function mixWithWhite(value: string, amount: number): string {
  return mixToward(value, '#FFFFFF', amount);
}

/**
 * Dark or light text over a given background, whichever wins on contrast.
 *
 * Needed where the background is computed rather than chosen — a treemap tile whose fill encodes a
 * value cannot have its label colour decided in advance.
 */
export function readableTextOn(background: string, dark = '#101828', light = '#FFFFFF'): string {
  const rgb = toRgb(background);
  if (!rgb) return dark;
  const bg = relativeLuminance(rgb);
  const darkRgb = toRgb(dark);
  const lightRgb = toRgb(light);
  if (!darkRgb || !lightRgb) return dark;
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(bg, relativeLuminance(darkRgb)) >= ratio(bg, relativeLuminance(lightRgb)) ? dark : light;
}
