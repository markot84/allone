/**
 * Connector-agnostic SKU thumbnail resolution (Magento, import image_url, absolute URLs).
 */

export type ThumbnailSource = 'import' | 'magento' | 'none';

export type ThumbnailLookupMaps = {
  magentoBySku?: Map<string, { imageLink: string }>;
  magentoBySkuLower?: Map<string, { imageLink: string }>;
};

function normalizeImageUrl(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

/** ERP / import field on unified products. */
export function imageUrlFromProductRecord(product: unknown): string {
  if (!product || typeof product !== 'object') return '';
  const row = product as Record<string, unknown>;
  return normalizeImageUrl(
    (row.image_url as string) || (row.image_link as string) || (row.image as string)
  );
}

export function resolveProductThumbnailUrl(
  sku: string,
  options?: {
    importImageUrl?: string;
    maps?: ThumbnailLookupMaps;
  }
): { url: string; source: ThumbnailSource } {
  const importUrl = normalizeImageUrl(options?.importImageUrl);
  if (importUrl) return { url: importUrl, source: 'import' };

  const key = sku.trim();
  if (!key) return { url: '', source: 'none' };

  const maps = options?.maps;
  const magento =
    maps?.magentoBySku?.get(key) ?? maps?.magentoBySkuLower?.get(key.toLowerCase());
  const magentoUrl = normalizeImageUrl(magento?.imageLink);
  if (magentoUrl) return { url: magentoUrl, source: 'magento' };

  return { url: '', source: 'none' };
}
