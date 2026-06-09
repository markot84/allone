/**
 * SEC-M9 — normalizeSmartUrl must pin the API-supplied Epsilon `url2` to an https *.epsilonnet.gr
 * host before the connector reattaches the bearer JWT to it. A compromised/MITM upstream must not
 * be able to redirect the token to an arbitrary host.
 */
import { describe, it, expect } from 'vitest';
import { normalizeSmartUrl } from '../../epsilonNetConnector';

describe('normalizeSmartUrl (SEC-M9)', () => {
  it('accepts an https *.epsilonnet.gr host and ensures a trailing slash', () => {
    expect(normalizeSmartUrl('https://smart.epsilonnet.gr/api')).toBe('https://smart.epsilonnet.gr/api/');
    expect(normalizeSmartUrl('https://smart.epsilonnet.gr/')).toBe('https://smart.epsilonnet.gr/');
  });

  it('accepts the apex epsilonnet.gr host', () => {
    expect(normalizeSmartUrl('https://epsilonnet.gr')).toBe('https://epsilonnet.gr/');
  });

  it('adds https:// when the scheme is missing, then validates the host', () => {
    expect(normalizeSmartUrl('smart.epsilonnet.gr')).toBe('https://smart.epsilonnet.gr/');
  });

  it('rejects a non-epsilonnet host → empty string (bearer-token exfil guard)', () => {
    expect(normalizeSmartUrl('https://attacker.com/api/')).toBe('');
    expect(normalizeSmartUrl('https://epsilonnet.gr.attacker.com/')).toBe('');
    expect(normalizeSmartUrl('https://evil-epsilonnet.gr/')).toBe('');
  });

  it('rejects non-TLS (http) even for an epsilonnet host → empty string', () => {
    expect(normalizeSmartUrl('http://smart.epsilonnet.gr/')).toBe('');
  });

  it('returns empty for empty / unparseable input', () => {
    expect(normalizeSmartUrl('')).toBe('');
    expect(normalizeSmartUrl('not a url')).toBe('');
  });
});
