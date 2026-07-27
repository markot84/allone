/**
 * Unit tests for functions/src/urlValidator.ts — the SSRF guard.
 *
 * Covers all four layers of the defence:
 *   1. isPrivateIp()       — IP-literal classifier (IPv4 + IPv6 forms).
 *   2. validateImportUrl() — sync lexical pre-filter (scheme/creds/obvious hosts/bare IPs).
 *   3. assertPublicUrl()   — async, DNS-resolves the host (dns mocked) and rejects any
 *                            resolved private/reserved address.
 *   4. safeFetch()         — fetch wrapper that re-validates every redirect hop (fetch + dns mocked).
 *
 * Style follows src/services/catalogAlignment.test.ts: nested describe/it, arrange-act-assert.
 * The dns module (node:dns/promises) is mocked because assertPublicUrl/safeFetch call its
 * `lookup`, and global fetch is mocked for safeFetch — no real network is ever touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mock for node:dns/promises so we can control what `lookup` resolves to.
// urlValidator imports `{ lookup } from 'node:dns/promises'`.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

import { assertPublicUrl, isPrivateIp, safeFetch, validateImportUrl } from '../../urlValidator';

describe('isPrivateIp', () => {
  describe('IPv4 — private / reserved ranges return true', () => {
    it('blocks loopback 127.0.0.0/8', () => {
      expect(isPrivateIp('127.0.0.1')).toBe(true);
      expect(isPrivateIp('127.255.255.254')).toBe(true);
    });

    it('blocks RFC1918 10.0.0.0/8', () => {
      expect(isPrivateIp('10.0.0.1')).toBe(true);
      expect(isPrivateIp('10.255.255.255')).toBe(true);
    });

    it('blocks RFC1918 172.16.0.0/12 (and only 16–31 in the second octet)', () => {
      expect(isPrivateIp('172.16.0.1')).toBe(true);
      expect(isPrivateIp('172.31.255.255')).toBe(true);
      // 172.15.x and 172.32.x are public.
      expect(isPrivateIp('172.15.0.1')).toBe(false);
      expect(isPrivateIp('172.32.0.1')).toBe(false);
    });

    it('blocks RFC1918 192.168.0.0/16', () => {
      expect(isPrivateIp('192.168.0.1')).toBe(true);
      expect(isPrivateIp('192.168.255.255')).toBe(true);
    });

    it('blocks link-local 169.254.0.0/16 including cloud metadata 169.254.169.254', () => {
      expect(isPrivateIp('169.254.0.1')).toBe(true);
      expect(isPrivateIp('169.254.169.254')).toBe(true); // GCP/AWS metadata endpoint
    });

    it('blocks CGNAT 100.64.0.0/10', () => {
      expect(isPrivateIp('100.64.0.1')).toBe(true);
      expect(isPrivateIp('100.127.255.255')).toBe(true);
      // 100.63.x and 100.128.x are outside CGNAT → public.
      expect(isPrivateIp('100.63.0.1')).toBe(false);
      expect(isPrivateIp('100.128.0.1')).toBe(false);
    });

    it('blocks this-net 0.0.0.0/8 and multicast/reserved 224.0.0.0+', () => {
      expect(isPrivateIp('0.0.0.0')).toBe(true);
      expect(isPrivateIp('224.0.0.1')).toBe(true);
      expect(isPrivateIp('255.255.255.255')).toBe(true);
    });

    it('treats malformed IPv4 literals as unsafe', () => {
      // isIP rejects these so they reach the family===0 → "not a valid IP literal → unsafe" branch.
      expect(isPrivateIp('999.999.999.999')).toBe(true);
      expect(isPrivateIp('not-an-ip')).toBe(true);
    });
  });

  describe('IPv4 — public addresses return false', () => {
    it('allows well-known public resolvers', () => {
      expect(isPrivateIp('8.8.8.8')).toBe(false);
      expect(isPrivateIp('1.1.1.1')).toBe(false);
    });
  });

  describe('IPv6 — blocked forms return true', () => {
    it('blocks loopback ::1 and unspecified ::', () => {
      expect(isPrivateIp('::1')).toBe(true);
      expect(isPrivateIp('::')).toBe(true);
    });

    it('blocks ULA fc00::/7 (fc.. and fd..)', () => {
      expect(isPrivateIp('fd00::1')).toBe(true);
      expect(isPrivateIp('fc00::1')).toBe(true);
    });

    it('blocks link-local fe80::/10', () => {
      expect(isPrivateIp('fe80::1')).toBe(true);
    });

    it('blocks IPv4-mapped pointing at a private v4 address (::ffff:127.0.0.1)', () => {
      expect(isPrivateIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateIp('::ffff:10.0.0.1')).toBe(true);
    });
  });

  describe('IPv6 — public forms return false', () => {
    it('allows a global-unicast v6 address', () => {
      expect(isPrivateIp('2001:4860:4860::8888')).toBe(false); // Google public DNS over v6
    });

    it('allows IPv4-mapped pointing at a public v4 address', () => {
      expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
    });
  });
});

describe('validateImportUrl (sync lexical pre-filter)', () => {
  describe('rejects', () => {
    it('non-http(s) schemes', () => {
      const r = validateImportUrl('ftp://example.com/feed.xml');
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ ok: false, reason: 'Only http/https URLs are allowed' });
    });

    it('file:// scheme', () => {
      const r = validateImportUrl('file:///etc/passwd');
      expect(r.ok).toBe(false);
    });

    it('a string that does not parse as a URL', () => {
      const r = validateImportUrl('not a url at all');
      expect(r).toEqual({ ok: false, reason: 'Invalid URL' });
    });

    it('embedded credentials', () => {
      const r = validateImportUrl('https://user:pass@example.com/feed.xml');
      expect(r).toEqual({ ok: false, reason: 'URLs with embedded credentials are not allowed' });
    });

    it('the literal hostname localhost', () => {
      const r = validateImportUrl('http://localhost:8080/feed');
      expect(r).toEqual({ ok: false, reason: 'Internal hostnames are not allowed' });
    });

    it('the cloud metadata hostname metadata.google.internal', () => {
      const r = validateImportUrl('http://metadata.google.internal/computeMetadata/v1/');
      expect(r.ok).toBe(false);
    });

    it('*.internal and *.local domain names', () => {
      expect(validateImportUrl('http://db.internal/x').ok).toBe(false);
      expect(validateImportUrl('http://printer.local/x').ok).toBe(false);
    });

    it('a bare loopback IP', () => {
      const r = validateImportUrl('http://127.0.0.1/feed');
      expect(r).toEqual({ ok: false, reason: 'Private/internal IP addresses are not allowed' });
    });

    it('a bare RFC1918 IP', () => {
      expect(validateImportUrl('http://10.0.0.5/feed').ok).toBe(false);
      expect(validateImportUrl('http://192.168.1.1/feed').ok).toBe(false);
    });

    it('the bracketed IPv6 loopback', () => {
      const r = validateImportUrl('http://[::1]/feed');
      expect(r).toEqual({ ok: false, reason: 'Private/internal IP addresses are not allowed' });
    });
  });

  describe('accepts', () => {
    it('a normal public https URL', () => {
      const r = validateImportUrl('https://feeds.example.com/products.xml');
      expect(r).toEqual({ ok: true });
    });

    it('a normal public http URL', () => {
      const r = validateImportUrl('http://shop.example.org/feed.csv');
      expect(r).toEqual({ ok: true });
    });

    it('a public-looking bare IP literal (DNS layer still re-checks later)', () => {
      const r = validateImportUrl('http://8.8.8.8/feed');
      expect(r).toEqual({ ok: true });
    });
  });
});

describe('assertPublicUrl (async DNS-resolving check)', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  it('short-circuits on the lexical pre-filter without touching DNS (private bare IP)', async () => {
    const r = await assertPublicUrl('http://127.0.0.1/feed');
    expect(r).toEqual({ ok: false, reason: 'Private/internal IP addresses are not allowed' });
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('short-circuits on a non-http scheme without touching DNS', async () => {
    const r = await assertPublicUrl('gopher://example.com/');
    expect(r.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects when the hostname resolves to a private address', async () => {
    // A perfectly innocent-looking hostname that DNS points at an internal IP.
    lookupMock.mockResolvedValue([{ address: '10.0.0.7', family: 4 }]);

    const r = await assertPublicUrl('https://internal.example.com/feed');

    expect(r).toEqual({ ok: false, reason: 'Host resolves to a private/internal address' });
    expect(lookupMock).toHaveBeenCalledWith('internal.example.com', { all: true });
  });

  it('rejects when ANY of several resolved addresses is private', async () => {
    lookupMock.mockResolvedValue([
      { address: '93.184.216.34', family: 4 }, // public
      { address: '169.254.169.254', family: 4 }, // metadata — must veto
    ]);

    const r = await assertPublicUrl('https://mixed.example.com/feed');

    expect(r.ok).toBe(false);
  });

  it('accepts when the hostname resolves to a public address', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    const r = await assertPublicUrl('https://public.example.com/feed');

    expect(r).toEqual({ ok: true });
  });

  it('rejects when the host does not resolve (lookup throws)', async () => {
    lookupMock.mockRejectedValue(new Error('ENOTFOUND'));

    const r = await assertPublicUrl('https://nx.example.com/feed');

    expect(r).toEqual({ ok: false, reason: 'Host does not resolve' });
  });

  it('rejects when lookup returns an empty address list', async () => {
    lookupMock.mockResolvedValue([]);

    const r = await assertPublicUrl('https://empty.example.com/feed');

    expect(r).toEqual({ ok: false, reason: 'Host does not resolve' });
  });

  it('does NOT call DNS for a public bare IP literal — validates the literal directly', async () => {
    const r = await assertPublicUrl('https://8.8.8.8/feed');
    expect(r).toEqual({ ok: true });
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe('safeFetch (SSRF-guarded fetch with per-hop re-validation)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    lookupMock.mockReset();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Builds a minimal Response-like object covering the fields safeFetch reads. */
  function makeResponse(status: number, location?: string): Response {
    return {
      status,
      headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location ?? null : null) },
    } as unknown as Response;
  }

  it('refuses a private bare-IP target before issuing any fetch', async () => {
    await expect(safeFetch('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      /Blocked URL \(SSRF protection\)/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a hostname that DNS-resolves to a private address before fetching', async () => {
    lookupMock.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);

    await expect(safeFetch('https://sneaky.example.com/feed')).rejects.toThrow(
      /Host resolves to a private\/internal address/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches a public URL and returns the non-redirect response', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const ok = makeResponse(200);
    fetchMock.mockResolvedValue(ok);

    const res = await safeFetch('https://feeds.example.com/products.xml');

    expect(res).toBe(ok);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // safeFetch must always pin redirect:'manual' so it controls hop-following itself.
    expect(fetchMock).toHaveBeenCalledWith('https://feeds.example.com/products.xml', {
      redirect: 'manual',
    });
  });

  it('re-validates a redirect hop and BLOCKS a 302 that points at a private host', async () => {
    // First hop: public host → DNS public → fetch returns a 302 to an internal host.
    // Second hop must be re-validated and rejected by the DNS layer.
    lookupMock.mockImplementation(async (host: string) => {
      if (host === 'feeds.example.com') return [{ address: '93.184.216.34', family: 4 }];
      if (host === 'internal.evil.example') return [{ address: '169.254.169.254', family: 4 }];
      return [];
    });
    fetchMock.mockResolvedValue(makeResponse(302, 'https://internal.evil.example/steal'));

    await expect(safeFetch('https://feeds.example.com/products.xml')).rejects.toThrow(
      /Blocked URL \(SSRF protection\)/,
    );

    // The first (public) hop WAS fetched; the redirect target was blocked before a second fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lookupMock).toHaveBeenCalledWith('internal.evil.example', { all: true });
  });

  it('blocks a redirect whose Location is a bare private IP', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    fetchMock.mockResolvedValue(makeResponse(301, 'http://192.168.0.1/admin'));

    await expect(safeFetch('https://feeds.example.com/products.xml')).rejects.toThrow(
      /Blocked URL \(SSRF protection\)/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to another PUBLIC host and returns the final response', async () => {
    lookupMock.mockImplementation(async (host: string) => {
      if (host === 'a.example.com') return [{ address: '93.184.216.34', family: 4 }];
      if (host === 'b.example.com') return [{ address: '8.8.8.8', family: 4 }];
      return [];
    });
    const final = makeResponse(200);
    fetchMock
      .mockResolvedValueOnce(makeResponse(302, 'https://b.example.com/final'))
      .mockResolvedValueOnce(final);

    const res = await safeFetch('https://a.example.com/start');

    expect(res).toBe(final);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://b.example.com/final', { redirect: 'manual' });
  });

  it('throws when too many redirects are followed (exceeds maxRedirects)', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    // Always redirect to a public host, forcing the hop counter to run out.
    fetchMock.mockResolvedValue(makeResponse(302, 'https://loop.example.com/next'));

    await expect(
      safeFetch('https://loop.example.com/start', {}, { maxRedirects: 2 }),
    ).rejects.toThrow(/too many redirects/);

    // hop 0,1,2 each fetch once before the loop exits (maxRedirects=2 → 3 iterations).
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('preserves caller-supplied init (method/headers) while overriding redirect mode', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    fetchMock.mockResolvedValue(makeResponse(200));

    await safeFetch('https://feeds.example.com/x', {
      method: 'POST',
      headers: { 'X-Test': '1' },
    });

    expect(fetchMock).toHaveBeenCalledWith('https://feeds.example.com/x', {
      method: 'POST',
      headers: { 'X-Test': '1' },
      redirect: 'manual',
    });
  });
});
