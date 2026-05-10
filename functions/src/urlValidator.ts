/**
 * SSRF protection: validates that a user-supplied URL is a public internet resource
 * and not an internal/cloud metadata endpoint.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
  'kubernetes.default.svc',
]);

const BLOCKED_IP_PREFIXES = [
  '10.',
  '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.',
  '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
  '192.168.',
  '127.',
  '0.',
  '169.254.',  // link-local / cloud metadata (AWS, GCP, Azure)
  'fd',        // IPv6 ULA
  'fe80',      // IPv6 link-local
  '::1',
  '::',
];

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

  const host = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: 'Internal hostnames are not allowed' };
  }

  for (const prefix of BLOCKED_IP_PREFIXES) {
    if (host.startsWith(prefix)) {
      return { ok: false, reason: 'Private/internal IP addresses are not allowed' };
    }
  }

  if (host.endsWith('.internal') || host.endsWith('.local')) {
    return { ok: false, reason: 'Internal domain names are not allowed' };
  }

  return { ok: true };
}
