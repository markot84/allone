
/**
 * PMax / store-visit campaigns: GA may label the action as Purchase with ~1€ per conversion.
 */
function isPhantomStoreVisitPurchaseRow(
  actionName: string,
  row: { conversions?: number; value?: number },
  campaignName?: string
): boolean {
  const conv = row.conversions ?? 0;
  const val = row.value ?? 0;
  const avgPerConv = conv > 0 ? val / conv : val;

  const cn = (campaignName || '').toLowerCase();
  if (
    (/store\s*visits?|shop\s*visits?/i.test(cn) || (/visit/i.test(cn) && /store|shop/i.test(cn))) &&
    avgPerConv >= 0.99 &&
    avgPerConv <= 1.01
  ) {
    return true;
  }

  if (val < 0.99 || val > 1.01) return false;
  const n = actionName.toLowerCase();
  if (/store\s*visits?|shop\s*visits?/i.test(n)) return true;
  if (/visit/i.test(n) && /store|shop/i.test(n)) return true;
  const gEp = '\u03b5\u03c0\u03af\u03c3\u03ba\u03b5\u03c8\u03b7';
  const gEp2 = '\u03b5\u03c0\u03b9\u03c3\u03ba\u03b5\u03c8\u03b7';
  const gKat = '\u03ba\u03b1\u03c4\u03ac\u03c3\u03c4\u03b7\u03bc\u03b1';
  const gKat2 = '\u03ba\u03b1\u03c4\u03b1\u03c3\u03c4\u03b7\u03bc\u03b1';
  if ((n.includes(gEp) || n.includes(gEp2)) && (n.includes(gKat) || n.includes(gKat2))) return true;
  return false;
}

function isGoogleAnalyticsImportLabel(name: string): boolean {
  const n = name.toLowerCase();
  if (/imported?\s+from\s+google\s+analytics/.test(n)) return true;
  if (/from\s+google\s+analytics/.test(n)) return true;
  if (/\bgoogle\s+analytics\s*(\(4\)|4)?\b/.test(n)) return true;
  if (/\bga4\b/.test(n)) return true;
  if (/\bga\s*\(?4\)?\b/.test(n)) return true;
  if (/import.*\b(ga4|google\s+analytics)\b/.test(n)) return true;
  return false;
}

function pickPrimaryGoogleAdsPurchaseKey(
  purchaseKeys: string[],
  ca: Record<string, { conversions: number; value: number }>,
  campaignName: string
): string | null {
  const ok = purchaseKeys.filter(k => {
    const row = ca[k];
    if (!row) return false;
    return !isPhantomStoreVisitPurchaseRow(k, row, campaignName);
  });
  if (ok.length === 0) return null;
  if (ok.length === 1) return ok[0];
  const lower = (s: string) => s.trim().toLowerCase();
  const hasData = (k: string) => (ca[k]?.conversions ?? 0) > 0 || (ca[k]?.value ?? 0) > 0;

  const gaImport = ok.find(k => isGoogleAnalyticsImportLabel(k) && hasData(k));
  if (gaImport) return gaImport;

  const exact = ok.find(k => lower(k) === 'purchase');
  if (exact && hasData(exact)) return exact;

  const paren = ok.find(k => /^purchase\s*\(/i.test(k.trim()) && hasData(k));
  if (paren) return paren;

  const web = ok.find(k => /website|web\s*store|ecommerce|shopify|woocommerce/i.test(k) && hasData(k));
  if (web) return web;

  const byConv = [...ok].sort((a, b) => (ca[b]?.conversions ?? 0) - (ca[a]?.conversions ?? 0));
  return byConv[0] ?? null;
}

function isGoogleAdsLikeChannel(channel: string | undefined): boolean {
  const ch = (channel || '').trim().toLowerCase();
  return ch === 'google ads' || ch === 'google shopping' || /^google\s*ads\b/.test(ch);
}

/**
 * Display conversions / value. When a conversion-action filter is active, `c` is already
 * narrowed by applyConvFilter — do not fall back to sumConversionActions.
 */
function getDisplayConversions(c: Campaign, convFilterActive: boolean): number {
  const raw = c.conversions;
  const n = raw != null ? (typeof raw === 'number' ? raw : parseFloat(String(raw))) : NaN;
  if (convFilterActive) {
    return Number.isNaN(n) ? 0 : n;
  }
  const fromActions = sumConversionActions(c.conversionActions).conv;
  if (!Number.isNaN(n) && n > 0) return n;
  if (fromActions > 0) return fromActions;
  return Number.isNaN(n) ? 0 : n;
}

function getDisplayConversionValue(c: Campaign, convFilterActive: boolean): number {
  const any = c as Campaign & { conversionValue?: number };
  const raw = c.conversion_value ?? any.conversionValue;
  const n = raw != null ? (typeof raw === 'number' ? raw : parseFloat(String(raw))) : NaN;
  if (convFilterActive) {
    return Number.isNaN(n) ? 0 : n;
  }
  const fromActions = sumConversionActions(c.conversionActions).value;
  if (!Number.isNaN(n) && n > 0) return n;
  if (fromActions > 0) return fromActions;
  return Number.isNaN(n) ? 0 : n;
}

function formatConvCount(n: number): string {
  const dec = Math.abs(n % 1) > 1e-6 ? 2 : 0;
  return formatNumber(n, dec);
}
