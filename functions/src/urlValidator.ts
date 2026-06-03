/**
 * SSRF protection: validates that a user-supplied URL is a public internet
 * resource and not an internal/cloud-metadata endpoint.
 *
 * Two layers:
 *   1. validateImportUrl()  — sync, lexical pre-filter (scheme/creds/obvious hosts).
 *   2. assertPublicUrl()    — async, DNS-resolves the host and rejects if ANY
 *                             resolved address is private/reserved. Catches the
 *                             lexical bypasses (decimal/hex/IPv6 IPs, hostnames
 *                             that resolve to internal ranges).
 *   3. safeFetch()          — assertPublicUrl + `redirect: 'manual'`, re-validating
 *                             every redirect hop so a 30x can't bounce to an
 *                             internal address.
 *
 * Residual: full DNS-rebinding protection (host resolves public at validation,
 * private at connection time) would need connection-level IP pinning. safeFetch
 * re-validates per hop, which closes the redirect vector; rebinding within a
 * single hop remains a known, lower-severity gap.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'kubernetes.default.svc',
]);

function ipv4IsPrivateOrReserved(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed → treat as unsafe
  }
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;          // this-net / private / loopback
  if (a === 169 && b === 254) return true;                    // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;           // private
  if (a === 192 && b === 168) return true;                    // private
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT 100.64/10
  if (a === 192 && b === 0 && c === 0) return true;           // 192.0.0/24 (IETF)
  if (a >= 224) return true;                                  // multicast / reserved
  return false;
}

/** True if an IP literal points at a private, loopback, link-local or reserved address. */
export function isPrivateIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return ipv4IsPrivateOrReserved(ip);
  if (fam === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return true;                       // loopback / unspecified
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);            // IPv4-mapped
    if (mapped) return ipv4IsPrivateOrReserved(mapped[1]);
    if (low.startsWith('fc') || low.startsWith('fd')) return true;       // ULA fc00::/7
    if (/^fe[89ab]/.test(low)) return true;                              // link-local fe80::/10
    return false;
  }
  return true; // not a valid IP literal → unsafe
}

/** Sync lexical pre-filter. Kept for backward-compat (importData) and as a fast reject. */
export function validateImportUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Only http/https URLs are allowed' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'URLs with embedded credentials are not allowed' };
  }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: 'Internal hostnames are not allowed' };
  }
  if (host.endsWith('.internal') || host.endsWith('.local')) {
    return { ok: false, reason: 'Internal domain names are not allowed' };
  }
  if (isIP(host) && isPrivateIp(host)) {
    return { ok: false, reason: 'Private/internal IP addresses are not allowed' };
  }
  return { ok: true };
}

/**
 * Async SSRF check: lexical pre-filter + DNS resolution. Rejects if the host
 * resolves to any private/reserved address (covers decimal/hex/IPv6 IP forms and
 * hostnames pointed at internal ranges).
 */
export async function assertPublicUrl(raw: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pre = validateImportUrl(raw);
  if (!pre.ok) return pre;
  const host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    return isPrivateIp(host) ? { ok: false, reason: 'Private/internal IP addresses are not allowed' } : { ok: true };
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    return { ok: false, reason: 'Host does not resolve' };
  }
  if (!addrs.length) return { ok: false, reason: 'Host does not resolve' };
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      return { ok: false, reason: 'Host resolves to a private/internal address' };
    }
  }
  return { ok: true };
}

/**
 * fetch() wrapper that enforces SSRF protection and re-validates every redirect
 * hop. Throws on a blocked URL so callers handle it like a connection failure.
 * Drop-in for `fetch(url, init)` on user-supplied URLs.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 4;
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const check = await assertPublicUrl(current);
    if (!check.ok) throw new Error(`Blocked URL (SSRF protection): ${check.reason}`);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('Blocked URL (SSRF protection): too many redirects');
}
