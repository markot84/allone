/**
 * Μετατρέπει κλειδιά budget_allocation (snake_case, κολλητά lowercase κ.λπ.)
 * σε εμφανίσιμα ονόματα: "Google Search Ads", "Dynamic Remarketing", ...
 */

const TOKEN_PARTS = [
  'shopping', 'search', 'remarketing', 'marketplace', 'dynamic', 'youtube', 'display',
  'facebook', 'instagram', 'google', 'meta', 'ads', 'skroutz', 'content', 'social',
  'network', 'tiktok', 'amazon', 'video', 'performance',
].sort((a, b) => b.length - a.length);

/** Γνωστά κλειδιά → ακριβές label (override). */
const KEY_OVERRIDES: Record<string, string> = {
  googleshopping: 'Google Shopping',
  google_shopping: 'Google Shopping',
  googlesearchads: 'Google Search Ads',
  google_search_ads: 'Google Search Ads',
  google_search: 'Google Search',
  metaads: 'Meta Ads',
  meta_ads: 'Meta Ads',
  meta: 'Meta',
  dynamicremarketing: 'Dynamic Remarketing',
  dynamic_remarketing: 'Dynamic Remarketing',
  marketplaceads_skroutz: 'Marketplace Ads (Skroutz)',
  marketplace_ads_skroutz: 'Marketplace Ads (Skroutz)',
  skroutz: 'Skroutz',
};

function glueTokenize(segment: string): string {
  let rest = segment.toLowerCase();
  const out: string[] = [];
  while (rest.length > 0) {
    let matched = false;
    for (const t of TOKEN_PARTS) {
      if (rest.startsWith(t)) {
        out.push(t);
        rest = rest.slice(t.length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      out.push(rest[0]);
      rest = rest.slice(1);
    }
  }
  return out.join(' ');
}

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Εμφανίσιμο όνομα για κλειδί budget / allocation. */
export function formatBudgetChannelLabel(rawKey: string): string {
  const trimmed = rawKey.trim();
  const flat = trimmed.toLowerCase().replace(/\s+/g, '_');
  if (KEY_OVERRIDES[flat]) return KEY_OVERRIDES[flat];

  const parts = flat.split(/[_\s]+/).filter(Boolean);
  if (parts.length === 0) return trimmed;

  const formatted = parts.map((p) => {
    const sub = KEY_OVERRIDES[p];
    if (sub) return sub;
    const glued = glueTokenize(p.replace(/_/g, ''));
    return titleCaseWords(glued);
  });

  return formatted.join(' ');
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * True αν το allocation key αντιστοιχεί σε κάποιο από τα ονόματα primary/secondary
 * (ώστε να μην το δείχνουμε ως "ορφανό" στο budget).
 */
export function budgetKeyMatchesListedChannel(budgetKey: string, channelDisplayName: string): boolean {
  const bc = norm(channelDisplayName);
  const raw = norm(budgetKey);
  const lbl = norm(formatBudgetChannelLabel(budgetKey));
  if (raw && (bc === raw || bc.includes(raw) || raw.includes(bc))) return true;
  if (lbl && (bc === lbl || bc.includes(lbl) || lbl.includes(bc))) return true;
  return false;
}
