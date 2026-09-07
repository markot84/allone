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

describe('fetchMagentoProductsForSkus (PER-335 scoped fetch)', () => {
  it('chunks into 30-value in-queries over sku and itemGroupId, deduping results by id', async () => {
    const calls: Array<unknown[]> = [];
    const { FirestoreService } = await import('../services/firestore');
    const orig = FirestoreService.getDocuments;
    FirestoreService.getDocuments = (async (...args: unknown[]) => {
      calls.push(args);
      // Same doc returned by both the sku and itemGroupId query → must dedupe.
      return [{ id: 'doc-1', sku: 'A-1' }];
    }) as typeof FirestoreService.getDocuments;
    try {
      const skus = Array.from({ length: 61 }, (_, i) => `SKU-${i}`);
      const out = await __test.fetchMagentoProductsForSkus('e-tennis', skus);
      // 61 skus → 3 chunks × 2 queries (sku + itemGroupId)
      expect(calls.length).toBe(6);
      expect(calls.every((c) => c[2] === 'e-tennis')).toBe(true);
      expect(out).toEqual([{ id: 'doc-1', sku: 'A-1' }]);
    } finally {
      FirestoreService.getDocuments = orig;
    }
  });
});

describe('bounded fan-out', () => {
  it('mapWithLimit never runs more than the limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await __test.mapWithLimit(Array.from({ length: 50 }, (_, i) => i), 8, async (n: number) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return n * 2;
    });
    expect(peak).toBeLessThanOrEqual(8);
    expect(out).toEqual(Array.from({ length: 50 }, (_, i) => i * 2));
  });

  it('reads the collection once above the chunk ceiling and keeps only the wanted rows', async () => {
    const calls: Array<unknown[]> = [];
    const { FirestoreService } = await import('../services/firestore');
    const orig = FirestoreService.getDocuments;
    FirestoreService.getDocuments = (async (...args: unknown[]) => {
      calls.push(args);
      return [
        { id: 'wanted-sku', sku: 'SKU-1' },
        { id: 'wanted-parent', sku: 'OTHER', itemGroupId: 'SKU-2' },
        { id: 'unrelated', sku: 'NOT-IN-FEED', itemGroupId: 'NOPE' },
      ];
    }) as typeof FirestoreService.getDocuments;
    try {
      const skus = Array.from({ length: __test.MAX_CHUNKED_SKUS + 1 }, (_, i) => `SKU-${i}`);
      const out = await __test.fetchMagentoProductsForSkus('e-tennis', skus);
      // One collection read instead of 2 × ceil(n/30) concurrent queries.
      expect(calls.length).toBe(1);
      expect((calls[0] as unknown[])[1]).toEqual([]);
      expect(out.map((d) => (d as { id: string }).id)).toEqual(['wanted-sku', 'wanted-parent']);
    } finally {
      FirestoreService.getDocuments = orig;
    }
  });
});
