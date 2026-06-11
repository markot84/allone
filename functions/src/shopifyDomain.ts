// SEC-C1: strict Shopify shop-domain allow-list. The connector POSTs the global
// SHOPIFY_API_SECRET to https://{shopDomain}/admin/oauth/access_token and sends the
// shop access token to https://{shopDomain}/admin/api/..., so the domain MUST be a
// real *.myshopify.com host — never an attacker-controlled host, IP, port or path.
// Kept as a leaf module (no firebase imports) so unit tests can import it directly.

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/;

/**
 * Normalize user/stored input to `{store}.myshopify.com` and validate it strictly.
 * Accepts a bare store name (`mystore`), the canonical host, or an https URL to it.
 * Throws on anything else: foreign hosts, IPs, ports, userinfo, paths, nested
 * subdomains — the regex admits exactly one `[a-z0-9-]` label + the literal suffix.
 */
export function normalizeShopDomain(input: string): string {
  let domain = String(input ?? '').trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/[/?#].*$/, ''); // strip path/query/fragment before validating
  if (domain && !domain.includes('.')) {
    domain = `${domain}.myshopify.com`;
  }
  if (!SHOP_DOMAIN_RE.test(domain)) {
    throw new Error(`Invalid Shopify shop domain: ${String(input ?? '').slice(0, 100)}`);
  }
  return domain;
}
