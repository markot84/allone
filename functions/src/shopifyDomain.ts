// Strict Shopify shop-domain allow-list: the domain MUST be a real *.myshopify.com
// host (never attacker-controlled host/IP/port/path). Leaf module, no firebase imports.

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]{0,59}\.myshopify\.com$/;

/** Normalize input (bare `mystore`, canonical host, or https URL) to `{store}.myshopify.com`;
 * throws on foreign hosts, IPs, ports, userinfo, paths, or nested subdomains. */
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
