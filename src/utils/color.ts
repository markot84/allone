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

/** Contrast ratio against pure white — the app background, so this is the ratio that usually matters. */
export function contrastOnWhite(value: string): number | null {
  const rgb = toRgb(value);
  if (!rgb) return null;
  return 1.05 / (relativeLuminance(rgb) + 0.05);
}

/** Mix a colour toward white. `amount` 0 = untouched, 1 = white. */
export function mixWithWhite(value: string, amount: number): string {
  const rgb = toRgb(value);
  if (!rgb) return value;
  const t = Math.min(1, Math.max(0, amount));
  const mixed = rgb.map((c) => Math.round(c + (255 - c) * t)) as Rgb;
  return `#${mixed.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Dark or light text over a given background, whichever wins on contrast.
 *
 * Needed where the background is computed rather than chosen — a treemap tile whose fill encodes a
 * value cannot have its label colour decided in advance.
 */
export function readableTextOn(background: string, dark = '#20293A', light = '#FFFFFF'): string {
  const rgb = toRgb(background);
  if (!rgb) return dark;
  const bg = relativeLuminance(rgb);
  const darkRgb = toRgb(dark);
  const lightRgb = toRgb(light);
  if (!darkRgb || !lightRgb) return dark;
  const ratio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(bg, relativeLuminance(darkRgb)) >= ratio(bg, relativeLuminance(lightRgb)) ? dark : light;
}
