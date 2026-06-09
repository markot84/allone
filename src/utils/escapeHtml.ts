// PP-18: HTML-escape member-controlled strings before interpolating them into
// PDF/email HTML templates built by string concatenation. Mirrors the backend
// escaper at functions/src/index.ts:3029 so frontend and backend escaping match.
// `&` is replaced first so the other entities aren't double-encoded.
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
