import { describe, expect, it } from 'vitest';
import { __test } from './useMagentoProductEnrichment';

const { buildImageLink, buildProductLink, inferMagentoMediaBaseUrl } = __test;

describe('useMagentoProductEnrichment helpers', () => {
  describe('buildImageLink', () => {
    it('returns the absolute URL when given an http(s) link', () => {
      expect(buildImageLink('https://shop.gr/pub/media', 'https://cdn.example.com/img.jpg')).toBe('https://cdn.example.com/img.jpg');
    });
    it('builds from the media base with the catalog/product prefix', () => {
      expect(buildImageLink('https://shop.gr/pub/media', '/s/k/sku-001.jpg')).toBe(
        'https://shop.gr/pub/media/catalog/product/s/k/sku-001.jpg'
      );
    });
    it('collapses double slashes without breaking the scheme', () => {
      expect(buildImageLink('https://shop.gr/pub/media/', '/a/b/c.jpg')).toBe('https://shop.gr/pub/media/catalog/product/a/b/c.jpg');
    });
    it('returns empty when the image or media base is missing', () => {
      expect(buildImageLink('https://shop.gr/pub/media', '')).toBe('');
      expect(buildImageLink('', '/a/b.jpg')).toBe('');
    });
    it('ignores Magento no_selection so it falls back to the parent image', () => {
      expect(buildImageLink('https://shop.gr/pub/media', 'no_selection')).toBe('');
    });
  });

  describe('buildProductLink', () => {
    it('uses url_key when present', () => {
      expect(buildProductLink('https://shop.gr', 'demo-pro-100', 'DEMO-100')).toBe('https://shop.gr/demo-pro-100.html');
    });
    it('falls back to catalog/product/view/sku when url_key is missing', () => {
      expect(buildProductLink('https://shop.gr/', '', 'DEMO-100')).toBe('https://shop.gr/catalog/product/view/sku/DEMO-100');
    });
    it('returns empty when storeWebUrl is missing', () => {
      expect(buildProductLink('', 'foo', 'BAR-1')).toBe('');
    });
  });

  describe('inferMagentoMediaBaseUrl', () => {
    it('keeps the configured mediaBaseUrl when present', () => {
      expect(inferMagentoMediaBaseUrl('https://shop.gr/pub/media', 'https://shop.gr')).toBe('https://shop.gr/pub/media');
    });

    it('falls back to /media from storeUrl when mediaBaseUrl is missing', () => {
      expect(inferMagentoMediaBaseUrl('', 'https://www.shop.gr/')).toBe('https://www.shop.gr/media');
    });
  });
});
