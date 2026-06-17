/**
 * Marketing / landing tracking tags + conversion events.
 *
 * Όλα τα tags φορτώνονται **δυναμικά** και **μόνο** στη marketing/landing σελίδα
 * (βλ. `useMarketingTags`) — όχι στο `index.html` — ώστε τα διαφημιστικά pixels
 * (Meta, LinkedIn, Google Ads, GA4, Clarity) να ΜΗΝ τρέχουν στις σελίδες της
 * εφαρμογής (dashboard, connectors κ.λπ.), για λόγους ιδιωτικότητας/GDPR.
 *
 * Σημείωση: το SPA renders μόνο με JavaScript, οπότε τα `<noscript>` fallbacks των
 * standard snippets είναι ουσιαστικά άνευ αντικειμένου και παραλείπονται.
 *
 * Τα IDs είναι public-by-design (εμφανίζονται έτσι κι αλλιώς στο page source).
 */

// ── IDs ──────────────────────────────────────────────────────────────────────
export const GOOGLE_ADS_ID = 'AW-18189930823';
export const GA4_ID = 'G-6FGVNNQS61';
export const META_PIXEL_ID = '2058535931402205';
export const LINKEDIN_PARTNER_ID = '10407753';
export const CLARITY_ID = 'x0m5qkgsmu';

// Google Ads conversion labels (send_to)
export const GOOGLE_FORM_SUBMIT_CONVERSION = `${GOOGLE_ADS_ID}/U5ujCNWUz7McEMei0eFD`;
export const GOOGLE_CALL_CONVERSION = `${GOOGLE_ADS_ID}/SGInCMLpzrMcEMei0eFD`;
// LinkedIn conversion id
export const LINKEDIN_CONVERSION_ID = 29020305;

// ── Window typings ───────────────────────────────────────────────────────────
type GtagFn = (...args: unknown[]) => void;
type FbqFn = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[];
  push?: unknown;
  loaded?: boolean;
  version?: string;
};
type LintrkFn = ((action: string, data?: Record<string, unknown>) => void) & { q?: unknown[] };
type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[] };

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: GtagFn;
    fbq?: FbqFn;
    _fbq?: FbqFn;
    lintrk?: LintrkFn;
    _linkedin_partner_id?: string;
    _linkedin_data_partner_ids?: string[];
    clarity?: ClarityFn;
  }
}

// ── Base tag loaders (idempotent) ────────────────────────────────────────────

/** Δημιουργεί async `<script>` και το εισάγει πριν το πρώτο υπάρχον script (ή στο `<head>`). */
function injectScript(src: string, id?: string): void {
  const script = document.createElement('script');
  if (id) script.id = id;
  script.async = true;
  script.src = src;
  const first = document.getElementsByTagName('script')[0];
  if (first?.parentNode) {
    first.parentNode.insertBefore(script, first);
  } else {
    document.head.appendChild(script);
  }
}

/** Google tag (gtag.js) — μία φόρτωση, δύο `config` (Google Ads + GA4). */
function loadGoogleTag(): void {
  if (document.getElementById('gtag-js')) return;

  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    window.gtag = function gtag() {
      // gtag.js περιμένει το ίδιο το `arguments` object στο dataLayer.
      // eslint-disable-next-line prefer-rest-params
      (window.dataLayer as unknown[]).push(arguments);
    } as GtagFn;
  }

  injectScript(`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ADS_ID}`, 'gtag-js');

  window.gtag('js', new Date());
  window.gtag('config', GOOGLE_ADS_ID);
  window.gtag('config', GA4_ID);
}

/** Meta Pixel — init + PageView. */
function loadMetaPixel(): void {
  if (window.fbq) return;

  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) {
      fbq.callMethod(...args);
    } else {
      (fbq.queue as unknown[]).push(args);
    }
  } as FbqFn;

  if (!window._fbq) window._fbq = fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  window.fbq = fbq;

  injectScript('https://connect.facebook.net/en_US/fbevents.js');

  window.fbq('init', META_PIXEL_ID);
  window.fbq('track', 'PageView');
}

