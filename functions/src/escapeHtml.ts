// SEC-M1: HTML-escape member-controlled strings before interpolating them into
// outbound email HTML built by string concatenation. Same impl as the inline
// escaper at index.ts:3029 — extracted so the notification + digest mailers share it.
// `&` is replaced first so the other entities aren't double-encoded.
export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
