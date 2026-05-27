/**
 * Connector-agnostic SKU thumbnail resolution (Magento, import image_url, absolute URLs).
 */

export type ThumbnailSource = 'import' | 'magento' | 'none';
type ThumbnailLookupValue = { imageLink: string; itemGroupId?: string };

export type ThumbnailLookupMaps = {
  magentoBySku?: Map<string, ThumbnailLookupValue>;
  magentoBySkuLower?: Map<string, ThumbnailLookupValue>;
  magentoByItemGroupId?: Map<string, ThumbnailLookupValue>;
  magentoByItemGroupIdLower?: Map<string, ThumbnailLookupValue>;
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

  const explicitParentKey = magento?.itemGroupId?.trim();
  if (explicitParentKey) {
    const explicitParentMagento =
      maps?.magentoByItemGroupId?.get(explicitParentKey) ??
      maps?.magentoByItemGroupIdLower?.get(explicitParentKey.toLowerCase());
    const explicitParentMagentoUrl = normalizeImageUrl(explicitParentMagento?.imageLink);
    if (explicitParentMagentoUrl) return { url: explicitParentMagentoUrl, source: 'magento' };
  }

  const parentKey = fallbackProductKey(key);
  const parentMagento =
    maps?.magentoByItemGroupId?.get(parentKey) ??
    maps?.magentoByItemGroupIdLower?.get(parentKey.toLowerCase());
  const parentMagentoUrl = normalizeImageUrl(parentMagento?.imageLink);
  if (parentMagentoUrl) return { url: parentMagentoUrl, source: 'magento' };

  return { url: '', source: 'none' };
}

const SIZE_SUFFIXES = new Set([
  'xxs',
  'xs',
  's',
  'm',
  'l',
  'xl',
  'xxl',
  'xxxl',
  '2xs',
  '2xl',
  '3xl',
  '4xl',
  '5xl',
  'one',
  'onesize',
  'os',
  'uni',
  'unique',
]);

function fallbackProductKey(sku: string): string {
  const normalized = sku.trim().replace(/\s+/g, '').toUpperCase();
  const parts = normalized.split(/[-_/]/).filter(Boolean);
  if (parts.length <= 1) return normalized;
  const last = parts[parts.length - 1].toLowerCase();
  const looksSize = SIZE_SUFFIXES.has(last) || /^\d{1,3}([.,]\d)?$/.test(last) || /^(eu|us|uk)?\d{1,3}([.,]\d)?$/.test(last);
  return looksSize ? parts.slice(0, -1).join('-') : parts[0];
}