/** LinkedIn Insight Tag. */
function loadLinkedInInsight(): void {
  if (document.getElementById('linkedin-insight')) return;

  window._linkedin_partner_id = LINKEDIN_PARTNER_ID;
  window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
  window._linkedin_data_partner_ids.push(LINKEDIN_PARTNER_ID);

  if (!window.lintrk) {
    const lintrk = function (action: string, data?: Record<string, unknown>) {
      (lintrk.q as unknown[]).push([action, data]);
    } as LintrkFn;
    lintrk.q = [];
    window.lintrk = lintrk;
  }

  injectScript('https://snap.licdn.com/li.lms-analytics/insight.min.js', 'linkedin-insight');
}

/** Microsoft Clarity. */
function loadClarity(): void {
  if (document.getElementById('clarity-js')) return;

  if (!window.clarity) {
    const clarity = function (...args: unknown[]) {
      (clarity.q = clarity.q || []).push(args);
    } as ClarityFn;
    window.clarity = clarity;
  }

  injectScript(`https://www.clarity.ms/tag/${CLARITY_ID}`, 'clarity-js');
}

let baseTagsLoaded = false;

/** Φορτώνει όλα τα marketing base tags μία φορά (idempotent, StrictMode-safe). */
export function loadMarketingTags(): void {
  if (baseTagsLoaded) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  // Τα marketing/ad pixels + conversions τρέχουν ΜΟΝΟ σε production build — όχι σε
  // staging/dev — ώστε QA/internal traffic να μη μολύνει πραγματικά conversion data.
  // (Όλα τα window globals μένουν undefined εκτός production, οπότε τα track* no-op.)
  if (import.meta.env.MODE !== 'production') return;
  baseTagsLoaded = true;

  loadGoogleTag();
  loadMetaPixel();
  loadLinkedInInsight();
  loadClarity();
}

// ── Generic marketing event ──────────────────────────────────────────────────

/**
 * GA4 custom event για τη marketing σελίδα (`gtag('event', …)`), με παράλληλο
 * `dataLayer` push για συμβατότητα με τυχόν GTM/GA tag manager setup.
 */
export function trackMarketingEvent(action: string, params?: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  window.dataLayer?.push({ event: 'performance_plus_marketing', action, ...(params || {}) });
  window.gtag?.('event', action, { event_category: 'marketing_page', ...(params || {}) });
}

// ── Conversion events ────────────────────────────────────────────────────────

/** Meta Pixel `Lead` — κουμπί «Κλείστε παρουσίαση». */
export function trackMetaLead(): void {
  window.fbq?.('track', 'Lead');
}

/** CTA «Κλείστε παρουσίαση» — GA4 `cta_click` + Meta `Lead`. */
export function trackLeadCta(placement: string): void {
  trackMarketingEvent('cta_click', { placement });
  trackMetaLead();
}

/** Meta Pixel `Contact` — κουμπί τηλεφώνου. */
export function trackMetaContact(): void {
  window.fbq?.('track', 'Contact');
}

/** Google Ads — Submit lead form conversion (υποβολή φόρμας ενδιαφέροντος). */
export function trackGoogleFormSubmitConversion(): void {
  window.gtag?.('event', 'conversion', { send_to: GOOGLE_FORM_SUBMIT_CONVERSION });
}

/** Google Ads — Click to call conversion (κουμπί τηλεφώνου). */
export function trackGoogleCallConversion(): void {
  window.gtag?.('event', 'conversion', { send_to: GOOGLE_CALL_CONVERSION });
}

/** LinkedIn conversion — υποβολή φόρμας ενδιαφέροντος. */
export function trackLinkedInConversion(): void {
  window.lintrk?.('track', { conversion_id: LINKEDIN_CONVERSION_ID });
}
