import { useEffect } from 'react';

/**
 * Φορτώνει το Google Tag Manager **δυναμικά** και **μόνο** στη σελίδα που καλεί το hook
 * (π.χ. marketing/landing). Δεν μπαίνει στο `index.html`, ώστε να ΜΗΝ φορτώνει στις
 * σελίδες της εφαρμογής (dashboard, connectors κ.λπ.).
 *
 * Σημείωση: το SPA renders μόνο με JavaScript, οπότε το `<noscript>` fallback είναι
 * ουσιαστικά άνευ αντικειμένου· το προσθέτουμε για πληρότητα/parity με το standard snippet.
 */
const DEFAULT_GTM_ID = 'GTM-K9DR7BM5';
const SCRIPT_ID = 'gtm-script';
const NOSCRIPT_ID = 'gtm-noscript';

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[];
  }
}

export function useGoogleTagManager(containerId: string = DEFAULT_GTM_ID): void {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!containerId) return;
    // Αποφυγή διπλής εισαγωγής (StrictMode double-invoke, re-mounts).
    if (document.getElementById(SCRIPT_ID)) return;

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
    document.head.appendChild(script);

    if (!document.getElementById(NOSCRIPT_ID)) {
      const noscript = document.createElement('noscript');
      noscript.id = NOSCRIPT_ID;
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.googletagmanager.com/ns.html?id=${encodeURIComponent(containerId)}`;
      iframe.height = '0';
      iframe.width = '0';
      iframe.style.display = 'none';
      iframe.style.visibility = 'hidden';
      noscript.appendChild(iframe);
      document.body.insertBefore(noscript, document.body.firstChild);
    }
  }, [containerId]);
}
