import { describe, expect, it } from 'vitest';
import { __test } from './useMagentoProductEnrichment';

const { buildImageLink, buildProductLink, inferMagentoMediaBaseUrl } = __test;

describe('useMagentoProductEnrichment helpers', () => {
  describe('buildImageLink', () => {
    it('επιστρέφει absolute URL αν δοθεί http(s)', () => {
      expect(buildImageLink('https://shop.gr/pub/media', 'https://cdn.example.com/img.jpg')).toBe('https://cdn.example.com/img.jpg');
    });
    it('χτίζει με βάση media + catalog/product πρόθεμα', () => {
      expect(buildImageLink('https://safeblock.gr/pub/media', '/s/k/sku-001.jpg')).toBe(
        'https://safeblock.gr/pub/media/catalog/product/s/k/sku-001.jpg'
      );
    });
    it('αφαιρεί διπλά slashes χωρίς να χαλάει το scheme', () => {
      expect(buildImageLink('https://shop.gr/pub/media/', '/a/b/c.jpg')).toBe('https://shop.gr/pub/media/catalog/product/a/b/c.jpg');
    });
    it('επιστρέφει κενό αν λείπει image ή media', () => {
      expect(buildImageLink('https://shop.gr/pub/media', '')).toBe('');
      expect(buildImageLink('', '/a/b.jpg')).toBe('');
    });
  });

  describe('buildProductLink', () => {
    it('χρησιμοποιεί url_key όταν υπάρχει', () => {
      expect(buildProductLink('https://safeblock.gr', 'safeblock-pro-100', 'SBP-100')).toBe('https://safeblock.gr/safeblock-pro-100.html');
    });
    it('fallback σε catalog/product/view/sku όταν δεν υπάρχει url_key', () => {
      expect(buildProductLink('https://safeblock.gr/', '', 'SBP-100')).toBe('https://safeblock.gr/catalog/product/view/sku/SBP-100');
    });
    it('επιστρέφει κενό αν λείπει storeWebUrl', () => {
      expect(buildProductLink('', 'foo', 'BAR-1')).toBe('');
    });
  });

  describe('inferMagentoMediaBaseUrl', () => {
    it('κρατάει configured mediaBaseUrl όταν υπάρχει', () => {
      expect(inferMagentoMediaBaseUrl('https://shop.gr/pub/media', 'https://shop.gr')).toBe('https://shop.gr/pub/media');
    });

    it('κάνει fallback στο /media από storeUrl όταν λείπει mediaBaseUrl', () => {
      expect(inferMagentoMediaBaseUrl('', 'https://www.e-tennis.gr/')).toBe('https://www.e-tennis.gr/media');
    });
  });
});
