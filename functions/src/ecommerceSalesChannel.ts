export type EcommerceSalesChannel = 'direct_eshop' | 'marketplace_skroutz' | 'intercompany' | 'personal' | 'needs_review';

export type EcommerceExclusionReason = 'none' | 'status' | 'marketplace' | 'intercompany' | 'personal' | 'review' | 'demo';

export type EcommerceSalesChannelRule = {
  enabled?: boolean;
  channel?: EcommerceSalesChannel;
  includeInCoreRevenue?: boolean;
  excludeFromDataAnalysis?: boolean;
  matchFields?: string[];
  patterns?: string[];
  reason?: EcommerceExclusionReason;
};

export type EcommerceOrderForClassification = {
  orderId?: string;
  orderName?: string;
  platform?: string;
  status?: string;
  paymentMethod?: string;
  shippingMethod?: string;
  customerEmail?: string;
  /** Combined customer full name (e.g. "Μαμάσης Γεώργιος") — used for intercompany matching. */
  customerName?: string;
  /** Magento store_id από sync — όχι πεδίο κανόνων· χρησιμοποιείται `orderStoreDomain`. */
  magentoStoreId?: number;
  /** Normalized storefront hostname for domain-based rules (Magento multi-store). */
  orderStoreDomain?: string;
};

export type EcommerceOrderClassification = {
  salesChannel: EcommerceSalesChannel;
  revenueIncluded: boolean;
  dataAnalysisIncluded: boolean;
  exclusionReason: EcommerceExclusionReason;
  matchedRule?: string;
};

export const SALES_CHANNEL_LABELS: Record<EcommerceSalesChannel, string> = {
  direct_eshop: 'Direct e-shop',
  marketplace_skroutz: 'Skroutz',
  intercompany: 'Ενδοομιλικά',
  personal: 'Προσωπικό',
  needs_review: 'Needs review',
};

const EXCLUDED_STATUS_SET = new Set([
  'cancelled',
  'canceled',
  'pending',
  'pending_payment',
  'payment_review',
  'failed',
  'closed',
  'refunded',
  'voided',
  'viva_klarna_undefined',
]);

const DEFAULT_MATCH_FIELDS = ['paymentMethod', 'shippingMethod', 'orderName', 'orderId'];

const EXACT_MATCH_FIELDS = new Set<string>();

export function isExcludedEcommerceStatus(status: string | null | undefined): boolean {
  return EXCLUDED_STATUS_SET.has(String(status || '').trim().toLowerCase());
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function fieldText(order: EcommerceOrderForClassification, field: string): string {
  const raw = (order as Record<string, unknown>)[field];
  return normalize(raw);
}

function ruleMatches(order: EcommerceOrderForClassification, rule: EcommerceSalesChannelRule): string | null {
  const fields = rule.matchFields?.length ? rule.matchFields : DEFAULT_MATCH_FIELDS;
  const patterns = (rule.patterns || []).map((p) => normalize(p)).filter(Boolean);
  if (patterns.length === 0) return null;

  for (const field of fields) {
    if (field === 'magentoStoreId') continue;
    const value = fieldText(order, field);
    if (!value) continue;
    const matched = EXACT_MATCH_FIELDS.has(field)
      ? patterns.find((pattern) => value === pattern)
      : patterns.find((pattern) => value.includes(pattern));
    if (matched) return `${field}:${matched}`;
  }
  return null;
}

export function normalizeSalesChannelRules(raw: unknown): EcommerceSalesChannelRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((rule): rule is EcommerceSalesChannelRule => typeof rule === 'object' && rule !== null)
    .filter((rule) => rule.enabled !== false && Array.isArray(rule.patterns) && rule.patterns.length > 0);
}

export function mergeSalesChannelRulesForBrand(
  persistedPieces: unknown[],
  revenueSourceMode: 'eshop_classified' | 'eshop_all' | 'erp'
): EcommerceSalesChannelRule[] {
  if (revenueSourceMode === 'eshop_all') {
    return [];
  }
  const flat = persistedPieces.flatMap((x) => (Array.isArray(x) ? x : []));
  return normalizeSalesChannelRules(flat);
}

export function classifyEcommerceOrder(
  order: EcommerceOrderForClassification,
  rules: EcommerceSalesChannelRule[] = []
): EcommerceOrderClassification {
  if (isExcludedEcommerceStatus(order.status)) {
    return { salesChannel: 'direct_eshop', revenueIncluded: false, dataAnalysisIncluded: false, exclusionReason: 'status' };
  }

  for (const rule of rules) {
    const channel = rule.channel || 'needs_review';
    const match = ruleMatches(order, rule);
    if (!match) continue;
    const includeInCoreRevenue = rule.includeInCoreRevenue ?? channel === 'direct_eshop';
    const exclusionReason: EcommerceExclusionReason =
      includeInCoreRevenue
        ? 'none'
        : rule.reason || (channel === 'marketplace_skroutz' ? 'marketplace' : channel === 'intercompany' ? 'intercompany' : channel === 'personal' ? 'personal' : 'review');
    return {
      salesChannel: channel,
      revenueIncluded: includeInCoreRevenue,
      dataAnalysisIncluded: rule.excludeFromDataAnalysis !== true,
      exclusionReason,
      matchedRule: match,
    };
  }

  return { salesChannel: 'direct_eshop', revenueIncluded: true, dataAnalysisIncluded: true, exclusionReason: 'none' };
}

