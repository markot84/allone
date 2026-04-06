/** Written on OAuth redirect before any child effect can strip hash query params. */
export const OAUTH_SESSION_KEY = 'perfplus_oauth_callback_v1';

/** Allow slow brand / Firestore load after redirect */
const MAX_AGE_MS = 30 * 60 * 1000;

export type OAuthSessionPayload = {
  connector: string;
  status: 'success' | 'error';
  message?: string | null;
  ts: number;
};

/** Query flag so 302 redirects carry OAuth result reliably (fragments in Location are often dropped). */
const OAUTH_QUERY_FLAG = 'pp_oauth';

/**
 * Call once from App useLayoutEffect.
 * 1) Prefer `?pp_oauth=1&connector=&status=` (safe through HTTP redirects).
 * 2) Legacy: hash `#data?connector=...` (older connectorCallback URLs).
 */
export function captureOAuthParamsFromLocation(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    const qp = url.searchParams;
    if (qp.get(OAUTH_QUERY_FLAG) !== '1') {
      captureOAuthParamsFromLocationHashLegacy();
      return;
    }
    const connector = qp.get('connector');
    const status = qp.get('status') as 'success' | 'error' | null;
    if (connector && (status === 'success' || status === 'error')) {
      const payload: OAuthSessionPayload = {
        connector,
        status,
        message: qp.get('message'),
        ts: Date.now(),
      };
      sessionStorage.setItem(OAUTH_SESSION_KEY, JSON.stringify(payload));
      qp.delete(OAUTH_QUERY_FLAG);
      qp.delete('connector');
      qp.delete('status');
      qp.delete('message');
      const qs = qp.toString();
      window.history.replaceState(null, '', `${url.pathname}${qs ? `?${qs}` : ''}#data`);
      return;
    }
  } catch {
    /* fall through */
  }
  captureOAuthParamsFromLocationHashLegacy();
}

function captureOAuthParamsFromLocationHashLegacy(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw.includes('connector=')) return;

    const q = raw.includes('?') ? raw.split('?')[1] || '' : '';
    const params = new URLSearchParams(q);
    const connector = params.get('connector');
    const status = params.get('status') as 'success' | 'error' | null;
    if (!connector || (status !== 'success' && status !== 'error')) return;

    const payload: OAuthSessionPayload = {
      connector,
      status,
      message: params.get('message'),
      ts: Date.now(),
    };
    sessionStorage.setItem(OAUTH_SESSION_KEY, JSON.stringify(payload));

    const base = raw.split('?')[0] || 'data';
    window.history.replaceState(null, '', `#${base}`);
  } catch {
    /* ignore */
  }
}

export function readOAuthSessionPayload(): OAuthSessionPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(OAUTH_SESSION_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as OAuthSessionPayload;
    if (!payload.connector || !payload.status || typeof payload.ts !== 'number') {
      sessionStorage.removeItem(OAUTH_SESSION_KEY);
      return null;
    }
    if (Date.now() - payload.ts > MAX_AGE_MS) {
      sessionStorage.removeItem(OAUTH_SESSION_KEY);
      return null;
    }
    return payload;
  } catch {
    try {
      sessionStorage.removeItem(OAUTH_SESSION_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
}

export function clearOAuthSession(): void {
  try {
    sessionStorage.removeItem(OAUTH_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
