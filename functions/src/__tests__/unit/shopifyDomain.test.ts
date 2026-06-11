/**
 * SEC-C1 — normalizeShopDomain is the gate in front of every Shopify request: the token
 * exchange POSTs the global SHOPIFY_API_SECRET to https://{domain}/..., and the sync path
 * sends the shop access token there. Anything but a strict {store}.myshopify.com host
 * must throw — including values already stored in the member-writable connectors doc.
 */
import { describe, it, expect } from 'vitest';
import { normalizeShopDomain } from '../../shopifyDomain';

describe('normalizeShopDomain', () => {
  it('accepts a bare store name and canonicalizes it', () => {
    expect(normalizeShopDomain('mystore')).toBe('mystore.myshopify.com');
  });

  it('accepts the canonical host, urls, and mixed case/whitespace', () => {
    expect(normalizeShopDomain('mystore.myshopify.com')).toBe('mystore.myshopify.com');
    expect(normalizeShopDomain('https://mystore.myshopify.com')).toBe('mystore.myshopify.com');
    expect(normalizeShopDomain('https://mystore.myshopify.com/')).toBe('mystore.myshopify.com');
    expect(normalizeShopDomain('  MyStore.MyShopify.com  ')).toBe('mystore.myshopify.com');
    expect(normalizeShopDomain('my-store-2.myshopify.com')).toBe('my-store-2.myshopify.com');
  });

  it('strips paths/query before validating, keeping only a valid host', () => {
    expect(normalizeShopDomain('https://mystore.myshopify.com/admin?x=1')).toBe('mystore.myshopify.com');
  });

  it('rejects foreign hosts (the SHOPIFY_API_SECRET exfil path)', () => {
    expect(() => normalizeShopDomain('evil.com')).toThrow();
    expect(() => normalizeShopDomain('evil.com.myshopify.com.attacker.net')).toThrow();
    expect(() => normalizeShopDomain('mystore.myshopify.com.evil.com')).toThrow();
  });

  it('rejects IPs, ports and userinfo (SSRF forms)', () => {
    expect(() => normalizeShopDomain('127.0.0.1')).toThrow();
    expect(() => normalizeShopDomain('169.254.169.254')).toThrow();
    expect(() => normalizeShopDomain('mystore.myshopify.com:8080')).toThrow();
    expect(() => normalizeShopDomain('user@mystore.myshopify.com')).toThrow();
    expect(() => normalizeShopDomain('evil.com/mystore.myshopify.com')).toThrow();
  });

  it('rejects nested subdomains, empty and junk input', () => {
    expect(() => normalizeShopDomain('a.b.myshopify.com')).toThrow();
    expect(() => normalizeShopDomain('')).toThrow();
    expect(() => normalizeShopDomain('-leadinghyphen.myshopify.com')).toThrow();
    expect(() => normalizeShopDomain('.myshopify.com')).toThrow();
  });
});
