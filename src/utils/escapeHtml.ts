// HTML-escape strings before interpolating into PDF/email HTML templates; mirrors the
// backend escaper. `&` is replaced first so other entities aren't double-encoded.
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
