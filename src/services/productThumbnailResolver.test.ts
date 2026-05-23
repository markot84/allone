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
});
