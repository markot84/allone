import { describe, expect, it } from 'vitest';
import { resolveProductThumbnailUrl } from './productThumbnailResolver';

describe('resolveProductThumbnailUrl', () => {
  it('uses an exact Magento SKU image when available', () => {
    const result = resolveProductThumbnailUrl('SKU-1', {
      maps: {
        magentoBySku: new Map([['SKU-1', { imageLink: 'https://cdn.example.com/sku-1.jpg' }]]),
      },
    });

    expect(result).toEqual({ url: 'https://cdn.example.com/sku-1.jpg', source: 'magento' });
  });

  it('falls back to Magento item group image for ERP variant SKUs', () => {
    const result = resolveProductThumbnailUrl('140482-100-42', {
      maps: {
        magentoByItemGroupId: new Map([['140482-100', { imageLink: 'https://cdn.example.com/parent.jpg' }]]),
      },
    });

    expect(result).toEqual({ url: 'https://cdn.example.com/parent.jpg', source: 'magento' });
  });

  it('uses the exact Magento child item group when the child has no own image', () => {
    const result = resolveProductThumbnailUrl('1624', {
      maps: {
        magentoBySku: new Map([['1624', { imageLink: '', itemGroupId: '1949' }]]),
        magentoByItemGroupId: new Map([['1949', { imageLink: 'https://cdn.example.com/parent-1949.jpg' }]]),
      },
    });

    expect(result).toEqual({ url: 'https://cdn.example.com/parent-1949.jpg', source: 'magento' });
  });
});
